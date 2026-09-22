import type { Request, Response } from 'express';
import { config } from '../config';
import { SERVICE_VERSION } from '../config/version';

export function getHealth(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    service: 'la-canada-api',
    environment: config.nodeEnv,
    timestamp: new Date().toISOString(),
    version: SERVICE_VERSION,
  });
}
