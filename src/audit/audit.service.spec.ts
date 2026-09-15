import { describe, expect, it, vi } from 'vitest';
import {
  AuditService,
  deriveClassification,
} from './audit.service.js';

describe('AuditService', () => {
  describe('deriveClassification', () => {
    it('classifies auth and session actions as SECURITY', () => {
      expect(deriveClassification('auth.login')).toBe('SECURITY');
      expect(deriveClassification('session.revoke')).toBe('SECURITY');
      expect(deriveClassification('user.change_password')).toBe('SECURITY');
      expect(deriveClassification('role.assign')).toBe('SECURITY');
    });

    it('classifies financial and lifecycle mutations as GOVERNANCE', () => {
      expect(deriveClassification('booking.verify_payment')).toBe('GOVERNANCE');
      expect(deriveClassification('booking.refund')).toBe('GOVERNANCE');
      expect(deriveClassification('booking.force_cancel')).toBe('GOVERNANCE');
      expect(deriveClassification('booking.reinstate')).toBe('GOVERNANCE');
      expect(deriveClassification('report.resolve')).toBe('GOVERNANCE');
    });

    it('classifies general queries and events as OBSERVABILITY', () => {
      expect(deriveClassification('trips.view')).toBe('OBSERVABILITY');
      expect(deriveClassification('buses.list')).toBe('OBSERVABILITY');
    });
  });

  describe('log', () => {
    it('creates an audit log entry with classification embedded in metadata', async () => {
      const createMock = vi.fn(async () => ({ id: 'log-1' }));
      const mockSystem = {
        auditLog: {
          create: createMock,
        },
      };

      const service = new AuditService(mockSystem as never);

      await service.log({
        actorUserId: 'user-1',
        action: 'auth.login',
        resource: 'user',
        resourceId: 'user-1',
        metadata: { ip: '127.0.0.1' },
      });

      expect(createMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          actorUserId: 'user-1',
          action: 'auth.login',
          resource: 'user',
          resourceId: 'user-1',
          metadata: {
            ip: '127.0.0.1',
            classification: 'SECURITY',
          },
          success: true,
        }),
      });
    });

    it('does not throw on database write failure, preserving best-effort non-blocking request execution', async () => {
      const mockSystem = {
        auditLog: {
          create: vi.fn().mockRejectedValue(new Error('DB Connection Lost')),
        },
      };

      const service = new AuditService(mockSystem as never);

      // Must not throw for observability audit
      await expect(
        service.log({
          actorUserId: 'user-1',
          action: 'bus.view',
          resource: 'buses',
          classification: 'OBSERVABILITY',
        }),
      ).resolves.toBeUndefined();

      // Must not throw for security audit
      await expect(
        service.log({
          actorUserId: 'user-1',
          action: 'session.revoke',
          resource: 'sessions',
          classification: 'SECURITY',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
