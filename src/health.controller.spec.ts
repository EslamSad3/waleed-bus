import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { API_VERSION } from './openapi/openapi.document.js';
import { HealthController, RootController } from './health.controller.js';
import { IS_PUBLIC_KEY } from './common/decorators/public.decorator.js';
import { describe, expect, it } from 'vitest';

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

describe('RootController', () => {
  it('identifies the service and its main surfaces', () => {
    const controller = new RootController();
    expect(controller.serviceInfo()).toEqual({
      name: 'Bus Fleet API',
      version: API_VERSION,
      docs: '/docs',
      health: '/health',
    });
  });

  it('is public — the landing endpoint must answer without a bearer token', async () => {
    const reflector = new Reflector();
    await Test.createTestingModule({
      controllers: [RootController],
    }).compile();
    expect(
      reflector.get<boolean>(IS_PUBLIC_KEY, RootController.prototype.serviceInfo),
      '@Public() metadata on serviceInfo',
    ).toBe(true);
  });
});
