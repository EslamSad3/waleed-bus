import { Test, TestingModule } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('reports ok status', () => {
    const controller = new HealthController();
    expect(controller.health()).toEqual({ status: 'ok' });
  });

  it('is provided by a testing module without extra dependencies', async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    const controller = module.get(HealthController);
    expect(controller.health().status).toBe('ok');
  });
});
