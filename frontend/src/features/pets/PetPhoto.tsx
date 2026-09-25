import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { fetchPetPhoto } from '../../api/petsApi';
import type { Pet } from '../../api/petTypes';
import { queryKeys } from '../../api/queryKeys';
import { useSessionScope } from '../../api/useSessionScope';

interface PetPhotoProps {
  pet: Pick<Pet, 'name' | 'photo' | 'type'>;
  size: 'md' | 'lg';
}

const watchedClients = new WeakSet<QueryClient>();

/**
 * Libera la object URL cuando su entrada sale de la caché (vencimiento de
 * `gcTime`, logout o cambio de sesión): la imagen nunca queda retenida más
 * allá de la sesión que la pidió.
 */
function revokeOnRemoval(queryClient: QueryClient): void {
  if (watchedClients.has(queryClient)) return;
  watchedClients.add(queryClient);
  queryClient.getQueryCache().subscribe((event) => {
    const key = event.query.queryKey;
    if (event.type === 'removed' && key[2] === 'pets' && key[3] === 'photo') {
      const url = event.query.state.data;
      if (typeof url === 'string') URL.revokeObjectURL(url);
    }
  });
}

/**
 * Foto de la ficha o, si no tiene (o no se puede leer), el emoji del tipo
 * (`tipoIcon` del prototipo). La imagen llega por el proxy autenticado del
 * backend; se cachea en memoria por id de archivo (inmutable: una foto
 * nueva es otro id), nunca en storage.
 */
export function PetPhoto({ pet, size }: PetPhotoProps) {
  const queryClient = useQueryClient();
  revokeOnRemoval(queryClient);
  const { userId, enabled } = useSessionScope();
  const fileId = pet.photo?.id ?? null;
  const query = useQuery({
    queryKey: queryKeys.pets.photo(userId, fileId ?? 'none'),
    queryFn: async () => URL.createObjectURL(await fetchPetPhoto(fileId as string)),
    enabled: enabled && fileId !== null,
    staleTime: Infinity,
    retry: false,
  });
  const url = fileId ? query.data : undefined;

  return (
    <span className={`pet-photo pet-photo--${size}`}>
      {url ? (
        <img src={url} alt={`Foto de ${pet.name}`} />
      ) : (
        <span aria-hidden="true">{pet.type.icon}</span>
      )}
    </span>
  );
}
