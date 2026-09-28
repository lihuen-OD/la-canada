import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import {
  createFamilyMember,
  deleteFamilyMember,
  fetchMyFamily,
  saveMyOwnBirthday,
  setFamilyMemberActive,
  updateFamilyMember,
} from '../../api/moreApi';
import type {
  FamilyMember,
  FamilyRelation,
  OwnBirthday,
  PersonalProfileResponse,
} from '../../api/moreTypes';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon } from '../../components/ui/icons';
import { useAuth } from '../../auth/useAuth';
import { formatDate } from '../../utils/dateFormat';
import { PERSON_NAME_MAX, normalizePersonName, personNameError } from '../../utils/personName';
import { DeleteConfirmDialog } from '../admin/DeleteConfirmDialog';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorCodeOf, errorMessageOf, humanError, isSessionExpired } from '../pets/petErrors';
import {
  FAMILY_RELATIONS,
  FAMILY_RELATION_ICON,
  FAMILY_RELATION_LABEL,
  MONTHS_LONG,
  ageLabel,
  familyBirthDateLabel,
  localToday,
  normalizeText,
} from './moreLabels';
import { useMoreCache } from './useMoreCache';

/**
 * 👤 Mi perfil de un usuario SIN ficha de equipo (el ADMIN, Etapa 5F): 🎂 Mi
 * cumpleaños y 👨‍👩‍👧‍👦 Mi familia. El propietario sale siempre de la sesión
 * (nunca se envía un `userId`). Sin campos laborales. Los cumpleaños se
 * calculan en Eventos: guardar acá invalida Eventos, Inicio y Más.
 */

type Status = { ok: boolean; text: string } | null;

/** Mi perfil de un usuario sin ficha de equipo: 🎂 Mi cumpleaños + 👨‍👩‍👧‍👦 Mi familia. */
export default function PersonalProfileSection({
  data,
  onSessionExpired,
}: {
  data: PersonalProfileResponse;
  onSessionExpired: () => void;
}) {
  return (
    <>
      <OwnBirthdayCard initial={data.profile} onSessionExpired={onSessionExpired} />
      <FamilyCard onSessionExpired={onSessionExpired} />
    </>
  );
}

function StatusLine({ status, assertive = false }: { status: Status; assertive?: boolean }) {
  return (
    <div aria-live={assertive ? 'assertive' : 'polite'} className="live-status live-status--start">
      {status ? (
        <span role={status.ok ? 'status' : 'alert'}>
          {status.ok ? null : <AlertIcon size="sm" />}
          {status.text}
        </span>
      ) : null}
    </div>
  );
}

// ── 🎂 Mi cumpleaños ──────────────────────────────────────────────────────

