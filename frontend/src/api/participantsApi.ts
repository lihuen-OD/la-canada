import { apiRequest } from './httpClient';
import type { ParticipantsResponse } from './types';

/** `GET /participants`: empleados y administradores activos elegibles como persona de una actividad. */
export function fetchParticipants(): Promise<ParticipantsResponse> {
  return apiRequest<ParticipantsResponse>('/participants', { authenticated: true });
}
