import { describe, expect, it, vi } from 'vitest';
import { TenantContextService } from './tenant-context.service.js';

function makeTenantClient() {
  const captured: { sql: unknown; params: unknown[] }[] = [];
  const tx = {
    $executeRaw: vi.fn(async (sql: unknown, ...params: unknown[]) => {
      captured.push({ sql, params });
      return 1;
    }),
  };
  const tenant = {
    $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  return { tenant, tx, captured };
}

describe('TenantContextService', () => {
  it('withUserContext sets transaction-local app.user_id and runs the callback on the tx', async () => {
    const { tenant, captured } = makeTenantClient();
    const service = new TenantContextService(tenant as never);
    const result = await service.withUserContext('user-1', async (tx) => {
      expect(tx).toBeDefined();
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(tenant.$transaction).toHaveBeenCalledTimes(1);
    expect(captured).toHaveLength(1);
    const sql = String(captured[0].sql);
    expect(sql).toContain('app.user_id');
    // `true` is the is_local flag in the SQL text: transaction-scoped, not a param
    expect(sql).toContain(', true)');
    expect(captured[0].params).toEqual(['user-1']);
  });

  it('withFleetContext sets both app.user_id and app.fleet_id transaction-locally', async () => {
    const { tenant, captured } = makeTenantClient();
    const service = new TenantContextService(tenant as never);
    await service.withFleetContext(
      { userId: 'user-1', fleetId: 'fleet-1' },
      async () => 'done',
    );
    expect(tenant.$transaction).toHaveBeenCalledTimes(1);
    expect(captured).toHaveLength(1);
    const sql = String(captured[0].sql);
    expect(sql).toContain('app.user_id');
    expect(sql).toContain('app.fleet_id');
    expect(captured[0].params).toEqual(['user-1', 'fleet-1']);
  });

  it('propagates callback failures and still ends the transaction (rollback by throw)', async () => {
    const { tenant, tx } = makeTenantClient();
    const service = new TenantContextService(tenant as never);
    await expect(
      service.withFleetContext({ userId: 'u', fleetId: 'f' }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('retries transaction-start timeouts (P2028) without re-running completed work', async () => {
    const { tenant } = makeTenantClient();
    const startError = Object.assign(new Error('Transaction API error'), { code: 'P2028' });
    tenant.$transaction
      .mockRejectedValueOnce(startError)
      .mockRejectedValueOnce(startError);
    const service = new TenantContextService(tenant as never);
    const result = await service.withUserContext('user-1', async () => 'recovered');
    expect(result).toBe('recovered');
    // 2 failed starts + 1 success; the callback only ran on the success.
    expect(tenant.$transaction).toHaveBeenCalledTimes(3);
  });

  it('gives up after max attempts and surfaces the start error', async () => {
    const { tenant } = makeTenantClient();
    tenant.$transaction.mockRejectedValue(
      Object.assign(new Error('pool busy'), { code: 'P2024' }),
    );
    const service = new TenantContextService(tenant as never);
    await expect(
      service.withFleetContext({ userId: 'u', fleetId: 'f' }, async () => 'x'),
    ).rejects.toThrow('pool busy');
    expect(tenant.$transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-start errors (callback failures throw immediately)', async () => {
    const { tenant } = makeTenantClient();
    tenant.$transaction.mockRejectedValue(
      Object.assign(new Error('unique violation'), { code: 'P2002' }),
    );
    const service = new TenantContextService(tenant as never);
    await expect(
      service.withUserContext('u', async () => 'x'),
    ).rejects.toThrow('unique violation');
    expect(tenant.$transaction).toHaveBeenCalledTimes(1);
  });
});
