import { useCallback } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type {
  GalleryPhoto,
  NewsConversationStats,
  NewsItem,
  NewsRepliesPage,
  NewsReply,
  NewsReplyCursor,
  NewsListResponse,
  PhotoFolder,
  PhotoFoldersResponse,
  PhotosListResponse,
} from '../../api/moreTypes';
import { useSessionScope } from '../../api/useSessionScope';
import { comparePhotoFolders } from './photoFolders';

type RepliesData = InfiniteData<NewsRepliesPage, NewsReplyCursor | null>;
type NewsData = InfiniteData<NewsListResponse, number>;
type PhotosData = InfiniteData<PhotosListResponse, number>;

/** La foto sale de una vista ya cargada (todas sus páginas), con el total al día. */
function withoutPhoto(data: PhotosData | undefined, photoId: string): PhotosData | undefined {
  if (!data?.pages.some((page) => page.photos.some((photo) => photo.id === photoId))) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      photos: page.photos.filter((photo) => photo.id !== photoId),
      total: Math.max(0, page.total - 1),
    })),
  };
}

/** La misma foto con datos nuevos (p. ej. su carpeta) donde ya estaba cargada. */
function withPhoto(data: PhotosData | undefined, next: GalleryPhoto): PhotosData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      photos: page.photos.map((photo) => (photo.id === next.id ? next : photo)),
    })),
  };
}

/** Reemplaza una novedad del listado cargado (sin recargar páginas). */
function patchNewsItem(
  data: NewsData | undefined,
  newsId: string,
  update: (item: NewsItem) => NewsItem,
): NewsData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      news: page.news.map((item) => (item.id === newsId ? update(item) : item)),
    })),
  };
}

/**
 * Un mensaje editado o eliminado: su fila y TODAS las citas a él en las
 * páginas cargadas (texto actual, «Editado» o «Mensaje eliminado»).
 */
function patchReplyEverywhere(data: RepliesData | undefined, reply: NewsReply) {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      replies: page.replies.map((item) => {
        if (item.id === reply.id) return reply;
        if (item.quote?.id !== reply.id) return item;
        return {
          ...item,
          quote: {
            id: reply.id,
            author: reply.author,
            text: reply.text,
            deleted: reply.deleted,
            editedAt: reply.editedAt,
          },
        };
      }),
    })),
  };
}

/**
 * Invalidaciones selectivas de ☰ Más (Etapa 5X) — nunca un
 * `invalidateQueries()` global. Cada mutación invalida lo que cambia su
 * dato y el resumen de la grilla si afecta un conteo.
 */
