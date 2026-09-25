import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import { addMyChild, fetchMyProfile, removeMyChild, saveMyProfile } from '../../api/moreApi';
import type { Child, MyProfileResponse, PersonalProfile } from '../../api/moreTypes';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon } from '../../components/ui/icons';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { errorCodeOf, errorMessageOf, humanError, isSessionExpired } from '../pets/petErrors';
import { MoreBackLink } from './MoreBackLink';
import { ageLabel, localToday, normalizeText, shortDate } from './moreLabels';
import { useMoreCache } from './useMoreCache';

const MARITAL_STATUSES = ['Soltero/a', 'Casado/a', 'Divorciado/a', 'Viudo/a', 'Unión de hecho'];

type FormState = Record<keyof PersonalProfile, string>;
const FIELDS: readonly (keyof PersonalProfile)[] = [
  'fullLegalName',
  'birthDate',
  'maritalStatus',
  'phone',
  'taxId',
  'healthInsurance',
  'emergencyContactName',
  'emergencyContactPhone',
];
const toForm = (profile: PersonalProfile | null): FormState =>
  Object.fromEntries(FIELDS.map((field) => [field, profile?.[field] ?? ''])) as FormState;

/**
 * 👤 Mi perfil (`pg-mi-perfil`): datos personales, 🆘 contacto de emergencia
 * y 👨‍👧‍👦 hijos de la persona de la sesión. Nunca se edita el perfil de otra
 * persona (el backend usa la sesión); el ADMIN los ve en Datos del equipo.
 */
