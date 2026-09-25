import { Button } from '../../components/ui/Button';
import { AlertIcon, CheckCircleIcon } from '../../components/ui/icons';

export type Notice = { tone: 'positive' | 'danger'; text: string } | null;

interface StockNoticeProps {
  notice: Notice;
  /** Falla de revalidación con datos previos visibles: aviso + reintento, sin borrar la vista. */
  staleError?: string | null;
  onRetry?: () => void;
}

/** Avisos de una vista de Stock, anunciados por `aria-live`. */
export function StockNotice({ notice, staleError, onRetry }: StockNoticeProps) {
  return (
    <div aria-live="polite" className="stock__notice">
      {staleError ? (
        <p role="alert" className="notice notice--danger">
          <AlertIcon size="sm" />
          {staleError}
          {onRetry ? (
            <Button size="sm" variant="ghost" onClick={onRetry}>
              Reintentar
            </Button>
          ) : null}
        </p>
      ) : null}
      {notice ? (
        <p
          role={notice.tone === 'danger' ? 'alert' : 'status'}
          className={`notice notice--${notice.tone}`}
        >
          {notice.tone === 'danger' ? <AlertIcon size="sm" /> : <CheckCircleIcon size="sm" />}
          {notice.text}
        </p>
      ) : null}
    </div>
  );
}
