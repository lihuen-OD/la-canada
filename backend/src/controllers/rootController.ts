import type { Request, Response } from 'express';
import { SERVICE_VERSION } from '../config/version';

export function getRoot(_req: Request, res: Response): void {
  res.status(200).json({
    service: 'la-canada-api',
    version: SERVICE_VERSION,
    health: '/api/v1/health',
  });
}
