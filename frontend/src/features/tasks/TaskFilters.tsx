import type { ReactNode } from 'react';
import type { TaskEmployee, TaskFrequency } from '../../api/taskTypes';
import { Avatar } from '../../components/ui/Avatar';
import { Chip } from '../../components/ui/Chip';
import { FREQUENCY_FILTER_LABEL, FREQUENCY_FILTER_ORDER } from './taskLabels';

export type PersonFilter = 'all' | string;
export type FrequencyFilter = 'all' | TaskFrequency;

interface PersonFilterBarProps {
  employees: TaskEmployee[];
  selected: PersonFilter;
  pendingByEmployee: Map<string, number>;
  onSelect: (value: PersonFilter) => void;
}

interface PersonTabProps {
  selected: boolean;
  onSelect: () => void;
  avatar: ReactNode;
  name: string;
  pending?: number;
  accessibleLabel?: string;
}

/**
 * Pestaña de persona del prototipo (`.ptab`): avatar arriba, nombre y
 * pendientes debajo; la no elegida se atenúa. Botón con `aria-pressed`: el
 * estado nunca depende solo de la opacidad.
 */
function PersonTab({ selected, onSelect, avatar, name, pending, accessibleLabel }: PersonTabProps) {
  return (
    <button
      type="button"
      className={selected ? 'person-tab person-tab--selected' : 'person-tab'}
      aria-pressed={selected}
      aria-label={accessibleLabel}
      onClick={onSelect}
    >
      <span className="person-tab__avatar">{avatar}</span>
      <span className="person-tab__name">{name}</span>
      {pending ? (
        <span className="person-tab__count" aria-hidden={accessibleLabel ? true : undefined}>
          {pending}
        </span>
      ) : null}
    </button>
  );
}

/** "Todos" + una pestaña por empleado activo real (nunca una lista fija). Desplazable en móvil. */
export function PersonFilterBar({
  employees,
  selected,
  pendingByEmployee,
  onSelect,
}: PersonFilterBarProps) {
  return (
    <div className="person-tabs" role="group" aria-label="Filtrar por persona">
      <PersonTab
        selected={selected === 'all'}
        onSelect={() => onSelect('all')}
        avatar={
          <span className="avatar person-tab__all" aria-hidden="true">
            T
          </span>
        }
        name="Todos"
      />
      {employees.map((employee) => {
        const pending = pendingByEmployee.get(employee.id) ?? 0;
        return (
          <PersonTab
            key={employee.id}
            selected={selected === employee.id}
            onSelect={() => onSelect(employee.id)}
            avatar={<Avatar name={employee.displayName} colorHex={employee.colorHex} />}
            name={employee.displayName}
            pending={pending}
            accessibleLabel={`${employee.displayName}, ${pending} pendientes`}
          />
        );
      })}
    </div>
  );
}

interface FrequencyFilterBarProps {
  selected: FrequencyFilter;
  onSelect: (value: FrequencyFilter) => void;
}

/** Las cinco frecuencias reales del enum del backend, con las etiquetas y el orden de los chips del prototipo. */
export function FrequencyFilterBar({ selected, onSelect }: FrequencyFilterBarProps) {
  return (
    <div className="filter-scroller" role="group" aria-label="Filtrar por frecuencia">
      <Chip selected={selected === 'all'} onSelect={() => onSelect('all')}>
        Todas
      </Chip>
      {FREQUENCY_FILTER_ORDER.map((frequency) => (
        <Chip
          key={frequency}
          selected={selected === frequency}
          onSelect={() => onSelect(frequency)}
        >
          {FREQUENCY_FILTER_LABEL[frequency]}
        </Chip>
      ))}
    </div>
  );
}
