import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ApiError } from '../../api/httpClient';
import { IdempotencyIntent, intentFingerprint } from '../../api/idempotency';
import {
  createPetRecord,
  fetchPet,
  fetchPetRecords,
  fetchPetTypes,
  voidPetRecord,
} from '../../api/petsApi';
import type {
  CreatePetRecordRequest,
  MedicalRecordType,
  PetDetailResponse,
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
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { useSubmitGuard } from '../tasks/useSubmitGuard';
import { PetFormDialog } from './PetFormDialog';
import { PetPhoto } from './PetPhoto';
import { errorCodeOf, errorMessageOf, humanError, isSessionExpired } from './petErrors';
import {
  RECORD_FILTERS,
  RECORD_OPTION_LABEL,
  RECORD_TAG_LABEL,
  RECORD_TYPES,
  ageText,
  formatDate,
  formatKg,
  petSummary,
} from './petLabels';
import { usePetsCache } from './usePetsCache';

const RECORDS_PAGE_SIZE = 20;

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
          <p className="pet-profile__name">{pet.name}</p>
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

      <PetKpis detail={detail} />
      <RecordForm petId={pet.id} today={detail.today} onSessionExpired={handleSessionExpired} />
      <RecordHistory petId={pet.id} isAdmin={isAdmin} onSessionExpired={handleSessionExpired} />

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

const WEIGHT_PATTERN = /^(?:0[.,]\d{1,2}|[1-9]\d{0,3}(?:[.,]\d{1,2})?)$/;
type SubmitPhase = 'idle' | 'retry' | 'pending';

/** "➕ Nuevo registro" — cualquier usuario autenticado; persona = la sesión. */
function RecordForm({
  petId,
  today,
  onSessionExpired,
}: {
  petId: string;
  today: string;
  onSessionExpired: () => void;
}) {
  const formId = useId();
  const { afterRecordChange } = usePetsCache();
  const { isSubmitting, run } = useSubmitGuard();
  const intentRef = useRef(new IdempotencyIntent());
  const [type, setType] = useState<MedicalRecordType>('VACCINE');
  const [date, setDate] = useState<string | null>(null);
  const [weight, setWeight] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [phase, setPhase] = useState<SubmitPhase>('idle');
  const effectiveDate = date ?? today;
  const locked = phase === 'pending';

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
    const body: CreatePetRecordRequest = { type, recordDate: effectiveDate };
    if (type === 'WEIGHT') body.weightKg = normalizedWeight.replace(',', '.');
    if (text) body.description = text;
    return body;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
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
        setSuccess(`Registro guardado: ${RECORD_TAG_LABEL[result.type]}.`);
        afterRecordChange(petId);
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
          caught instanceof ApiError && caught.status < 500
            ? errorMessageOf(caught)
            : 'No pudimos confirmar el registro. Podés reintentar: no se guardará dos veces.',
        );
      }
    });
  }

  const disabled = isSubmitting || locked;
  return (
    <Card
      title={
        <>
          <span aria-hidden="true">➕ </span>Nuevo registro
        </>
      }
    >
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
              disabled={disabled}
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
          {locked ? 'Consultar estado' : phase === 'retry' ? 'Reintentar' : 'Guardar registro'}
        </Button>
      </form>
    </Card>
  );
}

/** Historial clínico filtrable y paginado; "✕" solo ADMIN (anulación con confirmación). */
function RecordHistory({
  petId,
  isAdmin,
  onSessionExpired,
}: {
  petId: string;
  isAdmin: boolean;
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
              {records.map((record) => (
                <li key={record.id} className="pet-history__item">
                  <div className="pet-history__head">
                    <span className="pet-history__tag">{RECORD_TAG_LABEL[record.type]}</span>
                    <span className="pet-history__date">{formatDate(record.recordDate)}</span>
                    {record.employee ? (
                      <span className="pet-history__person">{record.employee.displayName}</span>
                    ) : null}
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
                </li>
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
