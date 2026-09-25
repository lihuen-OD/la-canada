import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchTeamProfiles } from '../../api/moreApi';
import type { TeamFilter } from '../../api/moreTypes';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Avatar } from '../../components/ui/Avatar';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { errorMessageOf, isSessionExpired } from '../pets/petErrors';
import { MoreBackLink } from './MoreBackLink';
import { ageLabel, shortDate } from './moreLabels';

const FILTERS: readonly { value: TeamFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'complete', label: 'Completos' },
  { value: 'incomplete', label: 'Sin datos' },
];

/**
 * 👤 Datos del equipo (`pg-empleados-datos`, solo ADMIN, lectura): ficha e
 * hijos que cada persona cargó en Mi perfil, con filtro completos / sin datos.
 */
export default function TeamScreen() {
  const { logout } = useAuth();
  const { userId, enabled } = useSessionScope();
  const [filter, setFilter] = useState<TeamFilter>('all');
  const handleSessionExpired = useCallback(() => void logout(), [logout]);
  const query = useQuery({
    queryKey: queryKeys.more.team(userId, filter),
    queryFn: () => fetchTeamProfiles(filter),
    enabled,
    placeholderData: keepPreviousData,
  });
  const expired = isSessionExpired(query.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);

  return (
    <div className="more">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">👤 </span>Datos del equipo
          </>
        }
        refreshing={Boolean(query.data) && query.isFetching}
        actions={<MoreBackLink to="/more/settings" />}
      />
      <div className="filter-scroller" role="group" aria-label="Filtrar">
        {FILTERS.map((option) => (
          <Chip
            key={option.value}
            selected={filter === option.value}
            onSelect={() => setFilter(option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>
      {!query.data ? (
        query.isError ? (
          <ErrorState
            title="No pudimos cargar los datos del equipo"
            description={errorMessageOf(query.error)}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <LoadingState label="Cargando datos del equipo…" />
        )
      ) : query.data.team.length === 0 ? (
        <EmptyState title="Sin resultados" />
      ) : (
        <ul
          className={query.isPlaceholderData ? 'team-list is-stale' : 'team-list'}
          aria-label="Equipo"
        >
          {query.data.team.map((member) => {
            const profile = member.profile;
            return (
              <li key={member.id}>
                <Card>
                  <div className="team-card__head">
                    <Avatar name={member.displayName} colorHex={member.colorHex} />
                    <span className="team-card__who">
                      <span className="team-card__name">
                        {profile?.fullLegalName || member.displayName}
                      </span>
                      <span className="more__muted">{member.role}</span>
                    </span>
                    <span
                      className={
                        member.complete ? 'team-card__state is-complete' : 'team-card__state'
                      }
                    >
                      {member.complete ? '✓ Completo' : 'Sin datos'}
                    </span>
                  </div>
                  {member.complete && profile ? (
                    <>
                      <dl className="team-card__data">
                        {profile.birthDate ? (
                          <Datum
                            icon="📅"
                            label="Nacimiento"
                            value={shortDate(profile.birthDate)}
                          />
                        ) : null}
                        {profile.maritalStatus ? (
                          <Datum icon="💍" label="Estado civil" value={profile.maritalStatus} />
                        ) : null}
                        {profile.phone ? (
                          <Datum icon="📱" label="Teléfono" value={profile.phone} />
                        ) : null}
                        {profile.taxId ? (
                          <Datum icon="🪪" label="CUIL" value={profile.taxId} />
                        ) : null}
                        {profile.healthInsurance ? (
                          <Datum icon="🏥" label="Obra social" value={profile.healthInsurance} />
                        ) : null}
                        {profile.emergencyContactName ? (
                          <Datum
                            icon="🆘"
                            label="Emergencia"
                            value={[profile.emergencyContactName, profile.emergencyContactPhone]
                              .filter(Boolean)
                              .join(' ')}
                          />
                        ) : null}
                      </dl>
                      {member.children.length ? (
                        <>
                          <p className="more__eyebrow">Hijos ({member.children.length})</p>
                          <ul
                            className="team-card__children"
                            aria-label={`Hijos de ${member.displayName}`}
                          >
                            {member.children.map((child) => (
                              <li key={child.id} className="team-card__child">
                                {child.name}
                                {child.age ? ` · ${ageLabel(child.age)}` : ''}
                              </li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <p className="more__muted">
                      El empleado puede cargar sus datos desde Más → Mi perfil.
                    </p>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Datum({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="team-card__datum">
      <dt className="visually-hidden">{label}</dt>
      <dd>
        <span aria-hidden="true">{icon} </span>
        {value}
      </dd>
    </div>
  );
}
