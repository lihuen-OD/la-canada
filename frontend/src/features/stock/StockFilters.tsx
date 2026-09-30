import { useId } from 'react';
import type {
  StockCategory,
  StockItemArea,
  StockLevel,
  StockStatusFilter,
} from '../../api/stockTypes';
import { LEVEL_LABEL } from './stockLabels';

const LEVELS: readonly StockLevel[] = ['critical', 'low', 'ok'];

interface StockFiltersProps {
  area: StockItemArea;
  categories: StockCategory[];
  categoryId: string;
  onCategoryIdChange: (categoryId: string) => void;
  stockLevel: StockLevel | '';
  onStockLevelChange: (level: StockLevel | '') => void;
  status: StockStatusFilter;
  onStatusChange: (status: StockStatusFilter) => void;
  /** Solo ADMIN: el backend rechaza `status≠active` con 403 para el resto. */
  isAdmin: boolean;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
}

/**
 * Filtros del inventario de un área — TODOS server-side (categoría, nivel,
 * estado y búsqueda viajan como query de `GET /stock/items`; nada se filtra
 * sobre una página cargada). El área la decide la pestaña (🏠/🌿). La
 * búsqueda la debouncea la vista antes de consultar.
 */
export function StockFilters({
  area,
  categories,
  categoryId,
  onCategoryIdChange,
  stockLevel,
  onStockLevelChange,
  status,
  onStatusChange,
  isAdmin,
  searchInput,
  onSearchInputChange,
}: StockFiltersProps) {
  const searchId = useId();
  const statusId = useId();
  const categoryIdId = useId();
  const levelId = useId();

  // Un filtro de categoría de otra área devolvería siempre vacío: las
  // opciones se limitan al área visible (Ambas aplica a ambas).
  const visibleCategories = categories.filter(
    (category) => category.area === area || category.area === 'BOTH',
  );

  return (
    <div className="stock-filters">
      <div className="stock-filters__row">
        <div className="field stock-filters__field">
          <label className="field__label" htmlFor={searchId}>
            Buscar producto
          </label>
          <input
            id={searchId}
            className="field__input"
            type="search"
            autoComplete="off"
            placeholder="Nombre del producto…"
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
          />
        </div>

        <div className="field stock-filters__field">
          <label className="field__label" htmlFor={categoryIdId}>
            Categoría
          </label>
          <select
            id={categoryIdId}
            className="field__input"
            value={categoryId}
            onChange={(event) => onCategoryIdChange(event.target.value)}
          >
            <option value="">Todas</option>
            {visibleCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {!category.active ? ' (inactiva)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field stock-filters__field">
          <label className="field__label" htmlFor={levelId}>
            Nivel de stock
          </label>
          <select
            id={levelId}
            className="field__input"
            value={stockLevel}
            onChange={(event) => onStockLevelChange(event.target.value as StockLevel | '')}
          >
            <option value="">Todos</option>
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {LEVEL_LABEL[level]}
              </option>
            ))}
          </select>
        </div>

        {isAdmin ? (
          <div className="field stock-filters__field">
            <label className="field__label" htmlFor={statusId}>
              Estado
            </label>
            <select
              id={statusId}
              className="field__input"
              value={status}
              onChange={(event) => onStatusChange(event.target.value as StockStatusFilter)}
            >
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
              <option value="all">Todos</option>
            </select>
          </div>
        ) : null}
      </div>
    </div>
  );
}
