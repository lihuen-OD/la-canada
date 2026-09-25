import { Navigate, Route, Routes } from 'react-router-dom';
import { AccessDeniedScreen } from '../admin/AccessDeniedScreen';
import { RequireRole } from '../../routes/RequireRole';
import { CatalogView } from './CatalogView';
import { InventoryView } from './InventoryView';
import { PurchasesView } from './PurchasesView';
import { ReportsView } from './ReportsView';
import { StockViewStateProvider } from './StockViewStateProvider';

/**
 * 📦 Stock (Etapa 5C.2) — módulo completo con subnavegación SPA
 * (`StockSubnav`): 🏠 Casa (`/stock`), 🌿 Jardín (`/stock/garden`),
 * 🛒 Compras (`/stock/purchases`), 📊 Reportes (`/stock/reports`) y
 * ⚙️ Catálogo (`/stock/catalog`, solo ADMIN — el backend igual rechaza al
 * resto). Rutas descendientes de `/stock/*`: cambiar de vista no recarga el
 * documento ni desmonta el shell, y el proveedor de filtros sobrevive a los
 * cambios de vista. Casa y Jardín son el MISMO inventario parametrizado.
 */
export function StockModule() {
  return (
    <StockViewStateProvider>
      <Routes>
        <Route index element={<InventoryView key="HOUSE" area="HOUSE" />} />
        <Route path="garden" element={<InventoryView key="GARDEN" area="GARDEN" />} />
        <Route path="purchases" element={<PurchasesView />} />
        <Route path="reports" element={<ReportsView />} />
        <Route
          path="catalog"
          element={
            <RequireRole role="ADMIN" fallback={<AccessDeniedScreen />}>
              <CatalogView />
            </RequireRole>
          }
        />
        <Route path="*" element={<Navigate to="/stock" replace />} />
      </Routes>
    </StockViewStateProvider>
  );
}
