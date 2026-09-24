import type { StockItem } from '../../api/stockTypes';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { LEVEL_LABEL, LEVEL_TONE } from './stockLabels';
import { stockBarPercent, stockLevel } from './stockStatus';

interface StockItemCardProps {
  item: StockItem;
  isAdmin: boolean;
  onMovement: (item: StockItem, kind: 'income' | 'consumption' | 'adjustment') => void;
  onDetail: (item: StockItem) => void;
}

/**
 * Un producto del inventario (docs/UI_CONTEXT.md, "Stock"): cantidad y
 * etiqueta textual como información principal, barra de progreso solo
 * cuando el mínimo permite un porcentaje significativo (mínimo 0 → sin
 * barra: 100% fijo sería engañoso). Los movimientos de un producto
 * desactivado quedan deshabilitados — el backend también los rechaza.
 */
export function StockItemCard({ item, isAdmin, onMovement, onDetail }: StockItemCardProps) {
  const level = stockLevel(item.currentQuantity, item.minimumQuantity);
  const percent = stockBarPercent(item.currentQuantity, item.minimumQuantity);
  const accessibleName = item.name;

  return (
    <li className="stock-item" aria-busy={undefined}>
      <div className="stock-item__main">
        <div className="stock-item__text">
          <p className="stock-item__name">{item.name}</p>
          <p className="stock-item__meta">
            {level !== 'ok' ? <span aria-hidden="true">⚠️ </span> : null}
            <Badge tone={LEVEL_TONE[level]}>{LEVEL_LABEL[level]}</Badge>
            {!item.active ? <Badge tone="neutral">Desactivado</Badge> : null}
            <span className="stock-item__min">
              Mínimo: {item.minimumQuantity} {item.unit}
            </span>
          </p>
        </div>
        <p className="stock-item__quantity">
          <span className="stock-item__value">{item.currentQuantity}</span>
          <span className="stock-item__unit">{item.unit}</span>
        </p>
      </div>

      {percent !== null ? (
        <progress
          className={`stock-item__bar stock-item__bar--${level}`}
          max={100}
          value={percent}
          aria-hidden="true"
        />
      ) : null}

      <div className="stock-item__actions">
        <Button
          size="sm"
          variant="secondary"
          disabled={!item.active}
          onClick={() => onMovement(item, 'income')}
        >
          <span aria-hidden="true">➕ </span>Entrada
          <span className="visually-hidden">: {accessibleName}</span>
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!item.active}
          onClick={() => onMovement(item, 'consumption')}
        >
          <span aria-hidden="true">➖ </span>Consumo
          <span className="visually-hidden">: {accessibleName}</span>
        </Button>
        {isAdmin ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={!item.active}
            onClick={() => onMovement(item, 'adjustment')}
          >
            <span aria-hidden="true">⚙️ </span>Ajuste
            <span className="visually-hidden">: {accessibleName}</span>
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => onDetail(item)}>
          <span aria-hidden="true">📋 </span>Historial
          <span className="visually-hidden">: {accessibleName}</span>
        </Button>
      </div>
    </li>
  );
}
