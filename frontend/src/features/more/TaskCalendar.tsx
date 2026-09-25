import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { fetchTasks } from '../../api/tasksApi';
import { useSessionScope } from '../../api/useSessionScope';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { FREQUENCY_LABEL, FREQUENCY_TONE } from '../tasks/taskLabels';
import { tasksForDay } from './calendarDays';
import { MONTHS_LONG, localToday } from './moreLabels';

const WEEKDAYS = ['Do', 'Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá'];

/** 📅 Calendario de tareas de Configuración, sobre la misma caché que la pantalla de Tareas. */
export function TaskCalendar() {
  const { userId, enabled } = useSessionScope();
  const today = localToday();
  const [todayYear, todayMonth, todayDay] = today.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const [cursor, setCursor] = useState({ year: todayYear, month: todayMonth - 1 });
  const [selected, setSelected] = useState<number | null>(null);
  const query = useQuery({
    queryKey: queryKeys.tasks.list(userId, 'active'),
    queryFn: () => fetchTasks('active'),
    enabled,
  });

  if (!query.data) {
    return query.isError ? (
      <ErrorState
        title="No pudimos cargar las tareas"
        titleAs="p"
        onRetry={() => void query.refetch()}
      />
    ) : (
      <LoadingState label="Cargando calendario…" />
    );
  }
  const tasks = query.data.tasks.filter((task) => task.active);
  const { year, month } = cursor;
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const move = (delta: number) => {
    setSelected(null);
    setCursor(({ year: y, month: m }) => {
      const next = m + delta;
      return { year: y + Math.floor(next / 12), month: ((next % 12) + 12) % 12 };
    });
  };
  const dayTasks = selected ? tasksForDay(tasks, year, month, selected) : [];

  return (
    <div className="calendar">
      <div className="calendar__nav">
        <Button size="sm" variant="ghost" aria-label="Mes anterior" onClick={() => move(-1)}>
          ‹
        </Button>
        <p className="calendar__title" aria-live="polite">
          {MONTHS_LONG[month]} {year}
        </p>
        <Button size="sm" variant="ghost" aria-label="Mes siguiente" onClick={() => move(1)}>
          ›
        </Button>
      </div>
      <div className="calendar__grid" role="group" aria-label={`${MONTHS_LONG[month]} ${year}`}>
        {WEEKDAYS.map((weekday) => (
          <span key={weekday} className="calendar__weekday" aria-hidden="true">
            {weekday}
          </span>
        ))}
        {Array.from({ length: firstWeekday }, (_, index) => (
          <span key={`empty-${index}`} aria-hidden="true" />
        ))}
        {Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const isToday = year === todayYear && month === todayMonth - 1 && day === todayDay;
          const count = tasksForDay(tasks, year, month, day).length;
          return (
            <button
              key={day}
              type="button"
              className={[
                'calendar__day',
                isToday ? 'is-today' : '',
                count ? 'has-tasks' : '',
                selected === day ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              aria-pressed={selected === day}
              aria-label={`${day}${isToday ? ', hoy' : ''}${count ? `, ${count} tareas` : ''}`}
              onClick={() => setSelected(day)}
            >
              {day}
            </button>
          );
        })}
      </div>
      {selected && dayTasks.length ? (
        <div className="calendar__day-list">
          <p className="more__eyebrow">Tareas del {selected}</p>
          <ul aria-label={`Tareas del ${selected}`}>
            {dayTasks.map((task) => (
              <li key={task.id} className="calendar__task">
                <Avatar
                  name={task.assignee.displayName}
                  colorHex={task.assignee.colorHex}
                  size="sm"
                />
                <span className="calendar__task-name">{task.description}</span>
                <Badge tone={FREQUENCY_TONE[task.frequency]}>
                  {FREQUENCY_LABEL[task.frequency]}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
