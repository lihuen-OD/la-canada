/** Contexto adjuntado al request por `requireAuth` — nunca se arma desde el JWT solo, siempre confirmado contra la base (ver `middleware/requireAuth.ts`). */
export interface AuthContext {
  userId: string;
  sessionId: string;
  /** Siempre el rol vigente en la base al momento del request, nunca el claim `role` del JWT tal cual — ver `requireAuth`. */
  role: 'ADMIN' | 'EMPLOYEE';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- forma estándar de Express para aumentar Request
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
