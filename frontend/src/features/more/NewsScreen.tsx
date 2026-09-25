import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { createNews, fetchNews } from '../../api/moreApi';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
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
        <Card>
          <ul className="news-list" aria-label="Historial de novedades">
            {news.map((item) => (
              <li key={item.id} className="news-item">
                <div className="news-item__head">
                  <Avatar
                    name={item.employee.displayName}
                    colorHex={item.employee.colorHex}
                    size="sm"
                  />
                  <span className="news-item__author">{item.employee.displayName}</span>
                  <time className="news-item__time" dateTime={item.createdAt}>
                    {timeAgo(item.createdAt)}
                  </time>
                </div>
                <p className="news-item__text">{item.text}</p>
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
        </Card>
      )}
    </div>
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
