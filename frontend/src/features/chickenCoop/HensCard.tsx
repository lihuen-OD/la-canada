import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { adjustChickenCoopHens, configureChickenCoop } from '../../api/chickenCoopApi';
import type { ChickenCoopState } from '../../api/chickenCoopTypes';
import { ApiError } from '../../api/httpClient';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { AlertIcon } from '../../components/ui/icons';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorCodeOf, errorMessageOf, isSessionExpired } from './chickenCoopErrors';
import { useChickenCoopCache } from './useChickenCoopCache';

const MAX_HENS = 100_000;

interface HensCardProps {
  coop: ChickenCoopState;
  isAdmin: boolean;
  onSessionExpired: () => void;
}

/**
 * "🐓 Gallinas activas": cantidad destacada en Fraunces y, solo para ADMIN,
 * "− Baja" / "+ Alta" de a una con la confirmación del prototipo
 * ("¿Cambiar gallinas activas de X a Y?"). El backend aplica el cambio solo
 * si la cantidad sigue siendo la confirmada.
 *
 * Sin configuración real todavía: el ADMIN ve el estado pendiente y carga la
 * cantidad inicial (nunca se inventa un valor); el resto ve el aviso.
 */
export function HensCard({ coop, isAdmin, onSessionExpired }: HensCardProps) {
  const [pendingDelta, setPendingDelta] = useState<1 | -1 | null>(null);
  const invalidate = useChickenCoopCache();
  const title = (
    <>
      <span aria-hidden="true">🐓 </span>Gallinas activas
    </>
  );

  if (!coop.configured || coop.activeHensCount === null) {
    return (
      <Card title={title}>
        {isAdmin ? (
          <ConfigureCoopForm onSessionExpired={onSessionExpired} onConfigured={invalidate} />
        ) : (
          <p className="notice notice--warning coop-hens__pending" role="status">
            <span aria-hidden="true">⏳ </span>
            Configuración pendiente: un administrador todavía no cargó la cantidad de gallinas.
            Igual podés registrar recolecciones; la postura se calcula cuando esté configurada.
          </p>
        )}
      </Card>
    );
  }

  const count = coop.activeHensCount;
  const next = pendingDelta === null ? count : count + pendingDelta;

  return (
    <Card
      title={title}
      className="coop-hens-card"
      actions={
        isAdmin ? (
          <div className="coop-hens__actions" role="group" aria-label="Alta y baja de gallinas">
            <Button
              size="sm"
              variant="secondary"
              disabled={count === 0}
              aria-label="Dar de baja una gallina"
              onClick={() => setPendingDelta(-1)}
            >
              − Baja
            </Button>
            <Button
              size="sm"
              aria-label="Dar de alta una gallina"
              onClick={() => setPendingDelta(1)}
            >
              + Alta
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="coop-hens">
        <p className="coop-hens__count" aria-describedby="coop-hens-caption">
          {count.toLocaleString('es-AR')}
        </p>
        <p id="coop-hens-caption" className="coop-hens__caption">
          gallinas en producción
        </p>
      </div>
      {pendingDelta !== null ? (
        <ConfirmDialog
          title={pendingDelta === 1 ? 'Alta de gallina' : 'Baja de gallina'}
          description={`¿Cambiar gallinas activas de ${count} a ${next}?`}
          confirmLabel={pendingDelta === 1 ? 'Confirmar alta' : 'Confirmar baja'}
          tone={pendingDelta === -1 ? 'danger' : 'default'}
          onCancel={() => setPendingDelta(null)}
          onConfirm={async () => {
            try {
              await adjustChickenCoopHens(pendingDelta, count);
              setPendingDelta(null);
              invalidate();
            } catch (error) {
              if (isSessionExpired(error)) {
                setPendingDelta(null);
                onSessionExpired();
                return;
              }
              // La cantidad cambió en otro dispositivo: se muestra el valor real.
              if (errorCodeOf(error) === 'CHICKEN_COOP_COUNT_CHANGED') invalidate();
              throw new ApiError(
                error instanceof ApiError ? error.status : 0,
                errorMessageOf(error),
                errorCodeOf(error),
              );
            }
          }}
        />
      ) : null}
    </Card>
  );
}

interface ConfigureCoopFormProps {
  onConfigured: () => void;
  onSessionExpired: () => void;
}

function ConfigureCoopForm({ onConfigured, onSessionExpired }: ConfigureCoopFormProps) {
  const inputId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { isSubmitting, run } = useSubmitGuard();

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed) || Number(trimmed) > MAX_HENS) {
      setError(
        `Ingresá la cantidad real de gallinas (entero entre 0 y ${MAX_HENS.toLocaleString('es-AR')}).`,
      );
      return;
    }
    void run(async () => {
      setError(null);
      try {
        await configureChickenCoop(Number(trimmed));
        onConfigured();
      } catch (caught) {
        if (isSessionExpired(caught)) {
          onSessionExpired();
          return;
        }
        if (errorCodeOf(caught) === 'CHICKEN_COOP_ALREADY_CONFIGURED') onConfigured();
        setError(errorMessageOf(caught));
      }
    });
  }

  return (
    <form className="coop-configure" onSubmit={handleSubmit} noValidate>
      <p className="notice notice--warning" role="status">
        <span aria-hidden="true">⏳ </span>
        Configuración pendiente: cargá la cantidad actual de gallinas en producción. Después se
        ajusta de a una con «+ Alta» y «− Baja».
      </p>
      <div className="field">
        <label className="field__label" htmlFor={inputId}>
          Gallinas en producción
        </label>
        <input
          id={inputId}
          className="field__input coop-form__count"
          type="number"
          min={0}
          max={MAX_HENS}
          step={1}
          inputMode="numeric"
          value={value}
          disabled={isSubmitting}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
        />
      </div>
      <div aria-live="assertive" className="live-status live-status--start">
        {error ? (
          <span role="alert">
            <AlertIcon size="sm" />
            {error}
          </span>
        ) : null}
      </div>
      <Button type="submit" loading={isSubmitting}>
        Guardar configuración
      </Button>
    </form>
  );
}
