import type { ChickenCoopPeriodDays } from './chickenCoopTypes';
import type { EventType, PhotoScope, TeamFilter } from './moreTypes';
import type { PerformanceDetailFilters } from './performanceTypes';
import type { MedicalRecordType, PetDueFilters } from './petTypes';
import type {
  ListStockItemsParams,
  StockCategoryStatusFilter,
  StockDestinationStatusFilter,
  StockMovementType,
  StockReportFilters,
} from './stockTypes';

/**
 * Claves de caché — única fuente de verdad (Etapa 5P). TODAS empiezan con
 * `['session', userId]`: la caché de una persona nunca puede servir datos a
 * otra aunque, por un error, no se vaciara al cambiar de sesión (igual se
 * vacía: `AuthProvider`). Las invalidaciones se hacen por prefijo de dominio
 * (`queryKeys.tasks.all(userId)`), nunca con un `invalidateQueries()` global.
 */
const scope = (userId: string) => ['session', userId] as const;

export const queryKeys = {
  dashboard: (userId: string) => [...scope(userId), 'dashboard'] as const,
  /** Personas elegibles como participante (empleados + administradores activos). */
  participants: (userId: string) => [...scope(userId), 'participants'] as const,
  tasks: {
    all: (userId: string) => [...scope(userId), 'tasks'] as const,
    list: (userId: string, status: 'active' | 'all') =>
      [...scope(userId), 'tasks', 'list', status] as const,
    /** Todos los listados (activas / todas): dependen del día de negocio. */
    listAll: (userId: string) => [...scope(userId), 'tasks', 'list'] as const,
    employees: (userId: string) => [...scope(userId), 'tasks', 'employees'] as const,
    history: (userId: string, week: string | null, employeeId: string | null) =>
      [...scope(userId), 'tasks', 'history', week ?? 'current', employeeId ?? 'all'] as const,
    historyAll: (userId: string) => [...scope(userId), 'tasks', 'history'] as const,
    /** Fechas sugeridas de un mes (`YYYY-MM`) para el calendario de Configuración. */
    calendar: (userId: string, month: string) =>
      [...scope(userId), 'tasks', 'calendar', month] as const,
    calendarAll: (userId: string) => [...scope(userId), 'tasks', 'calendar'] as const,
  },
  performance: {
    all: (userId: string) => [...scope(userId), 'performance'] as const,
    summary: (userId: string, from: string, to: string) =>
      [...scope(userId), 'performance', 'summary', from, to] as const,
    employee: (userId: string, employeeId: string, from: string, to: string) =>
      [...scope(userId), 'performance', 'employee', employeeId, from, to] as const,
    /**
     * Detalle paginado («Ver más») de una persona: rango y filtros en la clave
     * (cada combinación tiene sus páginas; cambiar cualquiera empieza de nuevo).
     */
    employeeDetail: (
      userId: string,
      employeeId: string,
      from: string,
      to: string,
      filters: PerformanceDetailFilters,
    ) =>
      [
        ...scope(userId),
        'performance',
        'employee-detail',
        employeeId,
        from,
        to,
        filters.date ?? 'all',
        filters.frequency ?? 'all',
        filters.status ?? 'all',
      ] as const,
  },
  /**
   * 🥬 Huerta: claves PROPIAS (nunca `tasks` ni `performance`), así que sus
   * invalidaciones quedan acotadas al módulo y nada de Tareas o Inicio las toca.
   */
  kitchenGarden: {
    all: (userId: string) => [...scope(userId), 'kitchenGarden'] as const,
    participants: (userId: string) => [...scope(userId), 'kitchenGarden', 'participants'] as const,
    candidates: (userId: string) => [...scope(userId), 'kitchenGarden', 'candidates'] as const,
    activities: (userId: string, status: 'active' | 'all') =>
      [...scope(userId), 'kitchenGarden', 'activities', status] as const,
    /** Listados de actividades: dependen del día de negocio. */
    activitiesAll: (userId: string) => [...scope(userId), 'kitchenGarden', 'activities'] as const,
    history: (userId: string, week: string | null, participantId: string | null) =>
      [
        ...scope(userId),
        'kitchenGarden',
        'history',
        week ?? 'current',
        participantId ?? 'all',
      ] as const,
    historyAll: (userId: string) => [...scope(userId), 'kitchenGarden', 'history'] as const,
    performanceAll: (userId: string) => [...scope(userId), 'kitchenGarden', 'performance'] as const,
    performanceSummary: (userId: string, from: string, to: string) =>
      [...scope(userId), 'kitchenGarden', 'performance', 'summary', from, to] as const,
    performanceParticipant: (userId: string, participantId: string, from: string, to: string) =>
      [
        ...scope(userId),
        'kitchenGarden',
        'performance',
        'participant',
        participantId,
        from,
        to,
      ] as const,
  },
  stock: {
    all: (userId: string) => [...scope(userId), 'stock'] as const,
    /**
     * Listados de productos: inventario Casa/Jardín, Compras (`stockLevel` +
     * `sort=name`) y catálogo comparten esta familia — un movimiento o un
     * cambio de catálogo invalida `itemsAll` y todas se revalidan.
     */
    items: (userId: string, filters: Omit<ListStockItemsParams, 'page' | 'pageSize'>) =>
      [...scope(userId), 'stock', 'items', filters] as const,
    itemsAll: (userId: string) => [...scope(userId), 'stock', 'items'] as const,
    /** Detalle de un producto (fuera de `items` para no confundirlo con un listado). */
    item: (userId: string, itemId: string) => [...scope(userId), 'stock', 'item', itemId] as const,
    itemAll: (userId: string) => [...scope(userId), 'stock', 'item'] as const,
    categories: (userId: string, status: StockCategoryStatusFilter) =>
      [...scope(userId), 'stock', 'categories', status] as const,
    categoriesAll: (userId: string) => [...scope(userId), 'stock', 'categories'] as const,
    destinations: (userId: string, status: StockDestinationStatusFilter) =>
      [...scope(userId), 'stock', 'destinations', status] as const,
    destinationsAll: (userId: string) => [...scope(userId), 'stock', 'destinations'] as const,
    /** Historial de UN producto; el prefijo sin filtro invalida todos sus filtros. */
    movements: (userId: string, itemId: string, type?: StockMovementType | '') =>
      type === undefined
        ? ([...scope(userId), 'stock', 'movements', itemId] as const)
        : ([...scope(userId), 'stock', 'movements', itemId, type || 'all'] as const),
    movementsAll: (userId: string) => [...scope(userId), 'stock', 'movements'] as const,
    reportSummary: (userId: string, filters: StockReportFilters) =>
      [...scope(userId), 'stock', 'reports', 'summary', filters] as const,
    reportMovements: (userId: string, filters: StockReportFilters) =>
      [...scope(userId), 'stock', 'reports', 'movements', filters] as const,
    reportsAll: (userId: string) => [...scope(userId), 'stock', 'reports'] as const,
  },
  chickenCoop: {
    /** Todo el gallinero: una recolección, anulación o cambio de gallinas invalida la familia entera. */
    all: (userId: string) => [...scope(userId), 'chickenCoop'] as const,
    /** KPIs + análisis del período (los KPIs de promedio/postura dependen del período). */
    summary: (userId: string, days: ChickenCoopPeriodDays) =>
      [...scope(userId), 'chickenCoop', 'summary', days] as const,
    /** Historial paginado por días (`useInfiniteQuery`). */
    history: (userId: string) => [...scope(userId), 'chickenCoop', 'history'] as const,
  },
  pets: {
    /** Toda la familia de Mascotas (listados, fichas, historiales y tipos). */
    all: (userId: string) => [...scope(userId), 'pets'] as const,
    /** Catálogo de tipos (5 min): `active` para formularios/chips, `all` para el ADMIN. */
    types: (userId: string, status: 'active' | 'all') =>
      [...scope(userId), 'pets', 'types', status] as const,
    typesAll: (userId: string) => [...scope(userId), 'pets', 'types'] as const,
    /** Listado paginado (`useInfiniteQuery`) por filtro de tipo. */
    list: (
      userId: string,
      typeId: string | null,
      status: 'active' | 'inactive' | 'all' = 'active',
    ) => [...scope(userId), 'pets', 'list', typeId ?? 'all', status] as const,
    listAll: (userId: string) => [...scope(userId), 'pets', 'list'] as const,
    /** Ficha + KPIs de UNA mascota. */
    detail: (userId: string, petId: string) => [...scope(userId), 'pets', 'detail', petId] as const,
    /** Historial clínico de UNA mascota; el prefijo sin tipo invalida todos sus filtros. */
    records: (userId: string, petId: string, type?: MedicalRecordType | 'all') =>
      type === undefined
        ? ([...scope(userId), 'pets', 'records', petId] as const)
        : ([...scope(userId), 'pets', 'records', petId, type] as const),
    /** 📅 Vencimientos y «Próximas atenciones» por filtros; el prefijo invalida todos. */
    due: (userId: string, filters: PetDueFilters) =>
      [
        ...scope(userId),
        'pets',
        'due',
        filters.petId ?? 'all',
        filters.type ?? 'all',
        filters.status ?? 'open',
      ] as const,
    dueAll: (userId: string) => [...scope(userId), 'pets', 'due'] as const,
    /** Imagen por id de archivo: inmutable (una foto nueva es otro id). */
    photo: (userId: string, fileId: string) => [...scope(userId), 'pets', 'photo', fileId] as const,
  },
  more: {
    /** Subtítulos de la grilla de Más (conteos de novedades, eventos y fotos). */
    summary: (userId: string) => [...scope(userId), 'more', 'summary'] as const,
    /** Historial de novedades (`useInfiniteQuery`). */
    news: (userId: string) => [...scope(userId), 'more', 'news'] as const,
    /** Conversación diferida por novedad; `pageParams` guarda cada cursor sin mezclar hilos. */
    newsReplies: (userId: string, newsId: string) =>
      [...scope(userId), 'more', 'news-replies', newsId] as const,
    /** Eventos + cumpleaños derivados por filtro de tipo; el prefijo invalida todos los filtros. */
    events: (userId: string, type?: EventType | 'all') =>
      type === undefined
        ? ([...scope(userId), 'more', 'events'] as const)
        : ([...scope(userId), 'more', 'events', type] as const),
    weather: (userId: string) => [...scope(userId), 'more', 'weather'] as const,
    /**
     * Galería (`useInfiniteQuery`) por parte de la galería (`all`, `none` =
     * por organizar, o el id de una carpeta); la página vive en `pageParams`.
     * Sin `photoScope`, el prefijo de toda la galería.
     */
    photos: (userId: string, photoScope?: PhotoScope) =>
      photoScope === undefined
        ? ([...scope(userId), 'more', 'photos'] as const)
        : ([...scope(userId), 'more', 'photos', photoScope] as const),
    /** Carpetas de Fotos con sus conteos, «Sin carpeta» y «Todas las fotos» (una request). */
    photoFolders: (userId: string) => [...scope(userId), 'more', 'photo-folders'] as const,
    /** Imagen por id de foto: inmutable (una foto nueva es otro id). */
    photoContent: (userId: string, photoId: string) =>
      [...scope(userId), 'more', 'photo-content', photoId] as const,
    /**
     * 🌳 Jardín: historial de versiones del plano (el prefijo sin página
     * invalida todas). Publicar una versión nueva solo invalida esta familia
     * y el resumen — nunca Fotos, Novedades ni Tareas.
     */
    garden: (userId: string) => [...scope(userId), 'more', 'garden'] as const,
    /** Plano de UNA versión por id: inmutable (cada versión tiene su archivo). */
    gardenContent: (userId: string, versionId: string) =>
      [...scope(userId), 'more', 'garden-content', versionId] as const,
    employees: (userId: string) => [...scope(userId), 'more', 'employees'] as const,
    team: (userId: string, filter?: TeamFilter) =>
      filter === undefined
        ? ([...scope(userId), 'more', 'team'] as const)
        : ([...scope(userId), 'more', 'team', filter] as const),
    profile: (userId: string) => [...scope(userId), 'more', 'profile'] as const,
    /** 👨‍👩‍👧‍👦 Mi familia (usuario sin Employee). */
    family: (userId: string) => [...scope(userId), 'more', 'family'] as const,
  },
  admin: {
    users: (userId: string) => [...scope(userId), 'admin', 'users'] as const,
  },
};
