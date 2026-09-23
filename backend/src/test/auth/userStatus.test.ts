import { describe, expect, it } from 'vitest';
import { isAllowedStatusTransition, statusChangeRevokesSessions } from '../../auth/userStatus';

describe('isAllowedStatusTransition', () => {
  it('permite las transiciones administrativas esperadas', () => {
    expect(isAllowedStatusTransition('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(isAllowedStatusTransition('ACTIVE', 'DEACTIVATED')).toBe(true);
    expect(isAllowedStatusTransition('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(isAllowedStatusTransition('SUSPENDED', 'DEACTIVATED')).toBe(true);
    expect(isAllowedStatusTransition('DEACTIVATED', 'ACTIVE')).toBe(true);
    expect(isAllowedStatusTransition('DEACTIVATED', 'SUSPENDED')).toBe(true);
    expect(isAllowedStatusTransition('PENDING_ACTIVATION', 'DEACTIVATED')).toBe(true);
  });

  it('NUNCA permite PENDING_ACTIVATION → ACTIVE por este endpoint (solo vía /activate)', () => {
    expect(isAllowedStatusTransition('PENDING_ACTIVATION', 'ACTIVE')).toBe(false);
  });

  it('rechaza una transición a sí mismo', () => {
    expect(isAllowedStatusTransition('ACTIVE', 'ACTIVE')).toBe(false);
  });

  it('rechaza PENDING_ACTIVATION → SUSPENDED (sin contraseña todavía, no tiene sentido suspenderlo)', () => {
    expect(isAllowedStatusTransition('PENDING_ACTIVATION', 'SUSPENDED')).toBe(false);
  });
});

describe('statusChangeRevokesSessions', () => {
  it('SUSPENDED y DEACTIVATED revocan sesiones', () => {
    expect(statusChangeRevokesSessions('SUSPENDED')).toBe(true);
    expect(statusChangeRevokesSessions('DEACTIVATED')).toBe(true);
  });

  it('ACTIVE y PENDING_ACTIVATION no revocan nada', () => {
    expect(statusChangeRevokesSessions('ACTIVE')).toBe(false);
    expect(statusChangeRevokesSessions('PENDING_ACTIVATION')).toBe(false);
  });
});
