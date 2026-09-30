import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createEggCollection } from '../../api/chickenCoopApi';
import type { CreateEggCollectionRequest } from '../../api/chickenCoopTypes';
import { ApiError } from '../../api/httpClient';
import { OfflineError } from '../../api/transportErrors';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import { useParticipants } from '../../api/useParticipants';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { AlertIcon, CheckCircleIcon } from '../../components/ui/icons';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorCodeOf, errorMessageOf, isSessionExpired } from './chickenCoopErrors';
import { eggsText } from './chickenCoopLabels';
import { useChickenCoopCache } from './useChickenCoopCache';
import { attributedName } from '../../utils/recordAttribution';
import {
  ownParticipantValue,
  participantLabel,
  participantParams,
  participantValue,
} from '../../utils/participants';

const MAX_EGGS = 10_000;
const NOTES_MAX = 300;

/** `retry`: sin respuesta útil, el reintento reusa la MISMA clave. `pending`: solo consultar. */
type SubmitPhase = 'idle' | 'retry' | 'pending';

interface CollectionFormProps {
  /** Fecha de negocio de hoy según el backend (`BUSINESS_TIME_ZONE`). */
  today: string;
  onSessionExpired: () => void;
}

function parseCount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return parsed <= MAX_EGGS ? parsed : null;
}

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * "🥚 Registrar recolección" del prototipo: huevos buenos, huevos rotos,
 * "¿Quién juntó?", fecha y observaciones opcionales. Un EMPLOYEE queda fijado
 * a sí mismo (no envía persona); un ADMIN elige un empleado activo. Fecha de
 * hoy o pasada, nunca futura (el backend decide con `BUSINESS_TIME_ZONE`).
 * Tras registrar se limpian cantidades y observaciones y se conservan
 * persona y fecha, como el prototipo.
 */
