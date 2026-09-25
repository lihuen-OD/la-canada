import { useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { STALE_TIME } from '../../api/queryClient';
import { queryKeys } from '../../api/queryKeys';
import {
  createStockCategory,
  createStockDestination,
  createStockItem,
  fetchStockCategories,
  fetchStockDestinations,
  fetchStockItems,
  setStockItemActive,
  updateStockCategory,
  updateStockDestination,
  updateStockItem,
} from '../../api/stockApi';
import { useSessionScope } from '../../api/useSessionScope';
import type {
  CreateStockCategoryRequest,
  CreateStockDestinationRequest,
  CreateStockItemRequest,
  StockCategory,
  StockDestination,
  StockItem,
  StockItemsListResponse,
  UpdateStockCategoryRequest,
  UpdateStockDestinationRequest,
  UpdateStockItemRequest,
} from '../../api/stockTypes';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateMessage';
import { ConfirmDialog } from '../admin/ConfirmDialog';
import { CategoryFormDialog } from './CategoryFormDialog';
import { DestinationFormDialog } from './DestinationFormDialog';
import { ItemFormDialog } from './ItemFormDialog';
import { StockNotice, type Notice } from './StockNotice';
import { StockPage } from './StockPage';
import { errorMessageOf, isSessionExpired } from './stockErrors';
import { useSessionExpiry } from './stockHooks';
import { AREA_LABEL, DESTINATION_TYPE_LABEL } from './stockLabels';
import { useStockCache } from './useStockCache';

type CatalogDialogState =
  | { type: 'none' }
  | { type: 'category-form'; category?: StockCategory }
  | { type: 'item-form'; item?: StockItem }
  | { type: 'destination-form'; destination?: StockDestination }
  | { type: 'category-toggle'; category: StockCategory }
  | { type: 'item-toggle'; item: StockItem }
  | { type: 'destination-toggle'; destination: StockDestination };

const PAGE_SIZE = 50;
const CATALOG_ITEM_FILTERS = { status: 'all' as const };

/**
 * ⚙️ Catálogo (solo ADMIN — ruta protegida y, con autoridad final, el
 * backend rechaza al resto con 403). Categorías, productos y destinos de
 * consumo, en TanStack Query (catálogo 5 min; productos 30 s como el resto
 * del inventario). Sin borrado físico: la baja es desactivación, con
 * confirmación. Cada mutación invalida solo lo relacionado.
 */
export function CatalogView() {
  const { userId, enabled } = useSessionScope();
  const cache = useStockCache();
  const [dialog, setDialog] = useState<CatalogDialogState>({ type: 'none' });
  const [notice, setNotice] = useState<Notice>(null);

  const categoriesQuery = useQuery({
    queryKey: queryKeys.stock.categories(userId, 'all'),
    queryFn: () => fetchStockCategories('all'),
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  const destinationsQuery = useQuery({
    queryKey: queryKeys.stock.destinations(userId, 'all'),
    queryFn: () => fetchStockDestinations('all'),
    enabled,
    staleTime: STALE_TIME.catalog,
  });
  const itemsQuery = useInfiniteQuery({
    queryKey: queryKeys.stock.items(userId, CATALOG_ITEM_FILTERS),
    queryFn: ({ pageParam }) =>
      fetchStockItems({ ...CATALOG_ITEM_FILTERS, page: pageParam, pageSize: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last: StockItemsListResponse) =>
      last.page < last.totalPages ? last.page + 1 : undefined,
    enabled,
  });

  const handleSessionExpired = useSessionExpiry(
    categoriesQuery.error,
    destinationsQuery.error,
    itemsQuery.error,
  );

  const pages = itemsQuery.data?.pages;
  const items = useMemo(() => {
    if (!pages) return [];
    const seen = new Set<string>();
    return pages.flatMap((page) =>
      page.items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true))),
    );
  }, [pages]);
  const lastPage = pages?.[pages.length - 1];

  const refreshing =
    (Boolean(categoriesQuery.data) && categoriesQuery.isFetching) ||
    (Boolean(destinationsQuery.data) && destinationsQuery.isFetching) ||
    (Boolean(pages) && itemsQuery.isFetching && !itemsQuery.isFetchingNextPage);

  const closeDialog = () => setDialog({ type: 'none' });
  const done = (text: string, invalidate: () => void) => {
    invalidate();
    closeDialog();
    setNotice({ tone: 'positive', text });
  };

  /** Los diálogos de confirmación muestran el error; un 401 cierra la sesión. */
  async function sessionAware(operation: () => Promise<unknown>): Promise<void> {
    try {
      await operation();
    } catch (error) {
      if (isSessionExpired(error)) handleSessionExpired();
      throw error;
    }
  }

  const categories = categoriesQuery.data?.categories;
  const destinations = destinationsQuery.data?.destinations;

  return (
    <StockPage
      description="Catálogo administrativo: categorías, productos y destinos."
      refreshing={refreshing}
    >
      <StockNotice notice={notice} />
      <div className="stock-catalog">
        <Card
          title="Categorías"
          actions={
            <Button size="sm" onClick={() => setDialog({ type: 'category-form' })}>
              + Nueva categoría
            </Button>
          }
        >
          {!categories ? (
            categoriesQuery.isError ? (
              <ErrorState
                title="No pudimos cargar las categorías."
                onRetry={() => void categoriesQuery.refetch()}
              />
            ) : (
              <LoadingState label="Cargando categorías…" />
            )
          ) : categories.length === 0 ? (
            <EmptyState title="Todavía no hay categorías." description="Creá la primera." />
          ) : (
            <ul className="stock-catalog__list" role="list" aria-label="Categorías de stock">
              {categories.map((category) => (
                <li key={category.id} className="stock-catalog__row">
                  <div className="stock-catalog__text">
                    <span className="stock-catalog__name">{category.name}</span>
                    <span className="stock-catalog__meta">
                      <Badge tone="neutral">{AREA_LABEL[category.area]}</Badge>
                      {!category.active ? <Badge tone="danger">Inactiva</Badge> : null}
                    </span>
                  </div>
                  <div className="stock-catalog__actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog({ type: 'category-form', category })}
                    >
                      Editar
                      <span className="visually-hidden">: {category.name}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={category.active ? 'ghost' : 'secondary'}
                      onClick={() => setDialog({ type: 'category-toggle', category })}
                    >
                      {category.active ? 'Desactivar' : 'Reactivar'}
                      <span className="visually-hidden">: {category.name}</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Productos"
          actions={
            <Button
              size="sm"
              disabled={!categories}
              onClick={() => setDialog({ type: 'item-form' })}
            >
              + Nuevo producto
            </Button>
          }
        >
          {!pages ? (
            itemsQuery.isError ? (
              <ErrorState
                title="No pudimos cargar los productos."
                onRetry={() => void itemsQuery.refetch()}
              />
            ) : (
              <LoadingState label="Cargando productos…" />
            )
          ) : items.length === 0 ? (
            <EmptyState title="Todavía no hay productos." description="Creá el primero." />
          ) : (
            <>
              <ul className="stock-catalog__list" role="list" aria-label="Productos de stock">
                {items.map((item) => (
                  <li key={item.id} className="stock-catalog__row">
                    <div className="stock-catalog__text">
                      <span className="stock-catalog__name">{item.name}</span>
                      <span className="stock-catalog__meta">
                        <Badge tone="neutral">{AREA_LABEL[item.area]}</Badge>
                        <Badge tone="info">{item.category.name}</Badge>
                        {!item.active ? <Badge tone="danger">Desactivado</Badge> : null}
                        <span className="stock-catalog__qty">
                          {item.currentQuantity} {item.unit}
                        </span>
                      </span>
                    </div>
                    <div className="stock-catalog__actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!categories}
                        onClick={() => setDialog({ type: 'item-form', item })}
                      >
                        Editar
                        <span className="visually-hidden">: {item.name}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant={item.active ? 'ghost' : 'secondary'}
                        onClick={() => setDialog({ type: 'item-toggle', item })}
                      >
                        {item.active ? 'Desactivar' : 'Reactivar'}
                        <span className="visually-hidden">: {item.name}</span>
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              {lastPage && lastPage.page < lastPage.totalPages ? (
                <div className="stock-catalog__more">
                  <Button
                    variant="secondary"
                    disabled={itemsQuery.isFetchingNextPage}
                    onClick={() => {
                      if (itemsQuery.isFetchingNextPage || !itemsQuery.hasNextPage) return;
                      itemsQuery.fetchNextPage({ cancelRefetch: false }).then(
                        (result) => {
                          if (result.isError && !isSessionExpired(result.error)) {
                            setNotice({ tone: 'danger', text: errorMessageOf(result.error) });
                          }
                        },
                        () => undefined,
                      );
                    }}
                  >
                    {itemsQuery.isFetchingNextPage
                      ? 'Cargando…'
                      : `Cargar más (${items.length} de ${lastPage.total})`}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Card>

        <Card
          title="Destinos de consumo"
          actions={
            <Button size="sm" onClick={() => setDialog({ type: 'destination-form' })}>
              + Nuevo destino
            </Button>
          }
        >
          {!destinations ? (
            destinationsQuery.isError ? (
              <ErrorState
                title="No pudimos cargar los destinos."
                onRetry={() => void destinationsQuery.refetch()}
              />
            ) : (
              <LoadingState label="Cargando destinos…" />
            )
          ) : destinations.length === 0 ? (
            <EmptyState
              title="Todavía no hay destinos."
              description="Creá vehículos o sectores para elegirlos, de forma opcional, al registrar un consumo."
            />
          ) : (
            <ul className="stock-catalog__list" role="list" aria-label="Destinos de consumo">
              {destinations.map((destination) => (
                <li key={destination.id} className="stock-catalog__row">
                  <div className="stock-catalog__text">
                    <span className="stock-catalog__name">{destination.name}</span>
                    <span className="stock-catalog__meta">
                      <Badge tone="earth">{DESTINATION_TYPE_LABEL[destination.type]}</Badge>
                      {destination.active ? (
                        <Badge tone="positive">Activo</Badge>
                      ) : (
                        <Badge tone="danger">Inactivo</Badge>
                      )}
                    </span>
                  </div>
                  <div className="stock-catalog__actions">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog({ type: 'destination-form', destination })}
                    >
                      Renombrar
                      <span className="visually-hidden">: {destination.name}</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={destination.active ? 'ghost' : 'secondary'}
                      onClick={() => setDialog({ type: 'destination-toggle', destination })}
                    >
                      {destination.active ? 'Desactivar' : 'Reactivar'}
                      <span className="visually-hidden">: {destination.name}</span>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {dialog.type === 'category-form' ? (
        <CategoryFormDialog
          category={dialog.category}
          onCancel={closeDialog}
          onSessionExpired={handleSessionExpired}
          onSubmit={async (body: CreateStockCategoryRequest | UpdateStockCategoryRequest) => {
            // El formulario traduce el error y gestiona un 401 una sola vez.
            if (dialog.category) {
              await updateStockCategory(dialog.category.id, body as UpdateStockCategoryRequest);
            } else {
              await createStockCategory(body as CreateStockCategoryRequest);
            }
            done(
              dialog.category ? 'Categoría actualizada.' : 'Categoría creada.',
              cache.afterCategoryChange,
            );
          }}
        />
      ) : null}

      {dialog.type === 'item-form' && categories ? (
        <ItemFormDialog
          item={dialog.item}
          categories={categories}
          onCancel={closeDialog}
          onSessionExpired={handleSessionExpired}
          onSubmit={async (body: CreateStockItemRequest | UpdateStockItemRequest) => {
            if (dialog.item) {
              await updateStockItem(dialog.item.id, body as UpdateStockItemRequest);
            } else {
              await createStockItem(body as CreateStockItemRequest);
            }
            done(dialog.item ? 'Producto actualizado.' : 'Producto creado.', cache.afterItemChange);
          }}
        />
      ) : null}

      {dialog.type === 'destination-form' ? (
        <DestinationFormDialog
          destination={dialog.destination}
          onCancel={closeDialog}
          onSessionExpired={handleSessionExpired}
          onSubmit={async (body: CreateStockDestinationRequest | UpdateStockDestinationRequest) => {
            if (dialog.destination) {
              await updateStockDestination(
                dialog.destination.id,
                body as UpdateStockDestinationRequest,
              );
            } else {
              await createStockDestination(body as CreateStockDestinationRequest);
            }
            done(
              dialog.destination ? 'Destino renombrado.' : 'Destino creado.',
              cache.afterDestinationChange,
            );
          }}
        />
      ) : null}

      {dialog.type === 'category-toggle' ? (
        <ConfirmDialog
          title={
            dialog.category.active
              ? `Desactivar «${dialog.category.name}»`
              : `Reactivar «${dialog.category.name}»`
          }
          description={
            dialog.category.active
              ? 'La categoría deja de estar disponible para nuevos productos. No se puede desactivar mientras tenga productos activos: primero desactivalos (o asignalos a otra categoría). No se borra nada.'
              : 'La categoría vuelve a estar disponible para asignarla a productos.'
          }
          confirmLabel={dialog.category.active ? 'Desactivar' : 'Reactivar'}
          tone={dialog.category.active ? 'danger' : 'default'}
          onCancel={closeDialog}
          onConfirm={async () => {
            await sessionAware(() =>
              updateStockCategory(dialog.category.id, { active: !dialog.category.active }),
            );
            done(
              dialog.category.active ? 'Categoría desactivada.' : 'Categoría reactivada.',
              cache.afterCategoryChange,
            );
          }}
        />
      ) : null}

      {dialog.type === 'item-toggle' ? (
        <ConfirmDialog
          title={
            dialog.item.active
              ? `Desactivar «${dialog.item.name}»`
              : `Reactivar «${dialog.item.name}»`
          }
          description={
            dialog.item.active
              ? 'El producto deja de admitir movimientos y no aparece en el listado operativo por defecto. No se borra: su historial se conserva y podés reactivarlo cuando quieras.'
              : 'El producto vuelve a admitir movimientos y a aparecer en el listado operativo.'
          }
          confirmLabel={dialog.item.active ? 'Desactivar' : 'Reactivar'}
          tone={dialog.item.active ? 'danger' : 'default'}
          onCancel={closeDialog}
          onConfirm={async () => {
            await sessionAware(() => setStockItemActive(dialog.item.id, !dialog.item.active));
            done(
              dialog.item.active ? 'Producto desactivado.' : 'Producto reactivado.',
              cache.afterItemChange,
            );
          }}
        />
      ) : null}

      {dialog.type === 'destination-toggle' ? (
        <ConfirmDialog
          title={
            dialog.destination.active
              ? `Desactivar «${dialog.destination.name}»`
              : `Reactivar «${dialog.destination.name}»`
          }
          description={
            dialog.destination.active
              ? 'El destino deja de ofrecerse al registrar consumos. No se borra: los consumos históricos que lo usan se conservan intactos y podés reactivarlo cuando quieras.'
              : 'El destino vuelve a ofrecerse al registrar consumos.'
          }
          confirmLabel={dialog.destination.active ? 'Desactivar' : 'Reactivar'}
          tone={dialog.destination.active ? 'danger' : 'default'}
          onCancel={closeDialog}
          onConfirm={async () => {
            await sessionAware(() =>
              updateStockDestination(dialog.destination.id, {
                active: !dialog.destination.active,
              }),
            );
            done(
              dialog.destination.active ? 'Destino desactivado.' : 'Destino reactivado.',
              cache.afterDestinationChange,
            );
          }}
        />
      ) : null}
    </StockPage>
  );
}
