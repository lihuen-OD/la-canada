import { useId } from 'react';
import type { StockCategory, StockItemArea, StockStatusFilter } from '../../api/stockTypes';
import { Chip } from '../../components/ui/Chip';
import { AREA_EMOJI, AREA_LABEL } from './stockLabels';

const AREAS: readonly StockItemArea[] = ['HOUSE', 'GARDEN'];

interface StockFiltersProps {
  area: StockItemArea;
  onAreaChange: (area: StockItemArea) => void;
  categories: StockCategory[];
  categoryId: string;
  onCategoryIdChange: (categoryId: string) => void;
  status: StockStatusFilter;
  onStatusChange: (status: StockStatusFilter) => void;
  /** Solo ADMIN: el backend rechaza `status≠active` con 403 para el resto. */
  isAdmin: boolean;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
}

/**
 * Filtros del inventario — TODOS server-side (área, categoría, estado y
 * búsqueda viajan como query de `GET /stock/items`; nada se filtra sobre
 * una página cargada). La búsqueda la debouncea la pantalla madre antes de
 * setear `searchInput` aquí como valor controlado.
 */
export function StockFilters({
  area,
  onAreaChange,
  categories,
  categoryId,
  onCategoryIdChange,
  status,
  onStatusChange,
  isAdmin,
  searchInput,
  onSearchInputChange,
}: StockFiltersProps) {
  const searchId = useId();
  const statusId = useId();
  const categoryIdId = useId();

  // Un filtro de categoría de otra área devolvería siempre vacío: las
  // opciones se limitan al área visible (Ambas aplica a ambas).
  const visibleCategories = categories.filter(
    (category) => category.area === area || category.area === 'BOTH',
  );

  return (
    <div className="stock-filters">
      <div className="filter-scroller" role="group" aria-label="Filtrar por área">
        {AREAS.map((value) => (
          <Chip
            key={value}
            selected={area === value}
            onSelect={() => {
              onAreaChange(value);
              // La categoría elegida puede no pertenecer al nuevo área.
              onCategoryIdChange('');
            }}
            leading={<span aria-hidden="true">{AREA_EMOJI[value]}</span>}
          >
            {AREA_LABEL[value]}
          </Chip>
        ))}
      </div>

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
