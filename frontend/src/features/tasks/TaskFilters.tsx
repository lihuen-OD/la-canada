import type { TaskEmployee, TaskFrequency } from '../../api/taskTypes';
import { Avatar } from '../../components/ui/Avatar';
import { Chip } from '../../components/ui/Chip';
import { FREQUENCY_EMOJI, FREQUENCY_FILTER_LABEL, FREQUENCY_ORDER } from './taskLabels';

export type PersonFilter = 'all' | string;
export type FrequencyFilter = 'all' | TaskFrequency;

interface PersonFilterBarProps {
  employees: TaskEmployee[];
  selected: PersonFilter;
  pendingByEmployee: Map<string, number>;
  onSelect: (value: PersonFilter) => void;
}

/** "Todos" + un chip por empleado activo real (nunca una lista fija). Desplazable en móvil. */
export function PersonFilterBar({
  employees,
  selected,
  pendingByEmployee,
  onSelect,
}: PersonFilterBarProps) {
  return (
    <div className="filter-scroller" role="group" aria-label="Filtrar por persona">
      <Chip selected={selected === 'all'} onSelect={() => onSelect('all')}>
        Todos
      </Chip>
      {employees.map((employee) => (
        <Chip
          key={employee.id}
          selected={selected === employee.id}
          onSelect={() => onSelect(employee.id)}
          leading={<Avatar name={employee.displayName} colorHex={employee.colorHex} size="sm" />}
          count={pendingByEmployee.get(employee.id) ?? 0}
          accessibleLabel={`${employee.displayName}, ${pendingByEmployee.get(employee.id) ?? 0} pendientes`}
        >
          {employee.displayName}
        </Chip>
      ))}
    </div>
  );
}

interface FrequencyFilterBarProps {
  selected: FrequencyFilter;
  onSelect: (value: FrequencyFilter) => void;
}

/** Las cinco frecuencias reales del enum del backend (`TaskFrequency`), en el orden operativo. */
export function FrequencyFilterBar({ selected, onSelect }: FrequencyFilterBarProps) {
  return (
    <div className="filter-scroller" role="group" aria-label="Filtrar por frecuencia">
      <Chip selected={selected === 'all'} onSelect={() => onSelect('all')}>
        Todas
      </Chip>
      {FREQUENCY_ORDER.map((frequency) => {
        const emoji = FREQUENCY_EMOJI[frequency];
        return (
          <Chip
            key={frequency}
            selected={selected === frequency}
            onSelect={() => onSelect(frequency)}
            leading={emoji ? <span aria-hidden="true">{emoji}</span> : undefined}
          >
            {FREQUENCY_FILTER_LABEL[frequency]}
          </Chip>
        );
      })}
    </div>
  );
}
