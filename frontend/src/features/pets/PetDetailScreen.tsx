import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ApiError } from '../../api/httpClient';
import { OfflineError } from '../../api/transportErrors';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import {
  createPetRecord,
  fetchPet,
  fetchPetDue,
  fetchPetRecords,
  fetchPetTypes,
  voidPetRecord,
  deletePet,
  setPetActive,
} from '../../api/petsApi';
import type {
  CreatePetRecordRequest,
  MedicalRecordType,
  PetDetailResponse,
  PetDueItem,
  PetRecord,
} from '../../api/petTypes';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { buttonClassName } from '../../components/ui/buttonStyles';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon, ArrowLeftIcon, CheckCircleIcon } from '../../components/ui/icons';
import { Badge } from '../../components/ui/Badge';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { DeleteConfirmDialog } from '../admin/DeleteConfirmDialog';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { NextDueDialog } from './NextDueDialog';
import { PetDueRow } from './PetDueRow';
import { PetFormDialog } from './PetFormDialog';
import { PetPhoto } from './PetPhoto';
import { errorCodeOf, errorMessageOf, humanError, isSessionExpired } from './petErrors';
import {
  RECORD_FILTERS,
  RECORD_OPTION_LABEL,
  RECORD_TAG_LABEL,
  RECORD_TYPES,
  ageText,
  dueRelativeText,
  DUE_STATUS_LABEL,
  formatDate,
  formatKg,
  fulfillActionLabel,
  nextDay,
  petSummary,
} from './petLabels';
import { useBusinessDayRefresh } from './useBusinessDayRefresh';
import { usePetsCache } from './usePetsCache';
import { attributedName } from '../../utils/recordAttribution';

const RECORDS_PAGE_SIZE = 20;
const UPCOMING_PAGE_SIZE = 20;

/** Corregir la fecha programada (ADMIN) desde la ficha o el historial. */
type NextDueTarget = {
  record: { id: string; type: MedicalRecordType; recordDate: string };
  current: string | null;
};

/**
 * Ficha de una mascota (`pg-mascota-detalle` del prototipo): perfil con foto,
 * "✏️" (ADMIN), 4 KPIs, "➕ Nuevo registro" (todos) e historial clínico
 * filtrable por tipo, con "✕" (ADMIN) que anula el registro.
 */