export function OwnBirthdayCard({
  initial,
  onSessionExpired,
}: {
  initial: OwnBirthday;
  onSessionExpired: () => void;
}) {
  const formId = useId();
  const queryClient = useQueryClient();
  const { userId } = useSessionScope();
  const { applyDisplayName } = useAuth();
  const { afterOwnBirthdayChange, afterOwnNameChange } = useMoreCache();
  const { isSubmitting, run } = useSubmitGuard();
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(initial.displayName ?? '');
  const [birthDate, setBirthDate] = useState(initial.birthDate ?? '');
  const [status, setStatus] = useState<Status>(null);
  const today = localToday();

  function startEditing(): void {
    setDisplayName(initial.displayName ?? '');
    setBirthDate(initial.birthDate ?? '');
    setStatus(null);
    setEditing(true);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nameError = personNameError(displayName);
    if (nameError) {
      setStatus({ ok: false, text: nameError });
      return;
    }
    if (birthDate && birthDate > today) {
      setStatus({ ok: false, text: 'La fecha de nacimiento no puede ser futura.' });
      return;
    }
    const body = { displayName: normalizePersonName(displayName), birthDate: birthDate || null };
    void run(async () => {
      try {
        const saved = await saveMyOwnBirthday(body);
        queryClient.setQueryData(queryKeys.more.profile(userId), saved);
        if (saved.profile.displayName) applyDisplayName(saved.profile.displayName);
        afterOwnBirthdayChange();
        if (saved.profile.displayName !== initial.displayName) afterOwnNameChange();
        setEditing(false);
        setStatus({ ok: true, text: 'Datos guardados ✓' });
      } catch (caught) {
        if (isSessionExpired(caught)) {
          onSessionExpired();
          return;
        }
        setStatus({ ok: false, text: errorMessageOf(caught) });
      }
    });
  }

  return (
    <Card
      className="more__card"
      title={
        <>
          <span aria-hidden="true">🎂 </span>Mi cumpleaños
        </>
      }
      actions={
        editing ? undefined : (
          <Button size="sm" variant="secondary" onClick={startEditing}>
            Editar
          </Button>
        )
      }
    >
      {editing ? (
        <form className="more-form" onSubmit={handleSubmit} noValidate aria-label="Mi cumpleaños">
          <div className="more-form__row">
            <div className="field">
              <label className="field__label" htmlFor={`${formId}-name`}>
                Nombre visible
              </label>
              <input
                id={`${formId}-name`}
                className="field__input"
                maxLength={PERSON_NAME_MAX}
                autoComplete="name"
                placeholder="Así te ve el equipo en toda la app"
                value={displayName}
                disabled={isSubmitting}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor={`${formId}-birth`}>
                Fecha de nacimiento
              </label>
              <input
                id={`${formId}-birth`}
                className="field__input"
                type="date"
                min="1900-01-01"
                max={today}
                value={birthDate}
                disabled={isSubmitting}
                onChange={(event) => setBirthDate(event.target.value)}
              />
            </div>
          </div>
          <StatusLine status={status} assertive />
          <div className="dialog__actions">
            <Button variant="secondary" disabled={isSubmitting} onClick={() => setEditing(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Guardar
            </Button>
          </div>
        </form>
      ) : (
        <>
          <dl className="own-birthday">
            <div>
              <dt>Nombre visible</dt>
              <dd>{initial.displayName ?? 'Sin cargar (se muestra «Administrador»)'}</dd>
            </div>
            <div>
              <dt>Fecha de nacimiento</dt>
              <dd>{initial.birthDate ? formatDate(initial.birthDate) : 'Sin cargar'}</dd>
            </div>
          </dl>
          <StatusLine status={status} />
        </>
      )}
    </Card>
  );
}

// ── 👨‍👩‍👧‍👦 Mi familia ───────────────────────────────────────────────────────

type Dialog =
  | { kind: 'none' }
  | { kind: 'form'; member?: FamilyMember }
  | { kind: 'delete'; member: FamilyMember };

export function FamilyCard({ onSessionExpired }: { onSessionExpired: () => void }) {
  const { userId, enabled } = useSessionScope();
  const { afterFamilyChange } = useMoreCache();
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const [status, setStatus] = useState<Status>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const query = useQuery({
    queryKey: queryKeys.more.family(userId),
    queryFn: fetchMyFamily,
    enabled,
  });
  const expired = isSessionExpired(query.error);
  useEffect(() => {
    if (expired) onSessionExpired();
  }, [expired, onSessionExpired]);

  async function toggleActive(member: FamilyMember): Promise<void> {
    if (pendingId) return;
    setPendingId(member.id);
    setStatus(null);
    try {
      await setFamilyMemberActive(member.id, !member.active);
      afterFamilyChange();
      setStatus({
        ok: true,
        text: member.active
          ? `${member.name} ya no aparece en Eventos.`
          : `${member.name} vuelve a aparecer en Eventos.`,
      });
    } catch (caught) {
      if (isSessionExpired(caught)) return onSessionExpired();
      setStatus({ ok: false, text: errorMessageOf(caught) });
    } finally {
      setPendingId(null);
    }
  }

  const family = query.data?.family;
  return (
    <Card
      className="more__card"
      title={
        <>
          <span aria-hidden="true">👨‍👩‍👧‍👦 </span>Mi familia
        </>
      }
      actions={
        <Button size="sm" onClick={() => setDialog({ kind: 'form' })}>
          + Agregar
        </Button>
      }
    >
      {!family ? (
        query.isError ? (
          <ErrorState
            title="No pudimos cargar tu familia"
            description={errorMessageOf(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <LoadingState label="Cargando tu familia…" />
        )
      ) : family.length === 0 ? (
        <EmptyState title="Todavía no agregaste familiares." titleAs="p" icon={<span>👪</span>} />
      ) : (
        <ul className="family-list" aria-label="Mi familia" aria-busy={query.isFetching}>
          {family.map((member) => (
            <li
              key={member.id}
              className={['family-item', member.active ? null : 'family-item--inactive']
                .filter(Boolean)
                .join(' ')}
            >
              <span className="family-item__icon" aria-hidden="true">
                {FAMILY_RELATION_ICON[member.relation]}
              </span>
              <span className="child-item__body">
                <span className="child-item__name">
                  {member.name}{' '}
                  {member.active ? null : (
                    <Badge tone="neutral" className="family-item__badge">
                      Inactivo
                    </Badge>
                  )}
                </span>
                <span className="child-item__meta">
                  {[
                    FAMILY_RELATION_LABEL[member.relation],
                    familyBirthDateLabel(member.birthDate),
                    ageLabel(member.age),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="family-item__actions">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Editar a ${member.name}`}
                  onClick={() => setDialog({ kind: 'form', member })}
                >
                  <span aria-hidden="true">✏️</span>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={pendingId === member.id}
                  disabled={pendingId !== null && pendingId !== member.id}
                  aria-label={`${member.active ? 'Desactivar' : 'Reactivar'} a ${member.name}`}
                  onClick={() => void toggleActive(member)}
                >
                  {member.active ? 'Desactivar' : 'Reactivar'}
                </Button>
                {member.seeded ? null : (
                  <Button
                    size="sm"
                    variant="danger"
                    aria-label={`Eliminar a ${member.name}`}
                    onClick={() => setDialog({ kind: 'delete', member })}
                  >
                    Eliminar
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <StatusLine status={status} />

      {dialog.kind === 'form' ? (
        <FamilyMemberDialog
          member={dialog.member}
          onClose={() => setDialog({ kind: 'none' })}
          onSaved={(text) => {
            setDialog({ kind: 'none' });
            setStatus({ ok: true, text });
            afterFamilyChange();
          }}
          onSessionExpired={onSessionExpired}
        />
      ) : null}
      {dialog.kind === 'delete' ? (
        <DeleteConfirmDialog
          entityLabel="al familiar"
          name={dialog.member.name}
          keepWhen="solo querés que deje de aparecer en Eventos"
          onCancel={() => setDialog({ kind: 'none' })}
          onConfirm={async () => {
            try {
              await deleteFamilyMember(dialog.member.id);
            } catch (caught) {
              if (isSessionExpired(caught)) return onSessionExpired();
              throw humanError(caught);
            }
            setStatus({ ok: true, text: `${dialog.member.name} se eliminó de tu familia.` });
            setDialog({ kind: 'none' });
            afterFamilyChange();
          }}
        />
      ) : null}
    </Card>
  );
}

const DAYS = Array.from({ length: 31 }, (_, index) => index + 1);
const pad = (value: number | string) => String(value).padStart(2, '0');

/** Estado del formulario a partir de `YYYY-MM-DD` / `--MM-DD`. */
function initialDate(birthDate: string | undefined) {
  if (!birthDate) return { unknownYear: false, full: '', month: '', day: '' };
  if (birthDate.startsWith('--')) {
    const [month = '', day = ''] = birthDate.slice(2).split('-');
    return { unknownYear: true, full: '', month: String(Number(month)), day: String(Number(day)) };
  }
  const [, month = '', day = ''] = birthDate.split('-');
  return {
    unknownYear: false,
    full: birthDate,
    month: String(Number(month)),
    day: String(Number(day)),
  };
}

/** "Agregar familiar" / "Editar familiar": nombre, relación y fecha (año opcional, nunca inventado). */
function FamilyMemberDialog({
  member,
  onClose,
  onSaved,
  onSessionExpired,
}: {
  member?: FamilyMember;
  onClose: () => void;
  onSaved: (text: string) => void;
  onSessionExpired: () => void;
}) {
  const formId = useId();
  const { isSubmitting, run } = useSubmitGuard();
  const intent = useRef(new IdempotencyIntent());
  const start = initialDate(member?.birthDate);
  const [name, setName] = useState(member?.name ?? '');
  const [relation, setRelation] = useState<FamilyRelation>(member?.relation ?? 'FAMILY');
  const [unknownYear, setUnknownYear] = useState(start.unknownYear);
  const [full, setFull] = useState(start.full);
  const [month, setMonth] = useState(start.month);
  const [day, setDay] = useState(start.day);
  const [error, setError] = useState<string | null>(null);
  const today = localToday();

  function resolveBirthDate(): string | null {
    if (!unknownYear) {
      if (!full) return null;
      return full;
    }
    if (!month || !day) return null;
    return `--${pad(month)}-${pad(day)}`;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const cleanName = normalizeText(name);
    const birthDate = resolveBirthDate();
    if (!cleanName) {
      setError('Ingresá el nombre.');
      return;
    }
    if (!birthDate) {
      setError(unknownYear ? 'Elegí el día y el mes.' : 'Ingresá la fecha de nacimiento.');
      return;
    }
    if (!unknownYear && birthDate > today) {
      setError('La fecha de nacimiento no puede ser futura.');
      return;
    }
    const body = { name: cleanName, relation, birthDate };
    void run(async () => {
      setError(null);
      try {
        if (member) {
          await updateFamilyMember(member.id, body);
          onSaved(`${cleanName} se actualizó ✓`);
        } else {
          await createFamilyMember(body, intent.current.keyFor(intentFingerprint('family', body)));
          intent.current.discard();
          onSaved(`${cleanName} se agregó a tu familia ✓`);
        }
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
    <Modal titleId={`${formId}-title`} onRequestClose={onClose} closeDisabled={isSubmitting}>
      <form className="dialog" onSubmit={handleSubmit} noValidate>
        <h2 id={`${formId}-title`} className="dialog__title">
          {member ? 'Editar familiar' : 'Agregar familiar'}
        </h2>
        <div className="more-form__row">
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-name`}>
              Nombre
            </label>
            <input
              id={`${formId}-name`}
              className="field__input"
              maxLength={60}
              autoComplete="off"
              placeholder="Ej: Juan"
              value={name}
              disabled={isSubmitting}
              onChange={(change) => setName(change.target.value)}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-relation`}>
              Relación
            </label>
            <select
              id={`${formId}-relation`}
              className="field__input"
              value={relation}
              disabled={isSubmitting}
              onChange={(change) => setRelation(change.target.value as FamilyRelation)}
            >
              {FAMILY_RELATIONS.map((option) => (
                <option key={option} value={option}>
                  {FAMILY_RELATION_ICON[option]} {FAMILY_RELATION_LABEL[option]}
                </option>
              ))}
            </select>
          </div>
        </div>
        {unknownYear ? (
          <div className="more-form__row">
            <div className="field">
              <label className="field__label" htmlFor={`${formId}-day`}>
                Día
              </label>
              <select
                id={`${formId}-day`}
                className="field__input"
                value={day}
                disabled={isSubmitting}
                onChange={(change) => setDay(change.target.value)}
              >
                <option value="">— Día —</option>
                {DAYS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor={`${formId}-month`}>
                Mes
              </label>
              <select
                id={`${formId}-month`}
                className="field__input"
                value={month}
                disabled={isSubmitting}
                onChange={(change) => setMonth(change.target.value)}
              >
                <option value="">— Mes —</option>
                {MONTHS_LONG.map((label, index) => (
                  <option key={label} value={index + 1}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-birth`}>
              Fecha de nacimiento
            </label>
            <input
              id={`${formId}-birth`}
              className="field__input"
              type="date"
              min="1900-01-01"
              max={today}
              value={full}
              disabled={isSubmitting}
              onChange={(change) => setFull(change.target.value)}
            />
          </div>
        )}
        <label className="check-field">
          <input
            type="checkbox"
            checked={unknownYear}
            disabled={isSubmitting}
            onChange={(change) => {
              const checked = change.target.checked;
              setUnknownYear(checked);
              if (checked && full) {
                const [, m = '', d = ''] = full.split('-');
                setMonth(String(Number(m)));
                setDay(String(Number(d)));
              }
            }}
          />
          <span>No sé el año (se guarda solo día y mes)</span>
        </label>
        <div aria-live="assertive" className="live-status live-status--start">
          {isSubmitting ? <span role="status">Guardando…</span> : null}
          {error ? (
            <span role="alert">
              <AlertIcon size="sm" />
              {error}
            </span>
          ) : null}
        </div>
        <div className="dialog__actions">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Guardar
          </Button>
        </div>
      </form>
    </Modal>
  );
}