export function ProfileScreen() {
  const { user, logout } = useAuth();
  const { userId, enabled } = useSessionScope();
  const hasEmployee = Boolean(user?.employee);
  const handleSessionExpired = useCallback(() => void logout(), [logout]);
  const query = useQuery({
    queryKey: queryKeys.more.profile(userId),
    queryFn: fetchMyProfile,
    enabled: enabled && hasEmployee,
  });
  const expired = isSessionExpired(query.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);

  const data = query.data;
  return (
    <div className="more more--narrow">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">👤 </span>
            {data?.employee.displayName ?? user?.employee?.displayName ?? 'Mi perfil'}
          </>
        }
        description="Mi perfil"
        refreshing={Boolean(data) && query.isFetching}
        actions={<MoreBackLink />}
      />
      {!hasEmployee ? (
        <EmptyState
          title="Tu usuario no tiene una persona vinculada"
          description="Mi perfil es para el equipo de trabajo."
        />
      ) : !data ? (
        query.isError ? (
          <ErrorState
            title="No pudimos cargar tu perfil"
            description={errorMessageOf(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <LoadingState label="Cargando tu perfil…" />
        )
      ) : (
        <>
          <ProfileForm
            key={data.employee.id}
            initial={data}
            onSessionExpired={handleSessionExpired}
          />
          <ChildrenCard items={data.children} onSessionExpired={handleSessionExpired} />
        </>
      )}
    </div>
  );
}

function ProfileForm({
  initial,
  onSessionExpired,
}: {
  initial: MyProfileResponse;
  onSessionExpired: () => void;
}) {
  const formId = useId();
  const queryClient = useQueryClient();
  const { userId } = useSessionScope();
  const { afterProfileChange } = useMoreCache();
  const { isSubmitting, run } = useSubmitGuard();
  const [form, setForm] = useState<FormState>(() => toForm(initial.profile));
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const today = localToday();
  const set = (field: keyof PersonalProfile) => (value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setStatus(null);
  };

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (form.birthDate && form.birthDate > today) {
      setStatus({ ok: false, text: 'La fecha de nacimiento no puede ser futura.' });
      return;
    }
    const body = Object.fromEntries(
      FIELDS.map((field) => [field, normalizeText(form[field]) || null]),
    ) as unknown as PersonalProfile;
    void run(async () => {
      try {
        const saved = await saveMyProfile(body);
        queryClient.setQueryData(queryKeys.more.profile(userId), saved);
        setForm(toForm(saved.profile));
        afterProfileChange();
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

  const input = (
    field: keyof PersonalProfile,
    label: string,
    props: Record<string, string | number> = {},
  ) => (
    <div className="field">
      <label className="field__label" htmlFor={`${formId}-${field}`}>
        {label}
      </label>
      <input
        id={`${formId}-${field}`}
        className="field__input"
        value={form[field]}
        disabled={isSubmitting}
        onChange={(event) => set(field)(event.target.value)}
        {...props}
      />
    </div>
  );

  return (
    <form className="more-form" onSubmit={handleSubmit} noValidate aria-label="Mis datos">
      <Card
        title={
          <>
            <span aria-hidden="true">👤 </span>Datos personales
          </>
        }
      >
        {input('fullLegalName', 'Nombre completo', {
          maxLength: 120,
          placeholder: 'Ej: María González',
          autoComplete: 'name',
        })}
        <div className="more-form__row">
          {input('birthDate', 'Fecha de nacimiento', {
            type: 'date',
            max: today,
            min: '1900-01-01',
          })}
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-maritalStatus`}>
              Estado civil
            </label>
            <select
              id={`${formId}-maritalStatus`}
              className="field__input"
              value={form.maritalStatus}
              disabled={isSubmitting}
              onChange={(event) => set('maritalStatus')(event.target.value)}
            >
              <option value="">— Elegir —</option>
              {MARITAL_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="more-form__row">
          {input('phone', 'Teléfono', {
            type: 'tel',
            maxLength: 30,
            placeholder: 'Ej: 3442 123456',
            autoComplete: 'tel',
          })}
          {input('taxId', 'CUIL', {
            maxLength: 20,
            inputMode: 'numeric',
            placeholder: 'Ej: 27-12345678-9',
          })}
        </div>
        {input('healthInsurance', 'Obra social', {
          maxLength: 80,
          placeholder: 'Ej: OSDE, IOMA, Swiss Medical...',
        })}
      </Card>
      <Card
        title={
          <>
            <span aria-hidden="true">🆘 </span>Contacto de emergencia
          </>
        }
      >
        {input('emergencyContactName', 'Nombre', {
          maxLength: 80,
          placeholder: 'Ej: María García',
        })}
        {input('emergencyContactPhone', 'Teléfono', {
          type: 'tel',
          maxLength: 30,
          placeholder: 'Ej: 3442 654321',
        })}
      </Card>
      <div aria-live="polite" className="live-status live-status--start">
        {status ? (
          <span role={status.ok ? 'status' : 'alert'}>
            {status.ok ? null : <AlertIcon size="sm" />}
            {status.text}
          </span>
        ) : null}
      </div>
      <Button type="submit" fullWidth loading={isSubmitting}>
        Guardar mis datos
      </Button>
    </form>
  );
}

function ChildrenCard({
  items,
  onSessionExpired,
}: {
  items: Child[];
  onSessionExpired: () => void;
}) {
  const formId = useId();
  const { afterProfileChange } = useMoreCache();
  const { isSubmitting, run } = useSubmitGuard();
  const intent = useRef(new IdempotencyIntent());
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Child | null>(null);
  const today = localToday();

  function handleAdd(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const clean = normalizeText(name);
    if (!clean) {
      setError('Ingresá el nombre.');
      return;
    }
    if (birthDate && birthDate > today) {
      setError('La fecha de nacimiento no puede ser futura.');
      return;
    }
    const body = { name: clean, birthDate: birthDate || null };
    void run(async () => {
      setError(null);
      try {
        await addMyChild(body, intent.current.keyFor(intentFingerprint('child', body)));
        intent.current.discard();
        setAdding(false);
        setName('');
        setBirthDate('');
        afterProfileChange();
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
    <Card
      title={
        <>
          <span aria-hidden="true">👨‍👧‍👦 </span>Hijos
        </>
      }
      actions={
        adding ? undefined : (
          <Button size="sm" onClick={() => setAdding(true)}>
            + Agregar
          </Button>
        )
      }
    >
      {items.length === 0 ? (
        <EmptyState title="Sin hijos registrados" titleAs="p" icon={<span>👶</span>} />
      ) : (
        <ul className="child-list" aria-label="Hijos">
          {items.map((child) => (
            <li key={child.id} className="child-item">
              <span aria-hidden="true">👶</span>
              <span className="child-item__body">
                <span className="child-item__name">{child.name}</span>
                <span className="child-item__meta">
                  {[child.birthDate ? shortDate(child.birthDate) : '', ageLabel(child.age)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <Button
                size="sm"
                variant="danger"
                aria-label={`Eliminar a ${child.name}`}
                onClick={() => setRemoving(child)}
              >
                <span aria-hidden="true">✕</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form
          className="more-form child-form"
          onSubmit={handleAdd}
          noValidate
          aria-label="Agregar hijo"
        >
          <div className="more-form__row">
            <div className="field">
              <label className="field__label" htmlFor={`${formId}-name`}>
                Nombre
              </label>
              <input
                id={`${formId}-name`}
                className="field__input"
                maxLength={60}
                placeholder="Ej: Juan"
                value={name}
                disabled={isSubmitting}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor={`${formId}-birth`}>
                Fecha de nac.
              </label>
              <input
                id={`${formId}-birth`}
                className="field__input"
                type="date"
                max={today}
                min="1900-01-01"
                value={birthDate}
                disabled={isSubmitting}
                onChange={(event) => setBirthDate(event.target.value)}
              />
            </div>
          </div>
          <div aria-live="assertive" className="live-status live-status--start">
            {error ? (
              <span role="alert">
                <AlertIcon size="sm" />
                {error}
              </span>
            ) : null}
          </div>
          <div className="dialog__actions">
            <Button
              variant="secondary"
              disabled={isSubmitting}
              onClick={() => {
                setAdding(false);
                setError(null);
                intent.current.discard();
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Guardar
            </Button>
          </div>
        </form>
      ) : null}
      {removing ? (
        <ConfirmDialog
          title="¿Eliminar este hijo del registro?"
          description={`Se quitará a ${removing.name} de tu perfil.`}
          confirmLabel="Eliminar"
          tone="danger"
          onCancel={() => setRemoving(null)}
          onConfirm={async () => {
            try {
              await removeMyChild(removing.id);
            } catch (caught) {
              if (isSessionExpired(caught)) return onSessionExpired();
              throw humanError(caught);
            }
            setRemoving(null);
            afterProfileChange();
          }}
        />
      ) : null}
    </Card>
  );
}
