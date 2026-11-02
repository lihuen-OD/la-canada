import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  createNews,
  createNewsReply,
  deleteNews,
  deleteNewsReply,
  fetchNews,
  fetchNewsReplies,
  updateNews,
  updateNewsReply,
} from '../../api/moreApi';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import type {
  NewsItem,
  NewsMessagePermissions,
  NewsReply,
  NewsReplyCursor,
  NewsReplyQuote,
  NewsRepliesPage,
} from '../../api/moreTypes';
import { fetchTaskEmployees } from '../../api/tasksApi';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon } from '../../components/ui/icons';
import { formatDateTime } from '../../utils/dateFormat';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorCodeOf, errorMessageOf, humanError, isSessionExpired } from '../pets/petErrors';
import { ActionsMenu } from './ActionsMenu';
import { MoreBackLink } from './MoreBackLink';
import { normalizeText, timeAgo } from './moreLabels';
import { useMoreCache } from './useMoreCache';

const PAGE_SIZE = 20;
const TEXT_MAX = 500;
const REPLY_TEXT_MAX = 1000;

/** Respuestas: recorta extremos y unifica saltos de línea, sin colapsarlos (igual que el backend). */
const normalizeReplyText = (value: string) => value.trim().replace(/\r\n?/g, '\n');

/** Errores que indican que el mensaje ya no es el que se veía: revalidar solo lo afectado. */
const STALE_MESSAGE_CODES = new Set([
  'NEWS_MESSAGE_VERSION_CONFLICT',
  'NEWS_MESSAGE_DELETED',
  'NEWS_NOT_FOUND',
  'NEWS_REPLY_NOT_FOUND',
]);

/**
 * Compatibilidad durante el despliegue (frontend publicado antes que el
 * backend): una respuesta sin `permissions` se trata como antes de esta
 * función — se puede responder, sin menú de acciones.
 */
const NO_ACTIONS: NewsMessagePermissions = { canEdit: false, canDelete: false };
const LEGACY_NEWS_PERMISSIONS = { ...NO_ACTIONS, canReply: true };

/**
 * 📝 Novedades (`pg-novedades`): "¿Quién reporta?", el texto y "Registrar
 * novedad"; historial del más reciente al más antiguo con avatar, nombre y
 * "hace X". Un EMPLOYEE reporta siempre como sí mismo; un ADMIN elige la
 * persona. Edición y eliminación lógica (2026-10-30): el menú «⋯» muestra
 * solo las acciones que el backend autoriza para cada mensaje.
 */
