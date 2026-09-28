import { useCallback, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getDashboard } from '../../api/dashboardApi';
import type { DashboardResponse } from '../../api/dashboardTypes';
import { ApiError } from '../../api/httpClient';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { useAuth } from '../../auth/useAuth';
import { Avatar } from '../../components/ui/Avatar';
import { Card } from '../../components/ui/Card';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState } from '../../components/ui/StateMessage';
import { formatDateRange, formatPercentage } from '../../utils/dateFormat';

const EVENT_ICON: Record<string, string> = {
  VISIT: '👥',
  BIRTHDAY: '🎂',
  MAINTENANCE: '🔧',
  OTHER: '📌',
};
const areaLabel = (area: 'HOUSE' | 'GARDEN') => (area === 'HOUSE' ? 'Casa' : 'Jardín');
const stockLabel = (level: 'low' | 'critical') => (level === 'critical' ? 'Crítico' : 'Bajo');
const stockPercent = (current: string, minimum: string) => {
  const min = Number(minimum);
  return min <= 0 ? 100 : Math.min(100, Math.round((Number(current) / (min * 2)) * 100));
};

function newsAge(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return 'hace un momento';
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)} h`;
  return `hace ${Math.floor(seconds / 86400)} días`;
}

/** Inicio real: réplica de `rndInicio` del prototipo, alimentada por un único DTO agregado. */
export function AuthenticatedHome() {
  const { logout } = useAuth();
  const { userId, enabled } = useSessionScope();
  const query = useQuery({
    queryKey: queryKeys.dashboard(userId),
    queryFn: getDashboard,
    enabled,
    staleTime: STALE_TIME.operational,
  });
  const expired = query.error instanceof ApiError && query.error.status === 401;
  const endExpiredSession = useCallback(() => void logout(), [logout]);
  useEffect(() => {
    if (expired) endExpiredSession();
  }, [expired, endExpiredSession]);

  if (!query.data) {
    if (query.isError) {
      return (
        <ErrorState
          title="No pudimos cargar Inicio"
          description="Revisá tu conexión e intentá nuevamente."
          onRetry={() => void query.refetch()}
        />
      );
    }
    return <DashboardSkeleton />;
  }
  return <DashboardContent data={query.data} refreshing={query.isFetching} />;
}

function DashboardContent({ data, refreshing }: { data: DashboardResponse; refreshing: boolean }) {
  const { kpis } = data;
  return (
    <div className="home">
      <PageHeader title="Buenos días 👋" refreshing={refreshing} />
      <nav className="home-kpis" aria-label="Indicadores de Inicio">
        <KpiLink
          to="/tasks"
          tone="positive"
          value={`${kpis.tasksCompleted}/${kpis.tasksTotal}`}
          label="Tareas completadas"
        />
        <KpiLink
          to="/tasks"
          tone={kpis.urgentPending ? 'danger' : 'positive'}
          value={kpis.urgentPending}
          label="Urgentes pendientes"
        />
        <KpiLink
          to="/stock/purchases"
          tone={kpis.stockAlerts ? 'warning' : 'positive'}
          value={kpis.stockAlerts}
          label="Alertas de stock"
        />
        <KpiLink to="/chicken-coop" tone="info" value={kpis.goodEggsToday} label="🥚 Huevos hoy" />
      </nav>
      <div className="home-dashboard">
        <div className="home-dashboard__column">
          <DashboardCard title="🚨 Urgentes" to="/tasks" linkLabel="Ver tareas">
            {data.urgentTasks.length ? (
              <ul className="home-list">
                {data.urgentTasks.map((task) => (
                  <li className="home-task" key={task.id}>
                    <Avatar
                      name={task.assignee.displayName}
                      colorHex={task.assignee.colorHex}
                      size="sm"
                    />
                    <span>
                      <strong>{task.description}</strong>
                      <small>{task.assignee.displayName}</small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyText>Sin urgentes 🎉</EmptyText>
            )}
          </DashboardCard>
          <PerformanceCard performance={data.performance} />
        </div>
        <div className="home-dashboard__column">
          <DashboardCard title="⚠️ Stock bajo" to="/stock/purchases" linkLabel="Ver stock">
            {data.stockAlerts.length ? (
              <ul className="home-list">
                {data.stockAlerts.map((item) => (
                  <li className="home-stock" key={item.id}>
                    <span className="home-stock__body">
                      <strong>
                        {item.name} <small>({areaLabel(item.area)})</small>
                      </strong>
                      <span className="home-stock__row">
                        <span className="home-stock__bar" aria-hidden="true">
                          <span
                            className={`is-${item.stockLevel}`}
                            style={{
                              width: `${stockPercent(item.currentQuantity, item.minimumQuantity)}%`,
                            }}
                          />
                        </span>
                        <small>
                          {item.currentQuantity}/{item.minimumQuantity} {item.unit}
                        </small>
                      </span>
                    </span>
                    <span className={`home-stock__badge is-${item.stockLevel}`}>
                      {stockLabel(item.stockLevel)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyText>Todo el stock en orden ✅</EmptyText>
            )}
          </DashboardCard>
          <DashboardCard title="📅 Próximos eventos" to="/more/events" linkLabel="Ver todos">
            {data.upcomingEvents.length ? (
              <ul className="home-list">
                {data.upcomingEvents.map((event) => {
                  const date = new Date(`${event.date}T00:00:00.000Z`);
                  const day = date.getUTCDate();
                  const when =
                    event.daysUntil === 0
                      ? 'Hoy'
                      : event.daysUntil === 1
                        ? 'Mañana'
                        : `En ${event.daysUntil} días`;
                  const monthLabel = new Intl.DateTimeFormat('es-AR', {
                    month: 'short',
                    timeZone: 'UTC',
                  })
                    .format(date)
                    .replace('.', '');
                  return (
                    <li className="home-event" key={event.id}>
                      <time dateTime={event.date}>
                        <strong>{day}</strong>
                        <small>{monthLabel}</small>
                      </time>
                      <span>
                        <strong>
                          {EVENT_ICON[event.type]} {event.title}
                        </strong>
                        <small>{when}</small>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyText>Sin eventos próximos</EmptyText>
            )}
          </DashboardCard>
          <DashboardCard title="📝 Últimas novedades" to="/more/news" linkLabel="Ver novedades">
            {data.latestNews.length ? (
              <ul className="home-list">
                {data.latestNews.map((news) => (
                  <li className="home-news" key={news.id}>
                    <span className="home-news__header">
                      <Avatar
                        name={news.employee.displayName}
                        colorHex={news.employee.colorHex}
                        size="sm"
                      />
                      <strong>{news.employee.displayName}</strong>
                      <small>{newsAge(news.createdAt)}</small>
                    </span>
                    <p>{news.text}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyText>Sin novedades</EmptyText>
            )}
          </DashboardCard>
        </div>
      </div>
    </div>
  );
}

/**
 * Desempeño de Inicio: las cifras llegan ya calculadas por el backend con la
 * misma función que Tareas → Desempeño (acá no se recalcula nada). ADMIN ve
 * "Avance del equipo"; EMPLOYEE, "Mi desempeño" con sus propios números.
 */
function PerformanceCard({ performance }: { performance: DashboardResponse['performance'] }) {
  const self = performance?.scope === 'self';
  const period = performance
    ? `Últimos 7 días · ${formatDateRange(performance.range.from, performance.range.to)}`
    : null;
  const mine = self ? performance?.employees[0] : undefined;
  return (
    <DashboardCard
      title={self ? '🏆 Mi desempeño' : '👥 Avance del equipo'}
      to="/tasks/performance"
      linkLabel="Ver desempeño"
    >
      {period ? <p className="home-period">{period}</p> : null}
      {!performance || performance.employees.length === 0 ? (
        <EmptyText>Sin información de desempeño</EmptyText>
      ) : mine ? (
        <div className="home-mine">
          <p className="home-mine__score">
            <strong>{formatPercentage(mine.percentage)}</strong>
            <span>Cumplimiento personal</span>
          </p>
          <dl className="home-mine__facts">
            <div>
              <dt>Asignadas</dt>
              <dd>{mine.assigned}</dd>
            </div>
            <div>
              <dt>Realizadas personalmente</dt>
              <dd>{mine.completedPersonally}</dd>
            </div>
            <div>
              <dt>Pendientes</dt>
              <dd>{mine.pending}</dd>
            </div>
            <div>
              <dt>Coberturas recibidas</dt>
              <dd>{mine.coverageReceived}</dd>
            </div>
            <div>
              <dt>Coberturas realizadas</dt>
              <dd>{mine.coverageGiven}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <ul className="home-list" aria-label="Cumplimiento personal por persona">
          {performance.employees.map((row) => (
            <li className="home-progress" key={row.employee.id}>
              <Avatar name={row.employee.displayName} colorHex={row.employee.colorHex} size="sm" />
              <span className="home-progress__name">
                {row.employee.displayName}
                <small>
                  {row.completedPersonally}/{row.assigned} realizadas personalmente · Pendientes{' '}
                  {row.pending} · Coberturas recibidas {row.coverageReceived} · realizadas{' '}
                  {row.coverageGiven}
                </small>
              </span>
              <span className="home-progress__bar" aria-hidden="true">
                <span style={{ width: `${row.percentage ?? 0}%` }} />
              </span>
              <strong aria-label={`Cumplimiento personal: ${formatPercentage(row.percentage)}`}>
                {formatPercentage(row.percentage)}
              </strong>
            </li>
          ))}
        </ul>
      )}
    </DashboardCard>
  );
}

function KpiLink({
  to,
  tone,
  value,
  label,
}: {
  to: string;
  tone: string;
  value: string | number;
  label: string;
}) {
  return (
    <Link to={to} className={`home-kpi home-kpi--${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </Link>
  );
}
function DashboardCard({
  title,
  to,
  linkLabel,
  children,
}: {
  title: string;
  to: string;
  linkLabel: string;
  children: ReactNode;
}) {
  return (
    <Card
      title={title}
      actions={
        <Link className="home-card-link" to={to}>
          {linkLabel}
        </Link>
      }
    >
      {children}
    </Card>
  );
}
function EmptyText({ children }: { children: ReactNode }) {
  return <p className="home-empty">{children}</p>;
}
function DashboardSkeleton() {
  return (
    <div className="home" aria-label="Cargando Inicio" role="status">
      <div className="home-skeleton home-skeleton--title" />
      <div className="home-kpis">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="home-kpi home-skeleton" key={index} />
        ))}
      </div>
      <div className="home-dashboard">
        {Array.from({ length: 2 }, (_, index) => (
          <div className="home-dashboard__column" key={index}>
            <div className="card home-skeleton home-skeleton--card" />
            <div className="card home-skeleton home-skeleton--card" />
          </div>
        ))}
      </div>
      <span className="sr-only">Cargando Inicio…</span>
    </div>
  );
}
