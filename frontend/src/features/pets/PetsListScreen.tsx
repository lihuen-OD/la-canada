import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { fetchPetTypes, fetchPets } from '../../api/petsApi';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Chip } from '../../components/ui/Chip';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon, ChevronRightIcon } from '../../components/ui/icons';
import { PetFormDialog } from './PetFormDialog';
import { PetPhoto } from './PetPhoto';
import { PetTypesDialog } from './PetTypesDialog';
import { errorMessageOf, isSessionExpired } from './petErrors';
import { birthdayNotice, formatKg, petSummary } from './petLabels';
import { usePetsModuleState } from './petsModuleState';

const PAGE_SIZE = 24;

/**
 * 🐾 Mascotas — listado del prototipo (`pg-mascotas`): chips "Todas" + los
 * tipos que tienen mascotas, tarjetas con foto o emoji, tipo · raza · edad,
 * último peso y aviso de cumpleaños. "+ Tipo" y "+ Mascota" solo para
 * ADMIN. Listado paginado ("Cargar más") y catálogo de tipos cacheado 5 min.
 */
export function PetsListScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const navigate = useNavigate();
  const { userId, enabled } = useSessionScope();
  const { typeFilter, setTypeFilter } = usePetsModuleState();
  const [dialog, setDialog] = useState<'none' | 'pet' | 'types'>('none');
  const handleSessionExpired = useCallback(() => {
    void logout();
  }, [logout]);

  const typeStatus = isAdmin ? 'all' : 'active';
  const typesQuery = useQuery({
    queryKey: queryKeys.pets.types(userId, typeStatus),
    queryFn: () => fetchPetTypes(typeStatus),
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  const listQuery = useInfiniteQuery({
    queryKey: queryKeys.pets.list(userId, typeFilter),
    queryFn: ({ pageParam }) =>
      fetchPets({ typeId: typeFilter ?? undefined, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
    enabled,
    staleTime: STALE_TIME.operational,
    placeholderData: keepPreviousData,
  });
  const expired = isSessionExpired(listQuery.error) || isSessionExpired(typesQuery.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);

  const types = typesQuery.data?.types ?? [];
  const chipTypes = types.filter((type) => type.activeAnimalCount > 0 || type.id === typeFilter);
  const seen = new Set<string>();
  const pets = (listQuery.data?.pages.flatMap((page) => page.pets) ?? []).filter((pet) =>
    seen.has(pet.id) ? false : (seen.add(pet.id), true),
  );
  const firstPage = listQuery.data?.pages[0];
  const refreshing =
    Boolean(listQuery.data) && listQuery.isFetching && !listQuery.isFetchingNextPage;

  return (
    <div className="pets">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">🐾 </span>Mascotas
          </>
        }
        refreshing={refreshing}
        actions={
          isAdmin ? (
            <div className="pets__actions">
              <Button
                size="sm"
                variant="secondary"
                disabled={!typesQuery.data}
                onClick={() => setDialog('types')}
              >
                + Tipo
              </Button>
              <Button size="sm" disabled={!typesQuery.data} onClick={() => setDialog('pet')}>
                + Mascota
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="filter-scroller" role="group" aria-label="Filtrar por tipo">
        <Chip selected={typeFilter === null} onSelect={() => setTypeFilter(null)}>
          Todas
        </Chip>
        {chipTypes.map((type) => (
          <Chip
            key={type.id}
            selected={typeFilter === type.id}
            onSelect={() => setTypeFilter(type.id)}
            leading={<span aria-hidden="true">{type.icon}</span>}
          >
            {type.name}
          </Chip>
        ))}
      </div>

      {!listQuery.data ? (
        listQuery.isError ? (
          <ErrorState
            title="No pudimos cargar las mascotas"
            description={errorMessageOf(listQuery.error)}
            onRetry={() => void listQuery.refetch()}
          />
        ) : (
          <LoadingState label="Cargando mascotas…" />
        )
      ) : (
        <div className={listQuery.isPlaceholderData ? 'is-stale' : undefined}>
          {listQuery.isError && !listQuery.isFetching ? (
            <p role="alert" className="notice notice--danger">
              <AlertIcon size="sm" />
              No pudimos actualizar el listado.
              <Button size="sm" variant="ghost" onClick={() => void listQuery.refetch()}>
                Reintentar
              </Button>
            </p>
          ) : null}
          {pets.length === 0 ? (
            <EmptyState icon={<span>🐾</span>} title="Sin mascotas registradas" />
          ) : (
            <ul className="pets__list" aria-label="Mascotas">
              {pets.map((pet) => {
                const notice = birthdayNotice(pet.daysToBirthday);
                return (
                  <li key={pet.id}>
                    <Link to={`/pets/${pet.id}`} className="pet-card">
                      <PetPhoto pet={pet} size="md" />
                      <span className="pet-card__body">
                        <span className="pet-card__name">{pet.name}</span>
                        <span className="pet-card__meta">{petSummary(pet)}</span>
                        {pet.lastWeight ? (
                          <span className="pet-card__weight">
                            <span aria-hidden="true">⚖️ </span>
                            {formatKg(pet.lastWeight.kg)} kg
                          </span>
                        ) : null}
                        {notice ? <span className="pet-card__birthday">{notice}</span> : null}
                      </span>
                      <ChevronRightIcon className="pet-card__chevron" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          {listQuery.hasNextPage ? (
            <Button
              variant="secondary"
              fullWidth
              loading={listQuery.isFetchingNextPage}
              onClick={() => void listQuery.fetchNextPage({ cancelRefetch: false })}
            >
              Cargar más
            </Button>
          ) : null}
        </div>
      )}

      {dialog === 'pet' && typesQuery.data ? (
        <PetFormDialog
          types={typesQuery.data.types}
          today={localToday()}
          photoStorage={firstPage?.photoStorage ?? 'unconfigured'}
          onClose={() => setDialog('none')}
          onSaved={(petId) => {
            setDialog('none');
            navigate(`/pets/${petId}`);
          }}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}
      {dialog === 'types' && typesQuery.data ? (
        <PetTypesDialog
          catalog={typesQuery.data}
          onClose={() => setDialog('none')}
          onSessionExpired={handleSessionExpired}
        />
      ) : null}
    </div>
  );
}

/** Solo para el `max` del selector; el backend vuelve a validar con `BUSINESS_TIME_ZONE`. */
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
