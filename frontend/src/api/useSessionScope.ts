import { useAuth } from '../auth/useAuth';

/**
 * Identificador de alcance de la caché: el id del usuario autenticado según
 * el backend. Las pantallas con datos solo se montan con sesión; si faltara
 * el usuario, las consultas quedan deshabilitadas (`enabled: false`) y nunca
 * se comparte caché entre personas.
 */
export function useSessionScope(): { userId: string; enabled: boolean } {
  const { user } = useAuth();
  return { userId: user?.id ?? 'anonymous', enabled: Boolean(user) };
}