export function NewsScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const handleSessionExpired = useCallback(() => void logout(), [logout]);
  const list = useInfiniteQuery({
    queryKey: queryKeys.more.news(userId),
    queryFn: ({ pageParam }) => fetchNews(pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled,
  });
  const expired = isSessionExpired(list.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);

  const seen = new Set<string>();
  const news = (list.data?.pages.flatMap((page) => page.news) ?? []).filter((item) =>
    seen.has(item.id) ? false : (seen.add(item.id), true),
  );

  return (
    <div className="more news-page">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">📝 </span>Novedades
          </>
        }
        refreshing={Boolean(list.data) && list.isFetching && !list.isFetchingNextPage}
        actions={<MoreBackLink />}
      />
      <Card>
        <NewsForm
          isAdmin={isAdmin}
          ownEmployee={user?.employee ?? null}
          onSessionExpired={handleSessionExpired}
        />
      </Card>

      <div className="news-history">
        <h2 className="more__section-title">Historial</h2>
        {!list.data ? (
          list.isError ? (
            <ErrorState
              title="No pudimos cargar las novedades"
              description={errorMessageOf(list.error)}
              onRetry={() => void list.refetch()}
            />
          ) : (
            <LoadingState label="Cargando novedades…" />
          )
        ) : news.length === 0 ? (
          <EmptyState icon={<span>📝</span>} title="Sin novedades aún" />
        ) : (
          <>
            <ul className="news-list" aria-label="Historial de novedades">
              {news.map((item) => (
                <li key={item.id} className="news-item">
                  <NewsReportCard item={item} onSessionExpired={handleSessionExpired} />
                </li>
              ))}
            </ul>
            {list.hasNextPage ? (
              <Button
                variant="secondary"
                fullWidth
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage({ cancelRefetch: false })}
              >
                Cargar más
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/** «Editado» con la fecha y hora de la última edición, siempre visible (zona de negocio). */
function EditedNote({ editedAt }: { editedAt: string }) {
  return (
    <p className="news-edited">
      Editado · <time dateTime={editedAt}>{formatDateTime(editedAt)}</time>
    </p>
  );
}

/**
 * Menú «⋯» de un mensaje: «Editar» y «Eliminar» solo si el backend los
 * autoriza (`ActionsMenu`: flechas, Inicio/Fin, Escape y foco devuelto).
 */
function MessageActionsMenu({
  label,
  permissions,
  triggerRef,
  onEdit,
  onDelete,
}: {
  label: string;
  permissions: NewsMessagePermissions;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <ActionsMenu
      label={label}
      triggerRef={triggerRef}
      items={[
        ...(permissions.canEdit ? [{ key: 'edit', label: 'Editar', onSelect: onEdit }] : []),
        ...(permissions.canDelete
          ? [{ key: 'delete', label: 'Eliminar', danger: true, onSelect: onDelete }]
          : []),
      ]}
    />
  );
}

/**
 * Edición en el lugar del mensaje. Guarda la versión con la que se abrió:
 * si el mensaje cambia en otra pantalla, no se guarda hasta que la persona
 * elige la versión actual o conservar su texto; si se elimina, ya no se
 * guarda (el texto queda para copiarlo). Sin cambios efectivos no envía nada.
 */
function MessageEditForm({
  label,
  message,
  maxLength,
  normalize,
  emptyMessage,
  onSave,
  onClose,
}: {
  label: string;
  message: { text: string | null; version: number; deleted: boolean };
  maxLength: number;
  normalize: (value: string) => string;
  emptyMessage: string;
  onSave: (text: string, version: number) => Promise<void>;
  onClose: () => void;
}) {
  const formId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isSubmitting, run } = useSubmitGuard();
  const [draft, setDraft] = useState(message.text ?? '');
  const [base, setBase] = useState({ text: message.text ?? '', version: message.version });
  const [error, setError] = useState<string | null>(null);
  const changedElsewhere = !isSubmitting && !message.deleted && message.version !== base.version;
  const blocked = message.deleted || changedElsewhere;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function rebase(useCurrentText: boolean): void {
    const current = message.text ?? '';
    if (useCurrentText) setDraft(current);
    setBase({ text: current, version: message.version });
    setError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (blocked) return;
    const clean = normalize(draft);
    if (!clean) {
      setError(emptyMessage);
      return;
    }
    if (clean.length > maxLength) {
      setError(`El texto no puede superar ${maxLength} caracteres.`);
      return;
    }
    if (clean === normalize(base.text)) {
      onClose();
      return;
    }
    void run(async () => {
      setError(null);
      try {
        await onSave(clean, base.version);
        onClose();
      } catch (caught) {
        setError(errorMessageOf(caught));
      }
    });
  }

  return (
    <form className="news-edit" onSubmit={handleSubmit} noValidate aria-label={label}>
      <label className="visually-hidden" htmlFor={`${formId}-text`}>
        {label}
      </label>
      <textarea
        ref={textareaRef}
        id={`${formId}-text`}
        className="field__input field__input--textarea"
        rows={3}
        maxLength={maxLength}
        value={draft}
        disabled={isSubmitting}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${formId}-error` : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
      />
      {message.deleted ? (
        <p className="news-edit__notice" role="alert">
          Este mensaje fue eliminado mientras lo editabas: ya no se puede guardar. Tu texto sigue
          acá para que lo copies.
        </p>
      ) : changedElsewhere ? (
        <div className="news-edit__notice" role="alert">
          <p>Este mensaje cambió en otra pantalla mientras lo editabas. Versión actual:</p>
          <blockquote>{message.text}</blockquote>
          <div className="news-edit__notice-actions">
            <Button size="sm" variant="secondary" onClick={() => rebase(true)}>
              Usar la versión actual
            </Button>
            <Button size="sm" variant="ghost" onClick={() => rebase(false)}>
              Conservar mi texto
            </Button>
          </div>
        </div>
      ) : error ? (
        <p id={`${formId}-error`} className="news-conversation__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="news-edit__actions">
        <Button size="sm" variant="ghost" disabled={isSubmitting} onClick={onClose}>
          Cancelar
        </Button>
        <Button size="sm" type="submit" loading={isSubmitting} disabled={blocked}>
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}

function NewsReportCard({
  item,
  onSessionExpired,
}: {
  item: NewsItem;
  onSessionExpired: () => void;
}) {
  const { afterNewsMessageChange, refreshNewsList } = useMoreCache();
  const [open, setOpen] = useState(false);
  // Montaje diferido; luego ocultar conserva borrador, cita e intento de envío.
  const [hasOpened, setHasOpened] = useState(false);
  const [focusTrigger, setFocusTrigger] = useState(0);
  const [editing, setEditing] = useState(false);
  /** Versión vista al pedir la confirmación (la que se envía al eliminar). */
  const [deleteVersion, setDeleteVersion] = useState<number | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const permissions = item.permissions ?? LEGACY_NEWS_PERMISSIONS;
  // Eliminada sin conversación: queda solo el marcador, sin iniciar una.
  const canOpenConversation = !item.deleted || item.hasConversation;

  function openToReply(): void {
    setHasOpened(true);
    setOpen(true);
    setFocusTrigger((value) => value + 1);
  }

  function handleStale(caught: unknown): void {
    if (isSessionExpired(caught)) onSessionExpired();
    if (STALE_MESSAGE_CODES.has(errorCodeOf(caught) ?? '')) refreshNewsList();
  }

  async function save(text: string, version: number): Promise<void> {
    try {
      const result = await updateNews(item.id, { text, version });
      afterNewsMessageChange(result.news, 'edit');
    } catch (caught) {
      handleStale(caught);
      throw caught;
    }
  }

  function closeEditor(): void {
    setEditing(false);
    menuTriggerRef.current?.focus();
  }

  return (
    <Card className="news-item__card">
      <div className="news-item__head">
        <Avatar name={item.employee.displayName} colorHex={item.employee.colorHex} size="sm" />
        <span className="news-item__author">{item.employee.displayName}</span>
        <time className="news-item__time" dateTime={item.createdAt}>
          {timeAgo(item.createdAt)}
        </time>
        <MessageActionsMenu
          label={`Acciones de la novedad de ${item.employee.displayName}`}
          permissions={permissions}
          triggerRef={menuTriggerRef}
          onEdit={() => setEditing(true)}
          onDelete={() => setDeleteVersion(item.version)}
        />
      </div>
      {editing ? (
        <MessageEditForm
          label="Editar novedad"
          message={item}
          maxLength={TEXT_MAX}
          normalize={normalizeText}
          emptyMessage="Escribí la novedad."
          onSave={save}
          onClose={closeEditor}
        />
      ) : item.deleted ? (
        <p className="news-deleted">Novedad eliminada</p>
      ) : (
        <>
          <p className="news-item__text">{item.text}</p>
          {item.editedAt ? <EditedNote editedAt={item.editedAt} /> : null}
        </>
      )}
      {canOpenConversation ? (
        <div className="news-item__actions">
          {permissions.canReply ? (
            <Button size="sm" variant="ghost" onClick={openToReply}>
              Responder
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={open}
            aria-controls={`news-replies-${item.id}`}
            onClick={() => {
              setHasOpened(true);
              setOpen((currentlyOpen) => !currentlyOpen);
            }}
          >
            {open ? 'Ocultar respuestas' : 'Ver respuestas'} · {item.replyCount}
          </Button>
          {item.lastReply ? (
            <p className="news-item__last-reply">
              Última respuesta · {item.lastReply.author.displayName} ·{' '}
              {timeAgo(item.lastReply.createdAt)}
            </p>
          ) : null}
        </div>
      ) : null}
      {hasOpened ? (
        <NewsConversation
          id={item.id}
          open={open && canOpenConversation}
          label={item.text ? `Respuestas a: ${item.text}` : 'Respuestas a una novedad eliminada'}
          canReply={permissions.canReply}
          focusTrigger={focusTrigger}
          onSessionExpired={onSessionExpired}
        />
      ) : null}
      {deleteVersion !== null ? (
        <ConfirmDialog
          title="¿Eliminar esta novedad?"
          description={
            permissions.canEdit
              ? 'Su texto dejará de mostrarse y quedará «Novedad eliminada» en su lugar. Las respuestas se conservan.'
              : 'Vas a eliminarla como administrador: su texto dejará de mostrarse y quedará «Novedad eliminada». Se conservan quién la escribió y las respuestas.'
          }
          confirmLabel="Eliminar"
          tone="danger"
          onCancel={() => setDeleteVersion(null)}
          onConfirm={async () => {
            try {
              const result = await deleteNews(item.id, deleteVersion);
              afterNewsMessageChange(result.news, 'delete');
            } catch (caught) {
              handleStale(caught);
              throw humanError(caught);
            }
            setDeleteVersion(null);
          }}
        />
      ) : null}
    </Card>
  );
}

function orderedUniqueReplies(pages: NewsRepliesPage[] | undefined): NewsReply[] {
  const repliesById = new Map<string, NewsReply>();
  for (const reply of pages?.flatMap((page) => page.replies) ?? []) {
    repliesById.set(reply.id, reply);
  }
  return [...repliesById.values()].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

function QuoteBlock({ quote }: { quote: NewsReplyQuote }) {
  return (
    <blockquote className="news-reply__quote">
      <strong>{quote.author.displayName}</strong>
      {quote.deleted ? (
        <p className="news-quote__deleted">Mensaje eliminado</p>
      ) : (
        <p>
          {quote.text}
          {quote.editedAt ? <span className="news-quote__edited"> (editado)</span> : null}
        </p>
      )}
    </blockquote>
  );
}

function NewsConversation({
  id,
  open,
  label,
  canReply,
  focusTrigger,
  onSessionExpired,
}: {
  id: string;
  open: boolean;
  label: string;
  canReply: boolean;
  focusTrigger: number;
  onSessionExpired: () => void;
}) {
  const { userId, enabled } = useSessionScope();
  const { afterNewsReply, refreshNewsConversation, refreshNewsList } = useMoreCache();
  const { isSubmitting, run } = useSubmitGuard();
  const [replyText, setReplyText] = useState('');
  const [quotedReply, setQuotedReply] = useState<NewsReply | null>(null);
  /** El backend rechazó la cita por eliminada (antes de que llegue la revalidación). */
  const [rejectedQuoteId, setRejectedQuoteId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const intent = useRef(new IdempotencyIntent());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const readingAnchor = useRef<{ element: Element; top: number } | null>(null);
  const replies = useInfiniteQuery({
    queryKey: queryKeys.more.newsReplies(userId, id),
    queryFn: ({ pageParam }) => fetchNewsReplies(id, pageParam),
    initialPageParam: null as NewsReplyCursor | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && open,
    staleTime: STALE_TIME.operational,
    refetchOnWindowFocus: true,
  });
  const visibleReplies = orderedUniqueReplies(replies.data?.pages);
  // La cita del borrador se muestra con el estado ACTUAL del mensaje citado.
  const quoted = quotedReply
    ? (visibleReplies.find((reply) => reply.id === quotedReply.id) ?? quotedReply)
    : null;
  const quoteUnavailable = quoted !== null && (quoted.deleted || rejectedQuoteId === quoted.id);
  const expired = isSessionExpired(replies.error);
  useEffect(() => {
    if (expired) onSessionExpired();
  }, [expired, onSessionExpired]);

  useEffect(() => {
    if (open && focusTrigger > 0) textareaRef.current?.focus();
  }, [focusTrigger, open]);

  useEffect(() => {
    if (replies.isFetchNextPageError || !open) readingAnchor.current = null;
  }, [replies.isFetchNextPageError, open]);

  useLayoutEffect(() => {
    const anchor = readingAnchor.current;
    if (!anchor) return;
    // El hilo usa el scroll de la página: conservar la posición de la fila
    // que ya se estaba leyendo, incluso si el navegador hizo scroll anchoring.
    window.scrollBy({
      top: anchor.element.getBoundingClientRect().top - anchor.top,
      behavior: 'instant',
    });
    readingAnchor.current = null;
  }, [visibleReplies.length]);

  function loadOlder(): void {
    const element = listRef.current?.firstElementChild;
    if (element) readingAnchor.current = { element, top: element.getBoundingClientRect().top };
    void replies.fetchNextPage({ cancelRefetch: false });
  }

  function quote(reply: NewsReply): void {
    setQuotedReply(reply);
    setRejectedQuoteId(null);
    textareaRef.current?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!canReply || quoteUnavailable) return;
    const clean = normalizeReplyText(replyText);
    if (!clean) {
      setSendError('Escribí una respuesta.');
      return;
    }
    if (clean.length > REPLY_TEXT_MAX) {
      setSendError(`La respuesta no puede superar ${REPLY_TEXT_MAX} caracteres.`);
      return;
    }
    const body = {
      text: clean,
      ...(quotedReply ? { quotedReplyId: quotedReply.id } : {}),
    };
    void run(async () => {
      setSendError(null);
      try {
        const result = await createNewsReply(
          id,
          body,
          intent.current.keyFor(intentFingerprint(id, body)),
        );
        intent.current.discard();
        await afterNewsReply(id, result.reply);
        setReplyText('');
        setQuotedReply(null);
      } catch (caught) {
        if (isSessionExpired(caught)) onSessionExpired();
        const code = errorCodeOf(caught);
        if (code === 'NEWS_REPLY_QUOTE_DELETED' && quotedReply) {
          setRejectedQuoteId(quotedReply.id);
          refreshNewsConversation(id);
          return;
        }
        if (code === 'NEWS_CONVERSATION_CLOSED') refreshNewsList();
        setSendError(errorMessageOf(caught));
      }
    });
  }

  return (
    <section
      id={`news-replies-${id}`}
      className="news-conversation"
      hidden={!open}
      aria-label={label}
    >
      <div className="news-conversation__heading">
        <h3>Conversación</h3>
        {replies.isFetching && replies.data ? <span>Actualizando…</span> : null}
      </div>
      {replies.isError && !replies.data ? (
        <ErrorState
          title="No pudimos cargar esta conversación"
          description={errorMessageOf(replies.error)}
          onRetry={() => void replies.refetch()}
        />
      ) : (
        <>
          {replies.isError ? (
            <p className="news-conversation__error" role="alert">
              {errorMessageOf(replies.error)}{' '}
              <Button size="sm" variant="ghost" onClick={() => void replies.refetch()}>
                Reintentar
              </Button>
            </p>
          ) : null}
          {replies.data && visibleReplies.length === 0 ? (
            <p className="news-conversation__empty">Todavía no hay respuestas.</p>
          ) : null}
          {replies.data && visibleReplies.length > 0 ? (
            <div className="news-conversation__thread" role="region" aria-label="Respuestas">
              {replies.hasNextPage ? (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={replies.isFetchingNextPage}
                  onClick={loadOlder}
                >
                  Ver respuestas anteriores
                </Button>
              ) : null}
              <ul ref={listRef} className="news-replies">
                {visibleReplies.map((reply) => (
                  <NewsReplyItem
                    key={reply.id}
                    newsId={id}
                    reply={reply}
                    canQuote={canReply}
                    onQuote={quote}
                    onSessionExpired={onSessionExpired}
                  />
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
      {!canReply ? (
        <p className="news-conversation__empty">
          Esta novedad fue eliminada y no admite respuestas nuevas.
        </p>
      ) : null}
      {canReply || replyText ? (
        <form className="news-reply-form" onSubmit={handleSubmit} noValidate>
          {quoted && quoteUnavailable ? (
            <div className="news-reply-form__quote news-reply-form__quote--conflict" role="alert">
              <div>
                <strong>El mensaje que citabas fue eliminado.</strong>
                <p>Quitá la cita o tocá «Responder» en otro mensaje. Tu texto se conserva.</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Quitar cita"
                disabled={isSubmitting}
                onClick={() => setQuotedReply(null)}
              >
                <span aria-hidden="true">×</span>
              </Button>
            </div>
          ) : quoted ? (
            <div className="news-reply-form__quote">
              <div>
                <strong>Respondiendo a {quoted.author.displayName}</strong>
                <p>
                  {quoted.text}
                  {quoted.editedAt ? <span className="news-quote__edited"> (editado)</span> : null}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Cancelar respuesta"
                disabled={isSubmitting}
                onClick={() => setQuotedReply(null)}
              >
                <span aria-hidden="true">×</span>
              </Button>
            </div>
          ) : null}
          <label className="field__label" htmlFor={`reply-${id}`}>
            Tu respuesta
          </label>
          <textarea
            ref={textareaRef}
            id={`reply-${id}`}
            className="field__input field__input--textarea"
            rows={3}
            maxLength={REPLY_TEXT_MAX}
            placeholder="Escribí una respuesta…"
            value={replyText}
            disabled={isSubmitting}
            aria-invalid={Boolean(sendError)}
            aria-describedby={sendError ? `reply-error-${id}` : undefined}
            onChange={(event) => {
              setReplyText(event.target.value);
              setSendError(null);
            }}
          />
          {sendError ? (
            <p id={`reply-error-${id}`} className="news-conversation__error" role="alert">
              {sendError}
            </p>
          ) : null}
          <Button
            className="news-reply-form__send"
            type="submit"
            size="sm"
            loading={isSubmitting}
            disabled={!replyText.trim() || !canReply || quoteUnavailable}
          >
            Enviar
          </Button>
        </form>
      ) : null}
    </section>
  );
}

/**
 * Una respuesta del hilo. Eliminada: queda en su lugar como «Mensaje
 * eliminado» (autor y fecha, sin texto, cita ni acciones).
 */
function NewsReplyItem({
  newsId,
  reply,
  canQuote,
  onQuote,
  onSessionExpired,
}: {
  newsId: string;
  reply: NewsReply;
  canQuote: boolean;
  onQuote: (reply: NewsReply) => void;
  onSessionExpired: () => void;
}) {
  const { afterNewsReplyChange, refreshNewsConversation } = useMoreCache();
  const [editing, setEditing] = useState(false);
  const [deleteVersion, setDeleteVersion] = useState<number | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const permissions = reply.permissions ?? NO_ACTIONS;

  function handleStale(caught: unknown): void {
    if (isSessionExpired(caught)) onSessionExpired();
    if (STALE_MESSAGE_CODES.has(errorCodeOf(caught) ?? '')) refreshNewsConversation(newsId);
  }

  async function save(text: string, version: number): Promise<void> {
    try {
      const result = await updateNewsReply(newsId, reply.id, { text, version });
      afterNewsReplyChange(newsId, result.reply);
    } catch (caught) {
      handleStale(caught);
      throw caught;
    }
  }

  function closeEditor(): void {
    setEditing(false);
    menuTriggerRef.current?.focus();
  }

  return (
    <li className={reply.deleted ? 'news-reply news-reply--deleted' : 'news-reply'}>
      <div className="news-reply__head">
        <Avatar name={reply.author.displayName} size="sm" />
        <div className="news-reply__identity">
          <strong>{reply.author.displayName}</strong>
          <time dateTime={reply.createdAt}>{timeAgo(reply.createdAt)}</time>
        </div>
        <MessageActionsMenu
          label={`Acciones del mensaje de ${reply.author.displayName}`}
          permissions={permissions}
          triggerRef={menuTriggerRef}
          onEdit={() => setEditing(true)}
          onDelete={() => setDeleteVersion(reply.version)}
        />
      </div>
      {reply.quote ? <QuoteBlock quote={reply.quote} /> : null}
      {editing ? (
        <MessageEditForm
          label="Editar respuesta"
          message={reply}
          maxLength={REPLY_TEXT_MAX}
          normalize={normalizeReplyText}
          emptyMessage="Escribí una respuesta."
          onSave={save}
          onClose={closeEditor}
        />
      ) : reply.deleted ? (
        <p className="news-reply__deleted">Mensaje eliminado</p>
      ) : (
        <>
          <p className="news-reply__text">{reply.text}</p>
          {reply.editedAt ? <EditedNote editedAt={reply.editedAt} /> : null}
          {canQuote ? (
            <Button
              size="sm"
              variant="ghost"
              className="news-reply__respond"
              onClick={() => onQuote(reply)}
            >
              Responder
            </Button>
          ) : null}
        </>
      )}
      {deleteVersion !== null ? (
        <ConfirmDialog
          title="¿Eliminar este mensaje?"
          description={
            permissions.canEdit
              ? 'Su texto dejará de mostrarse y quedará «Mensaje eliminado» en su lugar de la conversación.'
              : `Vas a eliminar un mensaje de ${reply.author.displayName} como administrador: quedará «Mensaje eliminado» en su lugar y se conserva quién lo escribió.`
          }
          confirmLabel="Eliminar"
          tone="danger"
          onCancel={() => setDeleteVersion(null)}
          onConfirm={async () => {
            try {
              const result = await deleteNewsReply(newsId, reply.id, deleteVersion);
              afterNewsReplyChange(newsId, result.reply, result.conversation);
            } catch (caught) {
              handleStale(caught);
              throw humanError(caught);
            }
            setDeleteVersion(null);
          }}
        />
      ) : null}
    </li>
  );
}

function NewsForm({
  isAdmin,
  ownEmployee,
  onSessionExpired,
}: {
  isAdmin: boolean;
  ownEmployee: { id: string; displayName: string } | null;
  onSessionExpired: () => void;
}) {
  const formId = useId();
  const { userId, enabled } = useSessionScope();
  const { afterNewsChange } = useMoreCache();
  const { isSubmitting, run } = useSubmitGuard();
  const intent = useRef(new IdempotencyIntent());
  const employees = useQuery({
    queryKey: queryKeys.tasks.employees(userId),
    queryFn: fetchTaskEmployees,
    enabled: enabled && isAdmin,
    staleTime: STALE_TIME.catalog,
  });
  const [reporterId, setReporterId] = useState(ownEmployee?.id ?? '');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const options = employees.data?.employees ?? [];
  const selectedReporter = isAdmin ? reporterId || options[0]?.id || '' : (ownEmployee?.id ?? '');

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const clean = normalizeText(text);
    if (!clean) {
      setError('Escribí la novedad.');
      return;
    }
    if (isAdmin && !selectedReporter) {
      setError('Elegí quién reporta.');
      return;
    }
    const body = isAdmin ? { text: clean, employeeId: selectedReporter } : { text: clean };
    void run(async () => {
      setError(null);
      setSaved(false);
      try {
        await createNews(body, intent.current.keyFor(intentFingerprint('news', body)));
        intent.current.discard();
        setText('');
        setSaved(true);
        afterNewsChange();
      } catch (caught) {
        if (isSessionExpired(caught)) {
          onSessionExpired();
          return;
        }
        if (errorCodeOf(caught) !== 'IDEMPOTENCY_RECORD_PENDING') intent.current.discard();
        setError(errorMessageOf(caught));
      }
    });
  }

  return (
    <form className="more-form" onSubmit={handleSubmit} noValidate aria-label="Registrar novedad">
      <div className="field">
        <label className="field__label" htmlFor={`${formId}-who`}>
          ¿Quién reporta?
        </label>
        {isAdmin ? (
          <select
            id={`${formId}-who`}
            className="field__input"
            value={selectedReporter}
            disabled={isSubmitting || !employees.data}
            onChange={(event) => setReporterId(event.target.value)}
          >
            {options.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.displayName}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={`${formId}-who`}
            className="field__input"
            value={ownEmployee?.displayName ?? ''}
            readOnly
            aria-readonly="true"
          />
        )}
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${formId}-text`}>
          Novedad
        </label>
        <textarea
          id={`${formId}-text`}
          className="field__input field__input--textarea"
          rows={3}
          maxLength={TEXT_MAX}
          placeholder="Describí la novedad..."
          value={text}
          disabled={isSubmitting}
          onChange={(event) => {
            setText(event.target.value);
            setSaved(false);
          }}
        />
      </div>
      <div aria-live="polite" className="live-status live-status--start">
        {saved ? <span role="status">Novedad registrada ✓</span> : null}
        {error ? (
          <span role="alert">
            <AlertIcon size="sm" />
            {error}
          </span>
        ) : null}
      </div>
      <Button type="submit" fullWidth loading={isSubmitting}>
        Registrar novedad
      </Button>
    </form>
  );
}
