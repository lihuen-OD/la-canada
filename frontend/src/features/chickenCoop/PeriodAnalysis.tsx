import type { ChickenCoopPeriodDays, ChickenCoopSummary } from '../../api/chickenCoopTypes';
import { Card } from '../../components/ui/Card';
import { Chip } from '../../components/ui/Chip';
import { EmptyState } from '../../components/ui/StateMessage';
import { PERIOD_OPTIONS, formatRate, formatShortDate } from './chickenCoopLabels';

interface PeriodAnalysisProps {
  summary: ChickenCoopSummary;
  days: ChickenCoopPeriodDays;
  onDaysChange: (days: ChickenCoopPeriodDays) => void;
  /** Revalidando otro período: la vista anterior queda visible, atenuada. */
  stale: boolean;
}

/**
 * "📊 Análisis por período": chips 7 días / 30 días / 3 meses / 1 año,
 * barras de huevos buenos de los últimos min(período, 14) días (hoy
 * destacado) y los totales del período. Todo calculado por el backend.
 */
export function PeriodAnalysis({ summary, days, onDaysChange, stale }: PeriodAnalysisProps) {
  const { period } = summary;
  const max = Math.max(0, ...period.daily.map((day) => day.goodEggs));
  const todayDate = summary.today.date;

  return (
    <Card
      title={
        <>
          <span aria-hidden="true">📊 </span>Análisis por período
        </>
      }
    >
      <div className="filter-scroller" role="group" aria-label="Período de análisis">
        {PERIOD_OPTIONS.map((option) => (
          <Chip
            key={option.days}
            selected={days === option.days}
            onSelect={() => onDaysChange(option.days)}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      <div className={stale ? 'is-stale' : undefined}>
        {period.daysWithData === 0 ? (
          <EmptyState titleAs="p" icon={<span>🥚</span>} title="Sin registros en este período" />
        ) : (
          <>
            <ol
              className="coop-chart"
              aria-label={`Huevos buenos por día, últimos ${period.daily.length} días`}
            >
              {period.daily.map((day) => {
                const height = max > 0 ? Math.round((day.goodEggs / max) * 100) : 0;
                const isToday = day.date === todayDate;
                return (
                  <li
                    key={day.date}
                    className={`coop-chart__day${isToday ? ' is-today' : ''}`}
                    aria-label={`${formatShortDate(day.date)}${isToday ? ' (hoy)' : ''}: ${day.goodEggs} huevos buenos`}
                  >
                    <span className="coop-chart__value" aria-hidden="true">
                      {day.goodEggs > 0 ? day.goodEggs : ''}
                    </span>
                    <span className="coop-chart__track" aria-hidden="true">
                      <span
                        className="coop-chart__bar"
                        style={{ height: `${day.goodEggs > 0 ? Math.max(height, 8) : 0}%` }}
                      />
                    </span>
                    <span className="coop-chart__label" aria-hidden="true">
                      {formatShortDate(day.date)}
                    </span>
                  </li>
                );
              })}
            </ol>
            <dl className="coop-stats">
              <div className="coop-stats__item">
                <dt>Huevos buenos</dt>
                <dd>{period.goodEggs.toLocaleString('es-AR')}</dd>
              </div>
              <div className="coop-stats__item">
                <dt>Huevos rotos</dt>
                <dd>{period.brokenEggs.toLocaleString('es-AR')}</dd>
              </div>
              <div className="coop-stats__item">
                <dt>Postura media</dt>
                <dd>{formatRate(period.layingRate)}</dd>
              </div>
            </dl>
          </>
        )}
      </div>
    </Card>
  );
}
