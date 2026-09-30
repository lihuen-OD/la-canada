import type { StockItem } from '../../api/stockTypes';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { LEVEL_LABEL, LEVEL_TONE } from './stockLabels';
import { stockBarPercent } from './stockStatus';

interface StockItemCardProps {
  item: StockItem;
  isAdmin: boolean;
  onMovement: (item: StockItem, kind: 'income' | 'consumption' | 'adjustment') => void;
  onDetail: (item: StockItem) => void;
}

/**
 * Un producto del inventario con la fila compacta del prototipo (`.si`):
 * nombre, barra + cantidades y la etiqueta de nivel; a la derecha 📤
 * (movimiento), ⚙️ (ajuste, ADMIN) y 📋 (historial). Con objetivo: "actual /
 * objetivo unidad · mín." y la barra actual / objetivo (tope visual 100%: el
 * stock puede superar el objetivo). Sin objetivo (producto anterior), la fila
 * de siempre: "actual / mínimo unidad" y la barra previa. El nivel es
 * `item.stockLevel`, calculado por el backend; la barra es solo su
 * representación visual. Los movimientos de un producto desactivado quedan
 * deshabilitados — el backend también los rechaza.
 */
export function StockItemCard({ item, isAdmin, onMovement, onDetail }: StockItemCardProps) {
  const level = item.stockLevel;
  const percent = stockBarPercent(item.currentQuantity, item.minimumQuantity, item.targetQuantity);
  const hasTarget = item.targetQuantity !== null;

  return (
    <li className="stock-item">
      <div className="stock-item__info">
        <p className="stock-item__name">
          {item.name}
          {!item.active ? <Badge tone="neutral">Desactivado</Badge> : null}
        </p>
        <div className="stock-item__level">
          {percent !== null ? (
            <progress
              className={`stock-item__bar stock-item__bar--${level}`}
              max={100}
              value={percent}
              aria-hidden="true"
            />
          ) : null}
          <span className="stock-item__quantity">
            <span className="visually-hidden">Actual: </span>
            {item.currentQuantity}
            <span aria-hidden="true"> / </span>
            {hasTarget ? (
              <>
                <span className="visually-hidden">, objetivo: </span>
                {item.targetQuantity} {item.unit}
                <span aria-hidden="true"> · </span>
                <span className="visually-hidden">, </span>mín. {item.minimumQuantity}
              </>
            ) : (
              <>
                <span className="visually-hidden">, mínimo: </span>
                {item.minimumQuantity} {item.unit}
              </>
            )}
          </span>
          <Badge tone={LEVEL_TONE[level]}>{LEVEL_LABEL[level]}</Badge>
        </div>
      </div>

      <div className="stock-item__actions">
        <Button
          size="sm"
          className="icon-button"
          aria-label={`Registrar movimiento: ${item.name}`}
          title="Registrar movimiento"
          disabled={!item.active}
          onClick={() => onMovement(item, 'consumption')}
        >
          <span aria-hidden="true">📤</span>
        </Button>
        {isAdmin ? (
          <Button
            size="sm"
            variant="secondary"
            className="icon-button"
            aria-label={`Ajuste: ${item.name}`}
            title="Ajuste"
            disabled={!item.active}
            onClick={() => onMovement(item, 'adjustment')}
          >
            <span aria-hidden="true">⚙️</span>
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className="icon-button"
          aria-label={`Historial: ${item.name}`}
          title="Historial"
          onClick={() => onDetail(item)}
        >
          <span aria-hidden="true">📋</span>
        </Button>
      </div>
    </li>
  );
}
