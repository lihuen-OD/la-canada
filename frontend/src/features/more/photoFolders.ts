import { useQuery } from '@tanstack/react-query';
import { fetchPhotoFolders } from '../../api/moreApi';
import type { PhotoFolder, PhotoScope } from '../../api/moreTypes';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';
import { normalizeText } from './moreLabels';

/**
 * 📸 Carpetas de Fotos: textos, rutas y validación compartidos por la
 * pantalla principal, la galería de una carpeta y los diálogos. El backend
 * es la autoridad (nombre, permisos, conteos); acá solo se presenta.
 */

export const PHOTO_FOLDER_NAME_MAX = 80;
export const UNFILED_LABEL = 'Sin carpeta';
export const ALL_PHOTOS_LABEL = 'Todas las fotos';
export const FOLDER_ICON = '📁';
export const UNFILED_ICON = '🗂️';
export const ALL_PHOTOS_ICON = '🖼️';

const RESERVED = new Set([UNFILED_LABEL, ALL_PHOTOS_LABEL].map((name) => name.toLowerCase()));

/** El mismo nombre visible que guardará el backend (NFC, sin espacios de más). */
export const normalizeFolderName = (value: string) => normalizeText(value.normalize('NFC'));

/** Mensaje de validación local (el backend vuelve a validar), o `null`. */
export function folderNameError(name: string): string | null {
  if (!name) return 'Escribí un nombre para la carpeta.';
  if (name.length > PHOTO_FOLDER_NAME_MAX) {
    return `El nombre no puede superar ${PHOTO_FOLDER_NAME_MAX} caracteres.`;
  }
  if (/[<>]/.test(name)) return 'El nombre no puede contener «<» ni «>».';
  if (RESERVED.has(name.toLowerCase())) {
    return '«Sin carpeta» y «Todas las fotos» son accesos de Fotos: elegí otro nombre.';
  }
  return null;
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

/** El mismo orden que el backend: nombre en español, nombre exacto e id. */
export function comparePhotoFolders(
  left: { name: string; id: string },
  right: { name: string; id: string },
): number {
  return (
    collator.compare(left.name, right.name) ||
    (left.name < right.name ? -1 : left.name > right.name ? 1 : 0) ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

/** Ruta SPA de cada parte de la galería (se puede recargar o compartir). */
export function photoScopePath(scope: PhotoScope): string {
  if (scope === 'all') return '/more/photos/all';
  if (scope === 'none') return '/more/photos/unfiled';
  return `/more/photos/folders/${scope}`;
}

export const photoCountLabel = (count: number) => `${count} ${count === 1 ? 'foto' : 'fotos'}`;

/** La carpeta elegida ya no está en el listado (otra persona la eliminó). */
export const isMissingFolder = (value: string | null, folders: readonly PhotoFolder[]) =>
  value !== null && !folders.some((folder) => folder.id === value);

/** Nombre de la carpeta de una foto según el listado cargado. */
export function folderLabel(folders: readonly PhotoFolder[] | undefined, folderId: string | null) {
  if (folderId === null) return UNFILED_LABEL;
  return folders?.find((folder) => folder.id === folderId)?.name ?? 'Carpeta';
}

/**
 * Carpetas, «Sin carpeta» y «Todas las fotos» con sus conteos: UNA request
 * compartida por la pantalla principal, el encabezado de cada carpeta y los
 * selectores de subir y mover (staleTime operativo, sin sondeo).
 */
export function usePhotoFolders() {
  const { userId, enabled } = useSessionScope();
  return useQuery({
    queryKey: queryKeys.more.photoFolders(userId),
    queryFn: fetchPhotoFolders,
    enabled,
  });
}
