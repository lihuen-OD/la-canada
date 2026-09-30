import { useCallback, useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchPetDue, fetchPets } from '../../api/petsApi';
import type { DueStatus, MedicalRecordType, PetDueFilters } from '../../api/petTypes';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { NextDueDialog } from './NextDueDialog';
import { PetDueRow } from './PetDueRow';
import { PetsSubnav } from './PetsSubnav';
import { errorMessageOf, isSessionExpired } from './petErrors';
import { DUE_FILTERS, DUE_RECORD_TYPES, RECORD_OPTION_LABEL } from './petLabels';
import { useBusinessDayRefresh } from './useBusinessDayRefresh';

const PAGE_SIZE = 20;
/** Opciones del filtro por mascota: las activas (Vencimientos solo muestra activas). */
const PET_OPTIONS_PAGE_SIZE = 50;

/**
 * 📅 Vencimientos — las atenciones programadas de mascotas activas, por fecha
 * ascendente (primero las vencidas más antiguas). Filtros por mascota, tipo y
 * estado, paginación en el backend. Los estados los calcula el backend con
 * `BUSINESS_TIME_ZONE`; al cambiar el día se revalida solo (sin sondeo).
 */
export function PetDueScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const navigate = useNavigate();
  const { userId, enabled } = useSessionScope();
  const petFieldId = useId();
  const typeFieldId = useId();
  const [petId, setPetId] = useState('');
  const [type, setType] = useState<MedicalRecordType | ''>('');
  const [status, setStatus] = useState<DueStatus | 'open'>('open');
  const [editing, setEditing] = useState<{
    petId: string;
    record: { id: string; type: MedicalRecordType; recordDate: string };
    current: string;
  } | null>(null);
  const handleSessionExpired = useCallback(() => {
    void logout();
  }, [logout]);

  const filters: PetDueFilters = {
    petId: petId || undefined,
    type: type || undefined,
    status: status === 'open' ? undefined : status,
  };
  const query = useInfiniteQuery({
    queryKey: queryKeys.pets.due(userId, filters),
    queryFn: ({ pageParam }) => fetchPetDue({ ...filters, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled,
    staleTime: STALE_TIME.operational,
    placeholderData: keepPreviousData,
  });
  const petsQuery = useQuery({
    queryKey: [...queryKeys.pets.list(userId, null, 'active'), 'options'],
    queryFn: () => fetchPets({ page: 1, pageSize: PET_OPTIONS_PAGE_SIZE }),
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  const expired = isSessionExpired(query.error) || isSessionExpired(petsQuery.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);
  useBusinessDayRefresh(query.data?.pages[0]?.refreshAt);

  const seen = new Set<string>();
  const items = (query.data?.pages.flatMap((page) => page.items) ?? []).filter((item) =>
    seen.has(item.record.id) ? false : (seen.add(item.record.id), true),
  );
  const total = query.data?.pages[0]?.total ?? 0;
  const hasFilters = Boolean(petId || type) || status !== 'open';
  const refreshing = Boolean(query.data) && query.isFetching && !query.isFetchingNextPage;

  return (
    <div className="pets">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">🐾 </span>Mascotas
          </>
        }
        refreshing={refreshing}
      />
      <PetsSubnav />

      <div className="filter-scroller" role="group" aria-label="Filtrar por estado">
        {DUE_FILTERS.map((option) => (
          <Chip
            key={option.value}
            selected={status === option.value}
            onSelect={() => setStatus(option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>
      <div className="pet-form__row">
        <div className="field">
          <label className="field__label" htmlFor={petFieldId}>
            Mascota
          </label>
          <select
            id={petFieldId}
            className="field__input"
            value={petId}
            onChange={(event) => setPetId(event.target.value)}
          >
            <option value="">Todas</option>
            {(petsQuery.data?.pets ?? []).map((pet) => (
              <option key={pet.id} value={pet.id}>
                {pet.type.icon} {pet.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={typeFieldId}>
            Tipo
          </label>
          <select
            id={typeFieldId}
            className="field__input"
            value={type}
            onChange={(event) => setType(event.target.value as MedicalRecordType | '')}
          >
            <option value="">Todos</option>
            {DUE_RECORD_TYPES.map((option) => (
              <option key={option} value={option}>
                {RECORD_OPTION_LABEL[option]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card
        title={
          <>
            <span aria-hidden="true">📅 </span>Vencimientos
          </>
        }
      >
        {!query.data ? (
          query.isError ? (
            <ErrorState
              title="No pudimos cargar los vencimientos"
              description={errorMessageOf(query.error)}
              onRetry={() => void query.refetch()}
            />
          ) : (
            <LoadingState label="Cargando vencimientos…" />
          )
        ) : items.length === 0 ? (
          <EmptyState
            titleAs="p"
            icon={<span>📅</span>}
            title={
              hasFilters ? 'Nada programado con estos filtros.' : 'No hay atenciones programadas.'
            }
            description={
              hasFilters
                ? 'Probá con otra mascota, tipo o estado.'
                : 'Al registrar una vacuna, desparasitación o control podés indicar la fecha de la próxima.'
            }
          />
        ) : (
          <div className={query.isPlaceholderData ? 'is-stale' : undefined}>
            <p className="stock__count" role="status">
              {total} {total === 1 ? 'atención programada' : 'atenciones programadas'}
            </p>
            <ul className="pet-history__list" aria-label="Atenciones programadas">
              {items.map((item) => (
                <PetDueRow
                  key={item.record.id}
                  item={item}
                  showPet
                  onRegister={
                    item.nextDue.status === 'FULFILLED'
                      ? undefined
                      : () => navigate(`/pets/${item.pet.id}?cumplir=${item.record.id}`)
                  }
                  onEditDate={
                    isAdmin && item.nextDue.status !== 'FULFILLED'
                      ? () =>
                          setEditing({
                            petId: item.pet.id,
                            record: item.record,
                            current: item.nextDue.date,
                          })
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
                Cargar más ({items.length} de {total})
              </Button>
            ) : null}
          </div>
        )}
      </Card>

      {editing ? (
        <NextDueDialog
          petId={editing.petId}
          record={editing.record}
          current={editing.current}
          onClose={() => setEditing(null)}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}
    </div>
  );
}