export function PetDetailScreen() {
  const { petId = '' } = useParams();
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const [editing, setEditing] = useState(false);
  const [adminDialog, setAdminDialog] = useState<'none' | 'status' | 'delete'>('none');
  /** «Registrar aplicación / control»: el pendiente que el formulario va a cumplir. */
  const [fulfilling, setFulfilling] = useState<PetDueItem | null>(null);
  const [nextDueTarget, setNextDueTarget] = useState<NextDueTarget | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const fulfillParam = searchParams.get('cumplir');
  const navigate = useNavigate();
  const { afterPetChange, afterPetDeleted } = usePetsCache();
  const handleSessionExpired = useCallback(() => {
    void logout();
  }, [logout]);

  const detailQuery = useQuery({
    queryKey: queryKeys.pets.detail(userId, petId),
    queryFn: () => fetchPet(petId),
    enabled: enabled && petId !== '',
    staleTime: STALE_TIME.operational,
  });
  const typesQuery = useQuery({
    queryKey: queryKeys.pets.types(userId, 'all'),
    queryFn: () => fetchPetTypes('all'),
    enabled: enabled && isAdmin && editing,
    staleTime: STALE_TIME.catalog,
  });
  const expired = isSessionExpired(detailQuery.error) || isSessionExpired(typesQuery.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);

  const detail = detailQuery.data;
  const back = (
    <Link to="/pets" className={buttonClassName({ variant: 'ghost', size: 'sm' })}>
      <ArrowLeftIcon size="sm" /> Volver
    </Link>
  );

  if (!detail) {
    return (
      <div className="pets">
        <PageHeader title="Mascota" actions={back} />
        {detailQuery.isError ? (
          <ErrorState
            title={
              detailQuery.error instanceof ApiError && detailQuery.error.status === 404
                ? 'La mascota no existe'
                : 'No pudimos cargar la mascota'
            }
            description={errorMessageOf(detailQuery.error)}
            onRetry={() => void detailQuery.refetch()}
          />
        ) : (
          <LoadingState label="Cargando mascota…" />
        )}
      </div>
    );
  }

  const { pet } = detail;
  const age = ageText(pet.age);
  return (
    <div className="pets">
      <PageHeader title={pet.name} actions={back} refreshing={detailQuery.isFetching} />

      <Card className="pet-profile">
        <PetPhoto pet={pet} size="lg" />
        <div className="pet-profile__text">
          <p className="pet-profile__name">
            {pet.name}
            {!pet.active ? <Badge tone="neutral">Inactiva</Badge> : null}
          </p>
          <p className="pet-profile__info">{petSummary(pet, false)}</p>
          {age ? (
            <p className="pet-profile__age">
              <span aria-hidden="true">🎂 </span>
              {age} de edad
            </p>
          ) : null}
        </div>
        {isAdmin ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Editar ${pet.name}`}
            onClick={() => setEditing(true)}
          >
            <span aria-hidden="true">✏️</span>
          </Button>
        ) : null}
      </Card>

      {isAdmin ? (
        <div className="pet-admin-actions" role="group" aria-label={`Acciones sobre ${pet.name}`}>
          <Button variant="secondary" size="sm" onClick={() => setAdminDialog('status')}>
            {pet.active ? 'Desactivar' : 'Reactivar'}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setAdminDialog('delete')}>
            Eliminar
          </Button>
        </div>
      ) : null}

      <PetKpis detail={detail} />
      <UpcomingCard
        petId={pet.id}
        canRegister={pet.active}
        isAdmin={isAdmin}
        fulfillParam={fulfillParam}
        onFulfillParamHandled={() => {
          const next = new URLSearchParams(searchParams);
          next.delete('cumplir');
          setSearchParams(next, { replace: true });
        }}
        onRegister={setFulfilling}
        onEditDate={setNextDueTarget}
        onSessionExpired={handleSessionExpired}
      />
      {pet.active ? (
        <RecordForm
          petId={pet.id}
          today={detail.today}
          fulfilling={fulfilling}
          onFulfillDone={() => setFulfilling(null)}
          onSessionExpired={handleSessionExpired}
        />
      ) : (
        <p className="notice notice--warning" role="status">
          Mascota inactiva: su historia se conserva, pero no admite registros nuevos
          {isAdmin ? '. Reactivala para volver a registrar datos.' : '.'}
        </p>
      )}
      <RecordHistory
        petId={pet.id}
        isAdmin={isAdmin}
        onEditDate={setNextDueTarget}
        onSessionExpired={handleSessionExpired}
      />
      {nextDueTarget ? (
        <NextDueDialog
          petId={pet.id}
          record={nextDueTarget.record}
          current={nextDueTarget.current}
          onClose={() => setNextDueTarget(null)}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}

      {adminDialog === 'status' ? (
        <ConfirmDialog
          title={pet.active ? `Desactivar «${pet.name}»` : `Reactivar «${pet.name}»`}
          description={
            pet.active
              ? 'Para una mascota que murió, se entregó o ya no está. Deja de aparecer en el listado y no admite registros nuevos. No se borra nada: su historia clínica y sus fotos se conservan y podés reactivarla.'
              : 'La mascota vuelve al listado y admite registros nuevos.'
          }
          confirmLabel={pet.active ? 'Desactivar' : 'Reactivar'}
          tone={pet.active ? 'danger' : 'default'}
          onCancel={() => setAdminDialog('none')}
          onConfirm={async () => {
            try {
              await setPetActive(pet.id, !pet.active);
            } catch (caught) {
              if (isSessionExpired(caught)) {
                setAdminDialog('none');
                handleSessionExpired();
                return;
              }
              throw humanError(caught);
            }
            setAdminDialog('none');
            afterPetChange(pet.id);
          }}
        />
      ) : null}

      {adminDialog === 'delete' ? (
        <DeleteConfirmDialog
          entityLabel="la mascota"
          name={pet.name}
          keepWhen="ya tiene registros clínicos o fotos"
          onCancel={() => setAdminDialog('none')}
          onConfirm={async () => {
            try {
              await deletePet(pet.id);
            } catch (caught) {
              if (isSessionExpired(caught)) {
                setAdminDialog('none');
                handleSessionExpired();
                return;
              }
              throw humanError(caught);
            }
            afterPetDeleted(pet.id);
            void navigate('/pets', { replace: true });
          }}
        />
      ) : null}

      {editing && typesQuery.data ? (
        <PetFormDialog
          pet={pet}
          types={typesQuery.data.types}
          today={detail.today}
          photoStorage={detail.photoStorage}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}
      {editing && !typesQuery.data ? (
        <p role="status" className="field__hint">
          {typesQuery.isError ? 'No pudimos cargar los tipos.' : 'Abriendo edición…'}
        </p>
      ) : null}
    </div>
  );
}

function PetKpis({ detail }: { detail: PetDetailResponse }) {
  const { kpis } = detail;
  const birthday = kpis.daysToBirthday;
  const items = [
    { label: 'Vacunas registradas', value: String(kpis.vaccines), tone: 'positive' },
    {
      label: 'Último peso',
      value: kpis.lastWeight ? `${formatKg(kpis.lastWeight.kg)} kg` : '—',
      tone: 'info',
    },
    { label: 'Desparasitaciones', value: String(kpis.dewormings), tone: 'positive' },
    {
      label: 'Próximo cumple',
      value: birthday === null ? '—' : birthday === 0 ? '¡Hoy!' : `${birthday} días`,
      tone: birthday === 0 ? 'danger' : 'warning',
    },
  ];
  return (
    <ul className="pet-kpis" aria-label="Indicadores de la mascota">
      {items.map((item) => (
        <li key={item.label}>
          <Card className={`pet-kpi pet-kpi--${item.tone}`}>
            <p className="pet-kpi__value">{item.value}</p>
            <p className="pet-kpi__label">{item.label}</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}

/**
 * «Próximas atenciones» de la ficha: los pendientes abiertos de ESTA mascota
 * (mismo endpoint que 📅 Vencimientos, filtrado por mascota), con
 * «Registrar aplicación / control» si admite registros nuevos. Desde
 * Vencimientos se llega con `?cumplir=<id>`: se abre el formulario con ese
 * pendiente ya elegido.
 */
function UpcomingCard({
  petId,
  canRegister,
  isAdmin,
  fulfillParam,
  onFulfillParamHandled,
  onRegister,
  onEditDate,
  onSessionExpired,
}: {
  petId: string;
  canRegister: boolean;
  isAdmin: boolean;
  fulfillParam: string | null;
  onFulfillParamHandled: () => void;
  onRegister: (item: PetDueItem) => void;
  onEditDate: (target: NextDueTarget) => void;
  onSessionExpired: () => void;
}) {
  const { userId, enabled } = useSessionScope();
  const filters = { petId };
  const query = useInfiniteQuery({
    queryKey: queryKeys.pets.due(userId, filters),
    queryFn: ({ pageParam }) =>
      fetchPetDue({ ...filters, page: pageParam, pageSize: UPCOMING_PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled,
    staleTime: STALE_TIME.operational,
  });
  const expired = isSessionExpired(query.error);
  useEffect(() => {
    if (expired) onSessionExpired();
  }, [expired, onSessionExpired]);
  useBusinessDayRefresh(query.data?.pages[0]?.refreshAt);

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  useEffect(() => {
    if (!fulfillParam || !query.data) return;
    const target = items.find((item) => item.record.id === fulfillParam);
    if (target && canRegister) onRegister(target);
    onFulfillParamHandled();
    // Solo al llegar desde Vencimientos (el parámetro se consume una vez).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fulfillParam, query.data]);

  return (
    <Card
      title={
        <>
          <span aria-hidden="true">📅 </span>Próximas atenciones
        </>
      }
    >
      {!query.data ? (
        query.isError ? (
          <ErrorState
            title="No pudimos cargar las próximas atenciones"
            description={errorMessageOf(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <LoadingState label="Cargando próximas atenciones…" />
        )
      ) : items.length === 0 ? (
        <EmptyState
          titleAs="p"
          title="Sin atenciones programadas"
          description="Al registrar una vacuna, desparasitación o control podés indicar la fecha de la próxima."
        />
      ) : (
        <>
          <ul className="pet-history__list" aria-label="Próximas atenciones">
            {items.map((item) => (
              <PetDueRow
                key={item.record.id}
                item={item}
                onRegister={canRegister ? () => onRegister(item) : undefined}
                onEditDate={
                  isAdmin
                    ? () => onEditDate({ record: item.record, current: item.nextDue.date })
                    : undefined
                }
              />
            ))}
          </ul>
          {query.hasNextPage ? (
            <Button
              variant="secondary"
              fullWidth
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
            >
              Cargar más
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}

const WEIGHT_PATTERN = /^(?:0[.,]\d{1,2}|[1-9]\d{0,3}(?:[.,]\d{1,2})?)$/;
type SubmitPhase = 'idle' | 'retry' | 'pending';

/**
 * "➕ Nuevo registro" — cualquier usuario autenticado; persona = la sesión.
 * Con `fulfilling` («Registrar aplicación / control»), el tipo queda fijo y
 * la atención cumple ESE pendiente (y solo ese) en la misma transacción; la
 * persona confirma la fecha real y puede programar la siguiente.
 */
function RecordForm({
  petId,
  today,
  fulfilling,
  onFulfillDone,
  onSessionExpired,
}: {
  petId: string;
  today: string;
  fulfilling: PetDueItem | null;
  onFulfillDone: () => void;
  onSessionExpired: () => void;
}) {
  const formId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const { afterRecordChange } = usePetsCache();
  const { isSubmitting, run } = useSubmitGuard();
  const intentRef = useRef(new IdempotencyIntent());
  const [type, setType] = useState<MedicalRecordType>(fulfilling?.record.type ?? 'VACCINE');
  const [date, setDate] = useState<string | null>(null);
  const [weight, setWeight] = useState('');
  const [description, setDescription] = useState(fulfilling?.record.description ?? '');
  const [nextDueDate, setNextDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  const effectiveDate = date ?? today;
  const locked = phase === 'pending';
  const allowsNextDue = type !== 'WEIGHT';

  // Al elegir un pendiente («Registrar aplicación / control»): tipo y
  // descripción de la atención programada y fecha real a confirmar. Se ajusta
  // durante el render (patrón de React para estado derivado de una prop); al
  // terminar, el aviso de éxito se conserva. La clave de idempotencia cambia
  // sola: el cuerpo incluye el pendiente.
  const fulfillingId = fulfilling?.record.id ?? null;
  const [syncedFulfillingId, setSyncedFulfillingId] = useState(fulfillingId);
  if (fulfillingId !== syncedFulfillingId) {
    setSyncedFulfillingId(fulfillingId);
    if (fulfilling) {
      setType(fulfilling.record.type);
      setDescription(fulfilling.record.description ?? '');
      setDate(null);
      setWeight('');
      setNextDueDate('');
      setPhase('idle');
      setError(null);
      setSuccess(null);
    }
  }
  useEffect(() => {
    if (!fulfillingId) return;
    cardRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    document.getElementById(`${formId}-date`)?.focus({ preventScroll: true });
  }, [fulfillingId, formId]);

  function change(apply: () => void): void {
    apply();
    intentRef.current.discard();
    setPhase('idle');
    setError(null);
    setSuccess(null);
  }

  function validate(): string | CreatePetRecordRequest {
    if (!effectiveDate) return 'Seleccioná la fecha.';
    if (effectiveDate > today) return 'La fecha no puede ser futura.';
    const normalizedWeight = weight.trim();
    if (type === 'WEIGHT') {
      if (!normalizedWeight) return 'Ingresá el peso.';
      if (!WEIGHT_PATTERN.test(normalizedWeight) || /^0([.,]0+)?$/.test(normalizedWeight)) {
        return 'El peso debe ser un número positivo de hasta 9999,99 kg.';
      }
    }
    const text = description.replace(/\s+/g, ' ').trim();
    if (text.length > 300) return 'La descripción no puede superar 300 caracteres.';
    if (/[<>]/.test(text)) return 'La descripción no puede contener HTML.';
    if (allowsNextDue && nextDueDate && nextDueDate <= effectiveDate) {
      return 'La fecha de próxima aplicación o control debe ser posterior a la de la atención.';
    }
    const body: CreatePetRecordRequest = { type, recordDate: effectiveDate };
    if (type === 'WEIGHT') body.weightKg = normalizedWeight.replace(',', '.');
    if (text) body.description = text;
    if (allowsNextDue && nextDueDate) body.nextDueDate = nextDueDate;
    if (fulfilling) body.fulfillsRecordId = fulfilling.record.id;
    return body;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // Un segundo clic justo después de guardar (sin tocar el formulario) no es
    // un envío nuevo: se conserva el aviso de éxito (mismo criterio que el
    // Gallinero). Cualquier cambio de campo vuelve a habilitar el envío.
    if (success) return;
    const result = validate();
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    void run(async () => {
      setError(null);
      setSuccess(null);
      const key = intentRef.current.keyFor(intentFingerprint(petId, result));
      try {
        await createPetRecord(petId, result, key);
        intentRef.current.discard();
        setPhase('idle');
        setWeight('');
        setDescription('');
        setNextDueDate('');
        setSuccess(
          fulfilling
            ? `${RECORD_TAG_LABEL[result.type]} registrada: la atención programada quedó cumplida.`
            : `Registro guardado: ${RECORD_TAG_LABEL[result.type]}.`,
        );
        afterRecordChange(petId);
        if (fulfilling) onFulfillDone();
      } catch (caught) {
        if (isSessionExpired(caught)) {
          onSessionExpired();
          return;
        }
        if (errorCodeOf(caught) === 'IDEMPOTENCY_RECORD_PENDING') setPhase('pending');
        else if (!(caught instanceof ApiError) || caught.status >= 500) setPhase('retry');
        else {
          intentRef.current.discard();
          setPhase('idle');
        }
        setError(
          (caught instanceof ApiError && caught.status < 500) || caught instanceof OfflineError
            ? errorMessageOf(caught)
            : 'No pudimos confirmar el registro. Podés reintentar: no se guardará dos veces.',
        );
      }
    });
  }

  const disabled = isSubmitting || locked;
  return (
    <div ref={cardRef}>
      <Card
        title={
          <>
            <span aria-hidden="true">➕ </span>
            {fulfilling ? fulfillActionLabel(fulfilling.record.type) : 'Nuevo registro'}
          </>
        }
      >
        {fulfilling ? (
          <p className="notice notice--info pet-record-form__fulfilling" role="status">
            <span>
              Cumple: {RECORD_TAG_LABEL[fulfilling.record.type]}
              {fulfilling.record.description ? ` «${fulfilling.record.description}»` : ''},
              programada para el {formatDate(fulfilling.nextDue.date)} (
              {dueRelativeText(fulfilling.nextDue).toLowerCase()}).
            </span>
            <Button size="sm" variant="ghost" disabled={isSubmitting} onClick={onFulfillDone}>
              Cancelar
            </Button>
          </p>
        ) : null}
        <form
          className="pet-record-form"
          onSubmit={handleSubmit}
          noValidate
          aria-label="Nuevo registro"
        >
          <div className="pet-form__row">
            <div className="field">
              <label className="field__label" htmlFor={`${formId}-type`}>
                Tipo
              </label>
              <select
                id={`${formId}-type`}
                className="field__input"
                value={type}
                // El tipo del pendiente a cumplir no se cambia.
                disabled={disabled || fulfilling !== null}
                onChange={(event) => {
                  const next = event.target.value as MedicalRecordType;
                  change(() => setType(next));
                }}
              >
                {RECORD_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {RECORD_OPTION_LABEL[option]}
                  </option>
                ))}
              </select>
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
                  change(() => setDate(next));
                }}
              />
            </div>
          </div>
          {type === 'WEIGHT' ? (
            <div className="field">
              <label className="field__label" htmlFor={`${formId}-weight`}>
                Peso (kg)
              </label>
              <input
                id={`${formId}-weight`}
                className="field__input pet-record-form__weight"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0,0"
                value={weight}
                disabled={disabled}
                onChange={(event) => {
                  const next = event.target.value;
                  change(() => setWeight(next));
                }}
              />
            </div>
          ) : null}
          <div className="field">
            <label className="field__label" htmlFor={`${formId}-description`}>
              Descripción
            </label>
            <input
              id={`${formId}-description`}
              className="field__input"
              maxLength={300}
              autoComplete="off"
              placeholder="Ej: Vacuna antirrábica, Triple viral..."
              value={description}
              disabled={disabled}
              onChange={(event) => {
                const next = event.target.value;
                change(() => setDescription(next));
              }}
            />
          </div>
          {allowsNextDue ? (
            <div className="field">
              <label className="field__label" htmlFor={`${formId}-next-due`}>
                Fecha de próxima aplicación o control
              </label>
              <input
                id={`${formId}-next-due`}
                className="field__input"
                type="date"
                min={effectiveDate ? nextDay(effectiveDate) : undefined}
                value={nextDueDate}
                disabled={disabled}
                aria-describedby={`${formId}-next-due-hint`}
                onChange={(event) => {
                  const next = event.target.value;
                  change(() => setNextDueDate(next));
                }}
              />
              <p className="field__hint" id={`${formId}-next-due-hint`}>
                Opcional, según la indicación veterinaria. Tiene que ser posterior a la fecha de la
                atención.
              </p>
            </div>
          ) : null}
          <div aria-live="polite" className="live-status live-status--start">
            {isSubmitting ? (
              <span role="status">{locked ? 'Consultando…' : 'Guardando…'}</span>
            ) : null}
            {error ? (
              <span role="alert">
                <AlertIcon size="sm" />
                {error}
              </span>
            ) : null}
            {success ? (
              <span role="status" className="pet-record-form__success">
                <CheckCircleIcon size="sm" />
                {success}
              </span>
            ) : null}
          </div>
          <Button type="submit" fullWidth loading={isSubmitting}>
            {locked
              ? 'Consultar estado'
              : phase === 'retry'
                ? 'Reintentar'
                : fulfilling
                  ? fulfillActionLabel(fulfilling.record.type)
                  : 'Guardar registro'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

/** Historial clínico filtrable y paginado; "✕" solo ADMIN (anulación con confirmación). */
function RecordHistory({
  petId,
  isAdmin,
  onEditDate,
  onSessionExpired,
}: {
  petId: string;
  isAdmin: boolean;
  onEditDate: (target: NextDueTarget) => void;
  onSessionExpired: () => void;
}) {
  const { userId, enabled } = useSessionScope();
  const { afterRecordChange } = usePetsCache();
  const [filter, setFilter] = useState<MedicalRecordType | 'all'>('all');
  const [toVoid, setToVoid] = useState<PetRecord | null>(null);
  const query = useInfiniteQuery({
    queryKey: queryKeys.pets.records(userId, petId, filter),
    queryFn: ({ pageParam }) =>
      fetchPetRecords(petId, {
        type: filter === 'all' ? undefined : filter,
        page: pageParam,
        pageSize: RECORDS_PAGE_SIZE,
      }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled,
    staleTime: STALE_TIME.operational,
    placeholderData: keepPreviousData,
  });
  const expired = isSessionExpired(query.error);
  useEffect(() => {
    if (expired) onSessionExpired();
  }, [expired, onSessionExpired]);
  useBusinessDayRefresh(query.data?.pages[0]?.refreshAt);

  const seen = new Set<string>();
  const records = (query.data?.pages.flatMap((page) => page.records) ?? []).filter((record) =>
    seen.has(record.id) ? false : (seen.add(record.id), true),
  );

  return (
    <section className="pet-history" aria-label="Historial clínico">
      <div className="filter-scroller" role="group" aria-label="Filtrar registros">
        {RECORD_FILTERS.map((option) => (
          <Chip
            key={option.value}
            selected={filter === option.value}
            onSelect={() => setFilter(option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>
      <Card>
        {!query.data ? (
          query.isError ? (
            <ErrorState
              title="No pudimos cargar el historial"
              description={errorMessageOf(query.error)}
              onRetry={() => void query.refetch()}
            />
          ) : (
            <LoadingState label="Cargando historial…" />
          )
        ) : records.length === 0 ? (
          <EmptyState titleAs="p" title="Sin registros en esta categoría" />
        ) : (
          <div className={query.isPlaceholderData ? 'is-stale' : undefined}>
            <ul className="pet-history__list" aria-label="Registros clínicos">
              {records.map((record) => {
                const person = attributedName(record);
                return (
                  <li key={record.id} className="pet-history__item">
                    <div className="pet-history__head">
                      <span className="pet-history__tag">{RECORD_TAG_LABEL[record.type]}</span>
                      <span className="pet-history__date">{formatDate(record.recordDate)}</span>
                      {person ? <span className="pet-history__person">{person}</span> : null}
                      {isAdmin ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="pet-history__void"
                          aria-label={`Eliminar registro ${RECORD_TAG_LABEL[record.type]} del ${formatDate(record.recordDate)}`}
                          onClick={() => setToVoid(record)}
                        >
                          <span aria-hidden="true">✕</span>
                        </Button>
                      ) : null}
                    </div>
                    {record.weightKg || record.description ? (
                      <p className="pet-history__text">
                        {record.weightKg ? <strong>{formatKg(record.weightKg)} kg </strong> : null}
                        {record.description}
                      </p>
                    ) : null}
                    {record.nextDue || record.fulfills ? (
                      <p className="pet-history__due">
                        {record.nextDue ? (
                          <span>
                            <span aria-hidden="true">📅 </span>Próxima:{' '}
                            {formatDate(record.nextDue.date)} ·{' '}
                            {record.nextDue.status === 'FULFILLED' && record.nextDue.fulfilledBy
                              ? `Cumplida el ${formatDate(record.nextDue.fulfilledBy.recordDate)}`
                              : `${DUE_STATUS_LABEL[record.nextDue.status]} · ${dueRelativeText(record.nextDue)}`}
                          </span>
                        ) : null}
                        {record.nextDue && record.fulfills ? ' · ' : null}
                        {record.fulfills ? (
                          <span>
                            Cumple la atención programada del{' '}
                            {formatDate(record.fulfills.recordDate)}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    {isAdmin &&
                    record.type !== 'WEIGHT' &&
                    record.nextDue?.status !== 'FULFILLED' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          onEditDate({ record, current: record.nextDue?.date ?? null })
                        }
                      >
                        {record.nextDue ? 'Corregir fecha próxima' : 'Programar próxima fecha'}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {query.hasNextPage ? (
              <Button
                variant="secondary"
                fullWidth
                loading={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
              >
                Cargar más
              </Button>
            ) : null}
          </div>
        )}
      </Card>
      {toVoid ? (
        <ConfirmDialog
          title="¿Eliminar este registro?"
          description={`${RECORD_TAG_LABEL[toVoid.type]} del ${formatDate(toVoid.recordDate)}. Deja de contar en la ficha; queda en la auditoría.`}
          confirmLabel="Eliminar"
          tone="danger"
          onCancel={() => setToVoid(null)}
          onConfirm={async () => {
            try {
              await voidPetRecord(petId, toVoid.id);
              setToVoid(null);
              afterRecordChange(petId);
            } catch (caught) {
              if (isSessionExpired(caught)) {
                setToVoid(null);
                onSessionExpired();
                return;
              }
              if (caught instanceof ApiError && caught.status === 409) afterRecordChange(petId);
              throw humanError(caught);
            }
          }}
        />
      ) : null}
    </section>
  );
}
