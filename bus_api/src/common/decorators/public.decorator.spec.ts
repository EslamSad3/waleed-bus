import { describe, expect, it } from 'vitest';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, Public } from './public.decorator.js';

describe('Public decorator', () => {
  it('marks a route handler as public via metadata', () => {
    class FakeController {
      @Public()
      handler() {
        return null;
      }
    }
    const reflector = new Reflector();
    const target = FakeController.prototype;
    expect(reflector.get<boolean>(IS_PUBLIC_KEY, target.handler)).toBe(true);
  });
});
