import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createNews, createNewsReply, fetchNews, fetchNewsReplies } from '../../api/moreApi';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import type { NewsItem, NewsReply, NewsReplyCursor, NewsRepliesPage } from '../../api/moreTypes';
import { fetchTaskEmployees } from '../../api/tasksApi';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon } from '../../components/ui/icons';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorCodeOf, errorMessageOf, isSessionExpired } from '../pets/petErrors';
import { MoreBackLink } from './MoreBackLink';
import { normalizeText, timeAgo } from './moreLabels';
import { useMoreCache } from './useMoreCache';

const PAGE_SIZE = 20;
const TEXT_MAX = 500;
const REPLY_TEXT_MAX = 1000;

/**
 * 📝 Novedades (`pg-novedades`): "¿Quién reporta?", el texto y "Registrar
 * novedad"; historial del más reciente al más antiguo con avatar, nombre y
 * "hace X". Sin edición ni borrado (como el prototipo). Un EMPLOYEE reporta
 * siempre como sí mismo; un ADMIN elige la persona.
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
    <div className="more">
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
  );
}

function NewsReportCard({
  item,
  onSessionExpired,
}: {
  item: NewsItem;
  onSessionExpired: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [focusTrigger, setFocusTrigger] = useState(0);

  function openToReply(): void {
    setOpen(true);
    setFocusTrigger((value) => value + 1);
  }

  return (
    <Card className="news-item__card">
      <div className="news-item__head">
        <Avatar name={item.employee.displayName} colorHex={item.employee.colorHex} size="sm" />
        <span className="news-item__author">{item.employee.displayName}</span>
        <time className="news-item__time" dateTime={item.createdAt}>
          {timeAgo(item.createdAt)}
        </time>
      </div>
      <p className="news-item__text">{item.text}</p>
      {item.lastReply ? (
        <p className="news-item__last-reply">
          Última respuesta · {item.lastReply.author.displayName} ·{' '}
          {timeAgo(item.lastReply.createdAt)}
        </p>
      ) : null}
      <div className="news-item__actions">
        <Button size="sm" variant="ghost" onClick={openToReply}>
          Responder
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          aria-controls={`news-replies-${item.id}`}
          onClick={() => {
            setOpen((currentlyOpen) => !currentlyOpen);
          }}
        >
          {open ? 'Ocultar respuestas' : `Ver respuestas · ${item.replyCount}`}
        </Button>
      </div>
      {open ? (
        <NewsConversation
          id={item.id}
          text={item.text}
          focusTrigger={focusTrigger}
          onSessionExpired={onSessionExpired}
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

function NewsConversation({
  id,
  text,
  focusTrigger,
  onSessionExpired,
}: {
  id: string;
  text: string;
  focusTrigger: number;
  onSessionExpired: () => void;
}) {
  const { userId, enabled } = useSessionScope();
  const { afterNewsReply } = useMoreCache();
  const { isSubmitting, run } = useSubmitGuard();
  const [replyText, setReplyText] = useState('');
  const [quotedReply, setQuotedReply] = useState<NewsReply | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const intent = useRef(new IdempotencyIntent());
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const scrollHeightBeforeLoad = useRef<number | null>(null);
  const replies = useInfiniteQuery({
    queryKey: queryKeys.more.newsReplies(userId, id),
    queryFn: ({ pageParam }) => fetchNewsReplies(id, pageParam),
    initialPageParam: null as NewsReplyCursor | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    staleTime: STALE_TIME.operational,
    refetchOnWindowFocus: true,
  });
  const visibleReplies = orderedUniqueReplies(replies.data?.pages);
  const expired = isSessionExpired(replies.error);
  useEffect(() => {
    if (expired) onSessionExpired();
  }, [expired, onSessionExpired]);

  useEffect(() => {
    if (focusTrigger > 0) textareaRef.current?.focus();
  }, [focusTrigger]);

  useEffect(() => {
    if (replies.isFetchNextPageError) scrollHeightBeforeLoad.current = null;
  }, [replies.isFetchNextPageError]);

  useEffect(() => {
    const container = listRef.current;
    if (!container || scrollHeightBeforeLoad.current === null) return;
    container.scrollTop += container.scrollHeight - scrollHeightBeforeLoad.current;
    scrollHeightBeforeLoad.current = null;
  }, [visibleReplies.length]);

  function loadOlder(): void {
    if (listRef.current) scrollHeightBeforeLoad.current = listRef.current.scrollHeight;
    void replies.fetchNextPage({ cancelRefetch: false });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const clean = replyText.trim();
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
        setSendError(errorMessageOf(caught));
      }
    });
  }

  return (
    <section
      id={`news-replies-${id}`}
      className="news-conversation"
      aria-label={`Respuestas a: ${text}`}
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
            <div
              className="news-conversation__scroll"
              role="region"
              aria-label="Respuestas"
              tabIndex={0}
            >
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
                  <li key={reply.id} className="news-reply">
                    {reply.quote ? (
                      <blockquote className="news-reply__quote">
                        <strong>{reply.quote.author.displayName}</strong>
                        <p>{shortQuote(reply.quote.text)}</p>
                      </blockquote>
                    ) : null}
                    <div className="news-reply__head">
                      <strong>{reply.author.displayName}</strong>
                      <time dateTime={reply.createdAt}>{timeAgo(reply.createdAt)}</time>
                    </div>
                    <p className="news-reply__text">{reply.text}</p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="news-reply__respond"
                      onClick={() => {
                        setQuotedReply(reply);
                        textareaRef.current?.focus();
                      }}
                    >
                      Responder
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
      <form className="news-reply-form" onSubmit={handleSubmit} noValidate>
        {quotedReply ? (
          <div className="news-reply-form__quote">
            <div>
              <strong>Respondiendo a {quotedReply.author.displayName}</strong>
              <p>{shortQuote(quotedReply.text)}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={isSubmitting}
              onClick={() => setQuotedReply(null)}
            >
              Cancelar respuesta
            </Button>
          </div>
        ) : null}
        <label className="field__label" htmlFor={`reply-${id}`}>
          Escribí una respuesta…
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
          onChange={(event) => {
            setReplyText(event.target.value);
            setSendError(null);
          }}
        />
        {sendError ? (
          <p className="news-conversation__error" role="alert">
            {sendError}
          </p>
        ) : null}
        <Button type="submit" size="sm" loading={isSubmitting} disabled={!replyText.trim()}>
          Enviar
        </Button>
      </form>
    </section>
  );
}

function shortQuote(value: string): string {
  const clean = value.trim();
  return clean.length > 180 ? `${clean.slice(0, 177)}…` : clean;
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
