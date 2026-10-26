import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchGardenActivities,
  fetchGardenHistory,
  fetchGardenParticipants,
  revertGardenCompletion,
} from '../../api/kitchenGardenApi';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import type { TaskExecution } from '../../api/taskTypes';
import { useAuth } from '../../auth/useAuth';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { isSessionExpired } from '../tasks/dialogErrors';
import { RevertTaskDialog } from '../tasks/RevertTaskDialog';
import { PersonFilterBar, type PersonFilter } from '../tasks/TaskFilters';
import { TaskHistory, type HistorySource } from '../tasks/TaskHistory';
import { GARDEN_NOUN, toPerson, toTaskHistory } from './gardenAdapters';
import { GARDEN_TITLE } from './gardenTitle';
import { KitchenGardenSubnav } from './KitchenGardenSubnav';
import { useGardenCache } from './useGardenCache';

/** Historial propio de la Huerta, con la misma presentación que el de Tareas. */
const GARDEN_HISTORY: HistorySource = {
  queryKey: queryKeys.kitchenGarden.history,
  fetch: async ({ week, personId }) =>
    toTaskHistory(await fetchGardenHistory({ week, participantId: personId })),
};

type Revert = { activityId: string; description: string; execution: TaskExecution } | null;

/**
 * 🥬 Huerta → Historial: la semana lunes-domingo con el mismo criterio que el
 * historial de Tareas (diarias y semanales por período; el resto por fecha de
 * finalización), filtrable por participante. Muestra a quién estaba asignada
 * y quién la realizó; las únicas completadas se consultan acá.
 */
export function GardenHistoryScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const { afterActivityChange } = useGardenCache();
  const [person, setPerson] = useState<PersonFilter>('all');
  const [revert, setRevert] = useState<Revert>(null);
  // La semana vigente y el día de negocio salen del listado (misma clave: sin request extra si ya está).
  const period = useQuery({
    queryKey: queryKeys.kitchenGarden.activities(userId, 'active'),
    queryFn: () => fetchGardenActivities('active'),
    enabled,
  });
  const participantsQuery = useQuery({
    queryKey: queryKeys.kitchenGarden.participants(userId),
    queryFn: fetchGardenParticipants,
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  const endSession = useCallback(() => void logout(), [logout]);
  const expired = isSessionExpired(period.error) || isSessionExpired(participantsQuery.error);
  useEffect(() => {
    if (expired) endSession();
  }, [expired, endSession]);

  const people = useMemo(
    () => (participantsQuery.data?.participants ?? []).map(toPerson),
    [participantsQuery.data],
  );
  const personName =
    person === 'all' ? null : (people.find((p) => p.id === person)?.displayName ?? null);
  const data = period.data;

  return (
    <div className="tasks garden">
      <PageHeader title={GARDEN_TITLE} />
      <KitchenGardenSubnav />
      {people.length > 0 ? (
        <div className="tasks__filters">
          <PersonFilterBar
            employees={people}
            selected={person}
            pendingByEmployee={new Map()}
            onSelect={setPerson}
          />
        </div>
      ) : null}
      {!data ? (
        <Card>
          {period.isError ? (
            <ErrorState
              title="No pudimos cargar el historial."
              onRetry={() => void period.refetch()}
            />
          ) : (
            <LoadingState label="Cargando historial…" />
          )}
        </Card>
      ) : (
        <TaskHistory
          currentWeekStart={data.period.weekStart}
          today={data.period.today}
          employeeId={person === 'all' ? null : person}
          employeeName={personName}
          source={GARDEN_HISTORY}
          noun={GARDEN_NOUN}
          onSessionExpired={endSession}
          onRevert={(activity, execution) =>
            setRevert({ activityId: activity.id, description: activity.description, execution })
          }
        />
      )}
      {revert ? (
        <RevertTaskDialog
          description={revert.description}
          execution={revert.execution}
          reasonRequired={isAdmin}
          onCancel={() => setRevert(null)}
          onConfirm={async (reason) => {
            try {
              await revertGardenCompletion(revert.activityId, revert.execution.id, reason);
            } catch (error) {
              if (isSessionExpired(error)) endSession();
              throw error;
            }
            setRevert(null);
            afterActivityChange();
          }}
        />
      ) : null}
    </div>
  );
}
