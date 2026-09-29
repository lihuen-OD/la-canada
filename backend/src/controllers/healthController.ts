import type { Request, Response } from 'express';

/**
 * `GET /api/v1/health` — liveness mínimo (Etapa 5R). Lo usa el frontend
 * para saber si Render terminó de despertar el backend antes de enviar el
 * refresh de sesión (ver docs/ARCHITECTURE.md §32).
 *
 * Deliberadamente trivial: sin autenticación, sin Prisma, sin tocar Neon, y
 * sin datos internos (ni versión, ni entorno, ni hora, ni hostname, memoria
 * o uptime). Responder prueba que el proceso está corriendo; no dice nada de
 * la base, y no mantiene nada vivo — no hay keep-alive.
 */
export function getHealth(_req: Request, res: Response): void {
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ status: 'ok' });
}
