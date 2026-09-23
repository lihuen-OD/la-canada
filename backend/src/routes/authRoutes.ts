import { Router } from 'express';
import {
  getLoginOptions,
  getMe,
  postLogin,
  postLogout,
  postRefresh,
} from '../controllers/authController';
import { requireAuth } from '../middleware/requireAuth';
import { requireJsonContentType } from '../middleware/requireJsonContentType';
import { validateOrigin } from '../middleware/validateOrigin';
import { createAuthRateLimiter } from '../config/rateLimit';

export const authRouter = Router();

const authRateLimiter = createAuthRateLimiter();

// Público, de solo lectura, sin PIN ni credenciales involucradas — el
// límite general de /api (ver app.ts) ya alcanza como primera capa; no
// necesita el límite más estricto de auth, que existe específicamente
// contra fuerza bruta de credenciales.
authRouter.get('/login-options', getLoginOptions);

authRouter.post('/login', authRateLimiter, requireJsonContentType, postLogin);
authRouter.post('/refresh', authRateLimiter, validateOrigin, postRefresh);
authRouter.post('/logout', validateOrigin, postLogout);
authRouter.get('/me', requireAuth, getMe);
