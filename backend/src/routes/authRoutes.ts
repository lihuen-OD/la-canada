import { Router } from 'express';
import { getMe, postLogin, postLogout, postRefresh } from '../controllers/authController';
import { requireAuth } from '../middleware/requireAuth';
import { requireJsonContentType } from '../middleware/requireJsonContentType';
import { validateOrigin } from '../middleware/validateOrigin';
import { createAuthRateLimiter } from '../config/rateLimit';

export const authRouter = Router();

const authRateLimiter = createAuthRateLimiter();

authRouter.post('/login', authRateLimiter, requireJsonContentType, postLogin);
authRouter.post('/refresh', authRateLimiter, validateOrigin, postRefresh);
authRouter.post('/logout', validateOrigin, postLogout);
authRouter.get('/me', requireAuth, getMe);
