import { useCallback } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type {
  NewsRepliesPage,
  NewsReply,
  NewsReplyCursor,
  NewsListResponse,
} from '../../api/moreTypes';
import { useSessionScope } from '../../api/useSessionScope';

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
        const previousReplies =
          queryClient.getQueryData<InfiniteData<NewsRepliesPage, NewsReplyCursor | null>>(
            repliesKey,
          );
        queryClient.setQueryData<InfiniteData<NewsRepliesPage, NewsReplyCursor | null>>(
          repliesKey,
          (previous) => {
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
          },
        );
        queryClient.setQueryData<InfiniteData<NewsListResponse, number>>(newsKey, (previous) => {
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
    afterEventChange: useCallback(
      () =>
        invalidate(
          queryKeys.more.events(userId),
          queryKeys.more.summary(userId),
          queryKeys.dashboard(userId),
        ),
      [invalidate, userId],
    ),
    afterPhotoChange: useCallback(
      () => invalidate(queryKeys.more.photos(userId), queryKeys.more.summary(userId)),
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
