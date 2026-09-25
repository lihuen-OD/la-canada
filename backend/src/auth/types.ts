/** Contexto adjuntado al request por `requireAuth` — nunca se arma desde el JWT solo, siempre confirmado contra la base (ver `middleware/requireAuth.ts`). */
export interface AuthContext {
  userId: string;
  sessionId: string;
  /** Siempre el rol vigente en la base al momento del request, nunca el claim `role` del JWT tal cual — ver `requireAuth`. */
  role: 'ADMIN' | 'EMPLOYEE';
  /**
   * Etapa 5P — empleado ACTIVO vinculado (o `null`), leído en la MISMA
   * consulta que valida la sesión: `resolveActor` lo reutiliza sin volver a
   * la base. Opcional para contextos armados a mano (tests): si falta,
   * `resolveActor` consulta como antes.
   */
  employeeId?: string | null;
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