export function useMoreCache() {
  const queryClient = useQueryClient();
  const { userId } = useSessionScope();
  const invalidate = useCallback(
    (...keys: readonly (readonly unknown[])[]) => {
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    },
    [queryClient],
  );

  return {
    afterNewsChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.news(userId),
          queryKeys.more.summary(userId),
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
    afterNewsReply: useCallback(
      async (newsId: string, reply: NewsReply) => {
        let alreadyInConversation = false;
        const repliesKey = queryKeys.more.newsReplies(userId, newsId);
        const newsKey = queryKeys.more.news(userId);
        await Promise.all([
          queryClient.cancelQueries({ queryKey: repliesKey, exact: true }),
          queryClient.cancelQueries({ queryKey: newsKey, exact: true }),
        ]);
        const previousReplies = queryClient.getQueryData<RepliesData>(repliesKey);
        queryClient.setQueryData<RepliesData>(repliesKey, (previous) => {
          if (!previous || previous.pages.length === 0) {
            return {
              pages: [{ replies: [reply], hasOlder: false, nextCursor: null }],
              pageParams: [null],
            };
          }
          alreadyInConversation = previous.pages.some((page) =>
            page.replies.some((item) => item.id === reply.id),
          );
          if (alreadyInConversation) return previous;
          const pages = [...previous.pages];
          const latestPage = pages[0];
          if (!latestPage) return previous;
          const replies = new Map(latestPage.replies.map((item) => [item.id, item]));
          replies.set(reply.id, reply);
          pages[0] = {
            ...latestPage,
            replies: [...replies.values()].sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
            ),
          };
          return { ...previous, pages };
        });
        queryClient.setQueryData<NewsData>(newsKey, (previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            pages: previous.pages.map((page) => ({
              ...page,
              news: page.news.map((item) =>
                item.id === newsId && !alreadyInConversation
                  ? {
                      ...item,
                      replyCount: item.replyCount + 1,
                      hasConversation: true,
                      lastReply:
                        item.lastReply && item.lastReply.createdAt > reply.createdAt
                          ? item.lastReply
                          : { createdAt: reply.createdAt, author: reply.author },
                    }
                  : item,
              ),
            })),
          };
        });
        if (!previousReplies) {
          await queryClient.invalidateQueries({ queryKey: repliesKey, exact: true });
        }
      },
      [queryClient, userId],
    ),
    /**
     * Novedad original editada o eliminada: la respuesta del backend
     * reemplaza la fila del listado; Inicio muestra su texto (se invalida) y
     * la tarjeta de Más cuenta solo las vigentes (solo al eliminar).
     */
    afterNewsMessageChange: useCallback(
      (news: NewsItem, change: 'edit' | 'delete') => {
        queryClient.setQueryData<NewsData>(queryKeys.more.news(userId), (previous) =>
          patchNewsItem(previous, news.id, () => news),
        );
        if (change === 'delete') {
          invalidate(queryKeys.dashboard(userId), queryKeys.more.summary(userId));
        } else {
          invalidate(queryKeys.dashboard(userId));
        }
      },
      [invalidate, queryClient, userId],
    ),
    /**
     * Respuesta editada o eliminada: solo esa conversación (fila y citas
     * cargadas) y, al eliminar, el contador y la última respuesta vigentes
     * que devuelve el backend. Inicio no muestra respuestas.
     */
    afterNewsReplyChange: useCallback(
      (newsId: string, reply: NewsReply, conversation?: NewsConversationStats) => {
        queryClient.setQueryData<RepliesData>(
          queryKeys.more.newsReplies(userId, newsId),
          (previous) => patchReplyEverywhere(previous, reply),
        );
        if (conversation) {
          queryClient.setQueryData<NewsData>(queryKeys.more.news(userId), (previous) =>
            patchNewsItem(previous, newsId, (item) => ({
              ...item,
              ...conversation,
              permissions: {
                ...item.permissions,
                canReply: !item.deleted || conversation.hasConversation,
              },
            })),
          );
        }
      },
      [queryClient, userId],
    ),
    /** Conflicto o mensaje ausente: revalidar SOLO lo afectado. */
    refreshNewsList: useCallback(
      () =>
        void queryClient.invalidateQueries({ queryKey: queryKeys.more.news(userId), exact: true }),
      [queryClient, userId],
    ),
    refreshNewsConversation: useCallback(
      (newsId: string) =>
        void queryClient.invalidateQueries({
          queryKey: queryKeys.more.newsReplies(userId, newsId),
          exact: true,
        }),
      [queryClient, userId],
    ),
    afterEventChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.events(userId),
          queryKeys.more.summary(userId),
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
    /**
     * 📸 Foto nueva o eliminada: «Todas las fotos», la vista de SU carpeta (o
     * «por organizar»), los conteos de carpetas y la tarjeta de Más. Las demás
     * carpetas no cambian y no se piden.
     */
    afterPhotoChange: useCallback(
      (folderId: string | null) =>
        invalidate(
          queryKeys.more.photos(userId, 'all'),
          queryKeys.more.photos(userId, folderId ?? 'none'),
          queryKeys.more.photoFolders(userId),
          queryKeys.more.summary(userId),
        ),
      [invalidate, userId],
    ),
    /**
     * Foto movida: sale de la vista de origen sin pedirla de nuevo (salvo que
     * queden páginas por cargar: la paginación por posición saltearía una
     * foto), cambia de carpeta en «Todas las fotos» sin moverse de lugar, y
     * se revalidan el destino (orden real) y los conteos.
     */
    afterPhotoMove: useCallback(
      (photo: GalleryPhoto, fromFolderId: string | null) => {
        const from = queryKeys.more.photos(userId, fromFolderId ?? 'none');
        queryClient.setQueriesData<PhotosData>({ queryKey: from }, (data) =>
          withoutPhoto(data, photo.id),
        );
        for (const [queryKey, data] of queryClient.getQueriesData<PhotosData>({ queryKey: from })) {
          const last = data?.pages.at(-1);
          if (last && last.page < last.totalPages) {
            void queryClient.invalidateQueries({ queryKey, exact: true });
          }
        }
        queryClient.setQueriesData<PhotosData>(
          { queryKey: queryKeys.more.photos(userId, 'all') },
          (data) => withPhoto(data, photo),
        );
        invalidate(
          queryKeys.more.photos(userId, photo.folderId ?? 'none'),
          queryKeys.more.photoFolders(userId),
        );
      },
      [invalidate, queryClient, userId],
    ),
    /**
     * Carpeta nueva: entra ya en el listado (ordenada), así un selector abierto
     * puede elegirla sin esperar, y se revalida solo el listado de carpetas.
     */
    afterFolderCreated: useCallback(
      (folder: PhotoFolder) => {
        const key = queryKeys.more.photoFolders(userId);
        queryClient.setQueryData<PhotoFoldersResponse>(
          key,
          (previous) =>
            previous && {
              ...previous,
              folders: [...previous.folders.filter((item) => item.id !== folder.id), folder].sort(
                comparePhotoFolders,
              ),
            },
        );
        void queryClient.invalidateQueries({ queryKey: key, exact: true });
      },
      [queryClient, userId],
    ),
    /**
     * Carpeta renombrada: la respuesta reemplaza su tarjeta y se reordena; el
     * encabezado y los selectores leen ese listado. Sin pedir fotos.
     */
    afterFolderRenamed: useCallback(
      (folder: PhotoFolder) =>
        queryClient.setQueryData<PhotoFoldersResponse>(
          queryKeys.more.photoFolders(userId),
          (previous) =>
            previous && {
              ...previous,
              folders: previous.folders
                .map((item) => (item.id === folder.id ? folder : item))
                .sort(comparePhotoFolders),
            },
        ),
      [queryClient, userId],
    ),
    /** Carpeta eliminada (estaba vacía): sale del listado y se descarta su galería en caché. */
    afterFolderDeleted: useCallback(
      (folderId: string) => {
        queryClient.setQueryData<PhotoFoldersResponse>(
          queryKeys.more.photoFolders(userId),
          (previous) =>
            previous && {
              ...previous,
              folders: previous.folders.filter((item) => item.id !== folderId),
            },
        );
        queryClient.removeQueries({ queryKey: queryKeys.more.photos(userId, folderId) });
      },
      [queryClient, userId],
    ),
    /** Conflicto (otra persona cambió una carpeta o una foto): revalidar solo lo afectado. */
    refreshPhotoFolders: useCallback(
      (...scopes: readonly (string | null)[]) =>
        invalidate(
          queryKeys.more.photoFolders(userId),
          ...scopes.map((scope) => queryKeys.more.photos(userId, scope ?? 'none')),
        ),
      [invalidate, userId],
    ),
    /**
     * 🌳 Jardín: publicar una versión solo cambia el historial del plano y el
     * conteo de la grilla. Las imágenes ya descargadas siguen en caché (cada
     * versión es inmutable) y no se pide ninguna foto del historial.
     */
    afterGardenChange: useCallback(
      () => invalidate(queryKeys.more.garden(userId), queryKeys.more.summary(userId)),
      [invalidate, userId],
    ),
    /** Personas: listas de Configuración, selectores de empleados, Usuarios, Tareas (nombres/colores) y cumpleaños. */
    afterEmployeeChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.employees(userId),
          queryKeys.more.team(userId),
          queryKeys.tasks.all(userId),
          queryKeys.participants(userId),
          queryKeys.admin.users(userId),
          queryKeys.more.events(userId),
          queryKeys.more.summary(userId),
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
    /**
     * Etapa 5F — cambió el nombre visible de un EMPLEADO (él mismo en Mi
     * perfil o el ADMIN en Datos del equipo): todo lo que muestra nombres de
     * personas. Solo se llama si el nombre cambió de verdad.
     */
    afterPersonNameChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.profile(userId),
          queryKeys.more.employees(userId),
          queryKeys.more.team(userId),
          queryKeys.more.news(userId),
          queryKeys.more.photos(userId),
          queryKeys.more.events(userId),
          queryKeys.tasks.all(userId),
          queryKeys.participants(userId),
          queryKeys.performance.all(userId),
          queryKeys.chickenCoop.all(userId),
          queryKeys.stock.all(userId),
          queryKeys.pets.all(userId),
          queryKeys.admin.users(userId),
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
    /**
     * Etapa 5F — el ADMIN cambió SU nombre visible: su cumpleaños (Eventos,
     * Inicio), Usuarios y, como participante o autor, los selectores y
     * registros de Stock y Gallinero.
     */
    afterOwnNameChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.events(userId),
          queryKeys.dashboard(userId),
          queryKeys.admin.users(userId),
          queryKeys.participants(userId),
          queryKeys.stock.all(userId),
          queryKeys.chickenCoop.all(userId),
        ),
      [invalidate, userId],
    ),
    /** PIN asignado o cambiado: estado de cuenta en Personas y en Usuarios. */
    afterAccountChange: useCallback(
      () => invalidate(queryKeys.more.employees(userId), queryKeys.admin.users(userId)),
      [invalidate, userId],
    ),
    /**
     * 🎂 Mi cumpleaños (perfil personal): los cumpleaños derivados (Eventos,
     * Inicio, Más). El perfil propio NO se invalida: la respuesta del PUT ya
     * se escribió en su caché (`setQueryData`), sin una request extra.
     */
    afterOwnBirthdayChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.events(userId),
          queryKeys.more.summary(userId),
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
    /** 👨‍👩‍👧‍👦 Mi familia: la lista y los cumpleaños derivados (Eventos, Inicio, Más). */
    afterFamilyChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.family(userId),
          queryKeys.more.events(userId),
          queryKeys.more.summary(userId),
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
    /** Mi perfil o hijos: el propio perfil, Datos del equipo y los cumpleaños derivados. */
    afterProfileChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.profile(userId),
          queryKeys.more.team(userId),
          queryKeys.more.events(userId),
          queryKeys.more.summary(userId),
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
  };
}
