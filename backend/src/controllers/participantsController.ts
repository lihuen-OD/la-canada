import type { Request, Response } from 'express';
import { AuthenticationRequiredError } from '../errors/AppError';
import { listParticipants } from '../lib/participants';

/**
 * `GET /participants`: empleados y administradores activos que pueden figurar
 * como persona de una actividad (Stock, Gallinero) y en el filtro «Persona»
 * de los reportes. Cualquier usuario autenticado lo lee (los reportes son de
 * todos); solo un ADMIN puede ELEGIR a otra persona al registrar, y eso lo
 * decide cada servicio.
 */
export async function getParticipants(req: Request, res: Response): Promise<void> {
  if (!req.auth) throw new AuthenticationRequiredError();
  res.set('Cache-Control', 'no-store');
  res.status(200).json(await listParticipants());
}
