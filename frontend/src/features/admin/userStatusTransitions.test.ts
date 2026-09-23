import { describe, expect, it } from 'vitest';
import {
  getAllowedStatusTransitions,
  getStatusLabel,
  getTransitionActionLabel,
  statusChangeRevokesSessions,
} from './userStatusTransitions';

describe('userStatusTransitions (espejo de backend/src/auth/userStatus.ts)', () => {
  it('refleja exactamente la matriz real del backend', () => {
    expect(getAllowedStatusTransitions('PENDING_ACTIVATION')).toEqual(['DEACTIVATED']);
    expect(getAllowedStatusTransitions('ACTIVE')).toEqual(['SUSPENDED', 'DEACTIVATED']);
    expect(getAllowedStatusTransitions('SUSPENDED')).toEqual(['ACTIVE', 'DEACTIVATED']);
    expect(getAllowedStatusTransitions('DEACTIVATED')).toEqual(['ACTIVE', 'SUSPENDED']);
  });

  it('PENDING_ACTIVATION -> ACTIVE nunca aparece (solo se llega por /activate)', () => {
    expect(getAllowedStatusTransitions('PENDING_ACTIVATION')).not.toContain('ACTIVE');
  });

  it('solo SUSPENDED y DEACTIVATED revocan sesiones', () => {
    expect(statusChangeRevokesSessions('SUSPENDED')).toBe(true);
    expect(statusChangeRevokesSessions('DEACTIVATED')).toBe(true);
    expect(statusChangeRevokesSessions('ACTIVE')).toBe(false);
    expect(statusChangeRevokesSessions('PENDING_ACTIVATION')).toBe(false);
  });

  it('etiquetas en español para cada estado', () => {
    expect(getStatusLabel('PENDING_ACTIVATION')).toBe('Pendiente de activación');
    expect(getStatusLabel('ACTIVE')).toBe('Activo');
    expect(getStatusLabel('SUSPENDED')).toBe('Suspendido');
    expect(getStatusLabel('DEACTIVATED')).toBe('Deshabilitado');
  });

  it('etiquetas de acción para cada transición ofrecida en la UI', () => {
    expect(getTransitionActionLabel('ACTIVE')).toBe('Reactivar');
    expect(getTransitionActionLabel('SUSPENDED')).toBe('Suspender');
    expect(getTransitionActionLabel('DEACTIVATED')).toBe('Deshabilitar');
  });
});
