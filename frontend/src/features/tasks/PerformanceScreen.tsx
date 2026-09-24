import { useCallback, useEffect, useState } from 'react';
import { fetchEmployeePerformance, fetchPerformance } from '../../api/performanceApi';
import type { PerformanceResponse } from '../../api/performanceTypes';
import { useAuth } from '../../auth/useAuth';
import { Avatar } from '../../components/ui/Avatar';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { TasksSubnav } from './TasksSubnav';

type Preset = 7 | 30 | 90;
const localDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
const presetRange = (days: Preset) => {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days + 1);
  return { from: localDate(from), to: localDate(to) };
};
const percentageLabel = (value: number | null) =>
  value === null ? 'Sin datos' : `${value.toLocaleString('es-AR')}%`;

export function PerformanceScreen() {
  const { user, logout } = useAuth();
  const [preset, setPreset] = useState<Preset>(7);
  const [data, setData] = useState<PerformanceResponse | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<PerformanceResponse | null>(null);
  const range = presetRange(preset);

  const load = useCallback(() => {
    setError(false);
    setData(null);
    fetchPerformance(range.from, range.to)
      .then(setData)
      .catch((reason: unknown) => {
        if (reason && typeof reason === 'object' && 'status' in reason && reason.status === 401)
          void logout();
        setError(true);
      });
  }, [range.from, range.to, logout]);

  useEffect(() => {
    fetchPerformance(range.from, range.to)
      .then(setData)
      .catch((reason: unknown) => {
        if (reason && typeof reason === 'object' && 'status' in reason && reason.status === 401)
          void logout();
        setError(true);
      });
  }, [range.from, range.to, logout]);
  useEffect(() => {
    if (!selected) return;
    fetchEmployeePerformance(selected, range.from, range.to)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [selected, range.from, range.to]);

  return (
    <div className="performance">
      <PageHeader
        title={
          <>
            <span aria-hidden="true">📊 </span>Desempeño
          </>
        }
        description="Cumplimiento de las tareas recurrentes y trabajo realizado, con cada número verificable."
      />
      <TasksSubnav active="performance" />
      <div className="filter-scroller" aria-label="Período">
        {([7, 30, 90] as const).map((days) => (
          <Chip
            key={days}
            selected={preset === days}
            onSelect={() => {
              setData(null);
              setError(false);
              setSelected(null);
              setDetail(null);
              setPreset(days);
            }}
          >
            {days === 7 ? 'Esta semana' : `Últimos ${days} días`}
          </Chip>
        ))}
      </div>
      {error ? (
        <Card>
          <ErrorState title="No pudimos cargar el desempeño." onRetry={load} />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingState label="Calculando desempeño…" />
        </Card>
      ) : (
        <>
          {data.range.includesCurrentDay ? (
            <p className="performance__note">
              El día de hoy está en curso: solo cuenta lo esperado hasta este momento.
            </p>
          ) : null}
          <section className="performance__summary" aria-label="Resumen">
            <Card>
              <span>Cumplimiento</span>
              <strong>{percentageLabel(data.team.percentage)}</strong>
            </Card>
            <Card>
              <span>📅 Esperadas</span>
              <strong>{data.team.expected}</strong>
            </Card>
            <Card>
              <span>✅ Completadas</span>
              <strong>{data.team.completed}</strong>
            </Card>
            <Card>
              <span>🤝 Coberturas</span>
              <strong>{data.team.coveredOthers}</strong>
            </Card>
            {data.special.urgentPending !== null ? (
              <Card>
                <span>🚨 Urgentes pendientes</span>
                <strong>{data.special.urgentPending}</strong>
              </Card>
            ) : null}
          </section>
          <Card>
            <h2>{user?.role === 'ADMIN' ? 'Equipo' : 'Mi desempeño'}</h2>
            {data.employees.length === 0 ? (
              <EmptyState title="Sin información para este período." />
            ) : (
              <ul className="performance-list">
                {data.employees.map((row) => (
                  <li key={row.employee.id}>
                    <button
                      type="button"
                      className="performance-person"
                      onClick={() => setSelected(row.employee.id)}
                    >
                      <Avatar name={row.employee.displayName} colorHex={row.employee.colorHex} />
                      <span className="performance-person__identity">
                        <strong>{row.employee.displayName}</strong>
                        <small>{row.employee.role}</small>
                      </span>
                      <span className="performance-person__score">
                        <strong>{percentageLabel(row.percentage)}</strong>
                        <small>
                          {row.completed}/{row.expected}
                        </small>
                      </span>
                      <progress
                        max="100"
                        value={row.percentage ?? 0}
                        aria-label={`Cumplimiento de ${row.employee.displayName}: ${percentageLabel(row.percentage)}`}
                      />
                      <span className="performance-person__facts">
                        Realizó {row.performed} · Cubrió {row.coveredOthers} · Recibió ayuda{' '}
                        {row.receivedHelp} · 🔥{' '}
                        {row.dailyStreak === null ? 'Sin datos' : `${row.dailyStreak} días`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {selected && detail ? (
            <Card>
              <div className="performance-detail__header">
                <h2>Detalle</h2>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => {
                    setSelected(null);
                    setDetail(null);
                  }}
                >
                  Cerrar
                </button>
              </div>
              <ul className="performance-detail">
                {detail.occurrences?.map((item) => (
                  <li key={`${item.taskId}-${item.periodKey}`}>
                    <span>
                      <strong>{item.description}</strong>
                      <small>
                        {item.periodKey} · {item.frequency} · asignada a{' '}
                        {item.assignedEmployee?.displayName ?? 'Sin responsable'}
                        {item.completedByEmployee
                          ? ` · realizada por ${item.completedByEmployee.displayName}`
                          : ''}
                      </small>
                    </span>
                    <span>{item.completed ? '✅ Completada' : 'Pendiente'}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
