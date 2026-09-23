import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import {
  getLoginOptions as getLoginOptionsService,
  getPublicUserById,
  login as loginService,
  logout as logoutService,
  refresh as refreshService,
  type RequestMeta,
} from '../auth/authService';
import { loginBodySchema } from '../auth/schemas';
import {
  REFRESH_TOKEN_COOKIE_NAME,
  clearedRefreshTokenCookieOptions,
  refreshTokenCookieOptions,
} from '../config/cookies';
import { AuthenticationRequiredError, ValidationError } from '../errors/AppError';

function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}

function readRefreshTokenCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[REFRESH_TOKEN_COOKIE_NAME];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Público, sin autenticación — solo lo mínimo para construir el selector de
 * identidad (persona + PIN). Nunca incluye `pinHash`, `username`, estado
 * completo, intentos fallidos, ni ningún otro dato interno — ver
 * `auth/authService.ts`, `getLoginOptions`.
 */
export async function getLoginOptions(_req: Request, res: Response): Promise<void> {
  const options = await getLoginOptionsService(prisma);
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ options });
}

export async function postLogin(req: Request, res: Response): Promise<void> {
  const parsed = loginBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('El body de login debe incluir userId y un PIN de 4 dígitos.');
  }

  const result = await loginService(prisma, { ...parsed.data, ...requestMeta(req) });

  res.cookie(REFRESH_TOKEN_COOKIE_NAME, result.refreshToken, refreshTokenCookieOptions());
  res.set('Cache-Control', 'no-store');
  res.status(200).json({
    accessToken: result.accessToken,
    expiresIn: result.accessTokenExpiresInSeconds,
    user: result.user,
  });
}

export async function postRefresh(req: Request, res: Response): Promise<void> {
  const refreshToken = readRefreshTokenCookie(req);
  if (!refreshToken) {
    throw new AuthenticationRequiredError();
  }

  const result = await refreshService(prisma, { refreshToken, ...requestMeta(req) });

  res.cookie(REFRESH_TOKEN_COOKIE_NAME, result.refreshToken, refreshTokenCookieOptions());
  res.set('Cache-Control', 'no-store');
  res
    .status(200)
    .json({ accessToken: result.accessToken, expiresIn: result.accessTokenExpiresInSeconds });
}

export async function postLogout(req: Request, res: Response): Promise<void> {
  const refreshToken = readRefreshTokenCookie(req);
  await logoutService(prisma, { refreshToken, ...requestMeta(req) });
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, clearedRefreshTokenCookieOptions());
  res.set('Cache-Control', 'no-store');
  res.status(204).send();
}

export async function getMe(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-store');
  if (!req.auth) {
    throw new AuthenticationRequiredError();
  }
  const user = await getPublicUserById(prisma, req.auth.userId);
  if (!user) {
    throw new AuthenticationRequiredError();
  }
  res.status(200).json({ user });
}
