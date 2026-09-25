import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { fetchChickenCoopSummary } from '../../api/chickenCoopApi';
import type { ChickenCoopPeriodDays, ChickenCoopSummary } from '../../api/chickenCoopTypes';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { AlertIcon } from '../../components/ui/icons';
import { CollectionForm } from './CollectionForm';
import { CollectionHistory } from './CollectionHistory';
import { HensCard } from './HensCard';
import { PeriodAnalysis } from './PeriodAnalysis';
import { errorMessageOf, isSessionExpired } from './chickenCoopErrors';
import { formatRate, layingTone } from './chickenCoopLabels';
import type { BadgeTone } from '../../components/ui/Badge';

/**
 * 🐔 Gallinero (Etapa 5G) — pantalla del prototipo (`pg-gallinero`,
 * docs/BUSINESS_RULES.md §9) en el mismo orden: KPIs, gallinas activas,
 * registrar recolección, análisis por período e historial. Datos solo vía
 * TanStack Query (resumen por período + historial paginado), sin estado
 * persistido; KPIs y posturas los calcula el backend.
 */
export function ChickenCoopScreen() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { userId, enabled } = useSessionScope();
  const [days, setDays] = useState<ChickenCoopPeriodDays>(7);
  const handleSessionExpired = useCallback(() => {
    void logout();
  }, [logout]);

  const summaryQuery = useQuery({
    queryKey: queryKeys.chickenCoop.summary(userId, days),
    queryFn: () => fetchChickenCoopSummary(days),
    enabled,
    staleTime: STALE_TIME.operational,
    placeholderData: keepPreviousData,
  });
  const summary = summaryQuery.data;
  const expired = isSessionExpired(summaryQuery.error);
  useEffect(() => {
    if (expired) handleSessionExpired();
  }, [expired, handleSessionExpired]);
  const refreshing = Boolean(summary) && summaryQuery.isFetching;
  const changingPeriod = summaryQuery.isPlaceholderData;

  return (
    <div className="coop">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">🐔 </span>Gallinero
          </>
        }
        description="Registro de postura y recolección"
        refreshing={refreshing}
      />

      {!summary ? (
        summaryQuery.isError ? (
          <ErrorState
            title="No pudimos cargar el gallinero"
            description={errorMessageOf(summaryQuery.error)}
            onRetry={() => void summaryQuery.refetch()}
          />
        ) : (
          <LoadingState label="Cargando gallinero…" />
        )
      ) : (
        <>
          {summaryQuery.isError && !summaryQuery.isFetching ? (
            <p role="alert" className="notice notice--danger">
              <AlertIcon size="sm" />
              No pudimos actualizar el gallinero. Se muestran los últimos datos.
              <Button size="sm" variant="ghost" onClick={() => void summaryQuery.refetch()}>
                Reintentar
              </Button>
            </p>
          ) : null}
          <CoopKpis summary={summary} stale={changingPeriod} />
          <HensCard coop={summary.coop} isAdmin={isAdmin} onSessionExpired={handleSessionExpired} />
          <CollectionForm today={summary.today.date} onSessionExpired={handleSessionExpired} />
          <PeriodAnalysis
            summary={summary}
            days={days}
            onDaysChange={setDays}
            stale={changingPeriod}
          />
          <CollectionHistory isAdmin={isAdmin} onSessionExpired={handleSessionExpired} />
        </>
      )}
    </div>
  );
}

const KPI_TONE_CLASS: Record<BadgeTone, string> = {
  positive: 'coop-kpi--positive',
  warning: 'coop-kpi--warning',
  danger: 'coop-kpi--danger',
  info: 'coop-kpi--info',
  earth: 'coop-kpi--info',
  neutral: 'coop-kpi--neutral',
};

/** Los 4 KPIs del prototipo, con sus tonos (≥70% bien, ≥50% atención, menos alerta). */
function CoopKpis({ summary, stale }: { summary: ChickenCoopSummary; stale: boolean }) {
  const kpis: { label: string; value: string; tone: BadgeTone }[] = [
    { label: 'Huevos hoy', value: String(summary.today.goodEggs), tone: 'positive' },
    {
      label: 'Postura hoy',
      value: formatRate(summary.today.layingRate),
      tone: layingTone(summary.today.layingRate),
    },
    { label: 'Promedio/día', value: summary.period.averagePerDay, tone: 'info' },
    {
      label: 'Postura período',
      value: formatRate(summary.period.layingRate),
      tone: layingTone(summary.period.layingRate),
    },
  ];
  return (
    <ul className={`coop-kpis${stale ? ' is-stale' : ''}`} aria-label="Indicadores del gallinero">
      {kpis.map((kpi) => (
        <li key={kpi.label}>
          <Card className={`coop-kpi ${KPI_TONE_CLASS[kpi.tone]}`}>
            <p className="coop-kpi__value">{kpi.value}</p>
            <p className="coop-kpi__label">{kpi.label}</p>
          </Card>
        </li>
      ))}
    </ul>
  );
}