export function CollectionForm({ today, onSessionExpired }: CollectionFormProps) {
  const formId = useId();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const invalidate = useChickenCoopCache();
  const { isSubmitting, run } = useSubmitGuard();
  const intentRef = useRef(new IdempotencyIntent());
  const [good, setGood] = useState('');
  const [broken, setBroken] = useState('');
  /** `null` = hoy (la fecha de negocio que informa el backend). */
  const [date, setDate] = useState<string | null>(null);
  const [collectorId, setCollectorId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [phase, setPhase] = useState<SubmitPhase>('idle');

  // Personas elegibles, solo para ADMIN: empleados y administradores activos
  // (catálogo compartido con Stock).
  const participantsQuery = useParticipants(isAdmin);
  const participants = participantsQuery.data?.participants ?? [];
  const expired = isSessionExpired(participantsQuery.error);
  useEffect(() => {
    if (expired) onSessionExpired();
  }, [expired, onSessionExpired]);

  // Como el `<select>` del prototipo: arranca en la propia persona (su ficha
  // o, para un ADMIN sin ficha, él mismo), si no en la primera activa.
  const ownValue = ownParticipantValue(user);
  const defaultCollector = participants.find(
    (participant) => participantValue(participant) === ownValue,
  )
    ? ownValue
    : participants[0]
      ? participantValue(participants[0])
      : '';
  const selectedCollector = collectorId ?? defaultCollector;
  const effectiveDate = date ?? today;
  const locked = phase === 'pending';
  const disabled = isSubmitting || locked;

  function changeField(apply: () => void): void {
    apply();
    intentRef.current.discard();
    setPhase('idle');
    setError(null);
    setSuccess(null);
  }

  function validate(): string | CreateEggCollectionRequest {
    const goodEggsCount = parseCount(good);
    const brokenEggsCount = parseCount(broken);
    if (goodEggsCount === null || brokenEggsCount === null) {
      return `Las cantidades deben ser números enteros entre 0 y ${MAX_EGGS.toLocaleString('es-AR')}.`;
    }
    if (goodEggsCount + brokenEggsCount === 0) return 'Ingresá al menos un huevo.';
    if (!effectiveDate) return 'Seleccioná la fecha.';
    if (effectiveDate > today) return 'La fecha no puede ser futura.';
    if (isAdmin && !selectedCollector) return 'Elegí quién juntó los huevos.';
    const normalizedNotes = normalizeText(notes);
    if (normalizedNotes.length > NOTES_MAX) {
      return `Las observaciones no pueden superar ${NOTES_MAX} caracteres.`;
    }
    if (/[<>]/.test(normalizedNotes)) return 'Las observaciones no pueden contener HTML.';
    const body: CreateEggCollectionRequest = {
      goodEggsCount,
      brokenEggsCount,
      collectionDate: effectiveDate,
    };
    // El autor nunca viaja: el backend lo toma de la sesión.
    if (isAdmin) Object.assign(body, participantParams(selectedCollector));
    if (normalizedNotes) body.notes = normalizedNotes;
    return body;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // Un segundo clic justo después de registrar (formulario ya limpio) no
    // es un envío nuevo: se conserva el aviso de éxito.
    if (success && good.trim() === '' && broken.trim() === '') return;
    const result = validate();
    if (typeof result === 'string') {
      setError(result);
      setSuccess(null);
      return;
    }
    void run(async () => {
      setError(null);
      setSuccess(null);
      const key = intentRef.current.keyFor(intentFingerprint('egg-collection', result));
      try {
        const response = await createEggCollection(result, key);
        intentRef.current.discard();
        setPhase('idle');
        setGood('');
        setBroken('');
        setNotes('');
        const { goodEggsCount, brokenEggsCount } = response.collection;
        const collector = attributedName(response.collection);
        setSuccess(
          `Recolección registrada: ${eggsText(goodEggsCount, brokenEggsCount)}${collector ? ` (${collector})` : ''}.`,
        );
        invalidate();
      } catch (caught) {
        if (isSessionExpired(caught)) {
          onSessionExpired();
          return;
        }
        const code = errorCodeOf(caught);
        if (code === 'IDEMPOTENCY_RECORD_PENDING') {
          setPhase('pending');
        } else if (!(caught instanceof ApiError) || caught.status >= 500) {
          // Pudo haberse registrado o no: "Reintentar" reenvía la MISMA
          // clave y el backend responde el replay si ya existía.
          setPhase('retry');
        } else {
          intentRef.current.discard();
          setPhase('idle');
        }
        setError(
          (caught instanceof ApiError && caught.status < 500) || caught instanceof OfflineError
            ? errorMessageOf(caught)
            : 'No pudimos confirmar el registro. Podés reintentar: no se registrará dos veces.',
        );
      }
    });
  }

  return (
    <Card
      title={
        <>
          <span aria-hidden="true">🥚 </span>Registrar recolección
        </>
      }
    >
      <form
        className="coop-form"
        onSubmit={handleSubmit}
        noValidate
        aria-label="Registrar recolección"
      >
        <div className="coop-form__row">
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-good`}>
              Huevos buenos
            </label>
            <input
              id={`${formId}-good`}
              className="field__input coop-form__count"
              type="number"
              min={0}
              max={MAX_EGGS}
              step={1}
              inputMode="numeric"
              placeholder="0"
              value={good}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value;
                changeField(() => setGood(next));
              }}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-broken`}>
              Huevos rotos
            </label>
            <input
              id={`${formId}-broken`}
              className="field__input coop-form__count"
              type="number"
              min={0}
              max={MAX_EGGS}
              step={1}
              inputMode="numeric"
              placeholder="0"
              value={broken}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value;
                changeField(() => setBroken(next));
              }}
            />
          </div>
        </div>

        <div className="coop-form__row">
          <div className="field">
            {isAdmin ? (
              <>
                <label className="field__label" htmlFor={`${formId}-collector`}>
                  ¿Quién juntó?
                </label>
                <select
                  id={`${formId}-collector`}
                  className="field__input"
                  value={selectedCollector}
                  disabled={disabled || participants.length === 0}
                  onChange={(event) => {
                    const next = event.target.value;
                    changeField(() => setCollectorId(next));
                  }}
                >
                  {participants.length === 0 ? (
                    <option value="">
                      {participantsQuery.isPending ? 'Cargando personas…' : 'Sin personas activas'}
                    </option>
                  ) : null}
                  {participants.map((participant) => (
                    <option
                      key={participantValue(participant)}
                      value={participantValue(participant)}
                    >
                      {participantLabel(participant)}
                    </option>
                  ))}
                </select>
                {participantsQuery.isError && !expired ? (
                  <p className="field__hint">
                    No pudimos cargar las personas.{' '}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void participantsQuery.refetch()}
                    >
                      Reintentar
                    </Button>
                  </p>
                ) : null}
              </>
            ) : (
              <>
                <p className="field__label">¿Quién juntó?</p>
                <p className="coop-form__fixed">
                  {user?.employee?.displayName ?? 'Vos'}
                  <span className="field__hint"> (tu sesión)</span>
                </p>
              </>
            )}
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-date`}>
              Fecha
            </label>
            <input
              id={`${formId}-date`}
              className="field__input"
              type="date"
              max={today}
              value={effectiveDate}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value;
                changeField(() => setDate(next));
              }}
            />
          </div>
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${formId}-notes`}>
            Observaciones (opcional)
          </label>
          <input
            id={`${formId}-notes`}
            className="field__input"
            type="text"
            maxLength={NOTES_MAX}
            autoComplete="off"
            placeholder="Ej: 2 huevos rotos en nido 3, gallina clueca..."
            value={notes}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value;
              changeField(() => setNotes(next));
            }}
          />
        </div>

        <div aria-live="polite" className="live-status live-status--start">
          {isSubmitting ? (
            <span role="status">{locked ? 'Consultando…' : 'Registrando…'}</span>
          ) : null}
          {error ? (
            <span role="alert">
              <AlertIcon size="sm" />
              {error}
            </span>
          ) : null}
          {success ? (
            <span role="status" className="coop-form__success">
              <CheckCircleIcon size="sm" />
              {success}
            </span>
          ) : null}
        </div>

        <Button type="submit" fullWidth loading={isSubmitting}>
          {locked ? 'Consultar estado' : phase === 'retry' ? 'Reintentar' : 'Registrar recolección'}
        </Button>
      </form>
    </Card>
  );
}
