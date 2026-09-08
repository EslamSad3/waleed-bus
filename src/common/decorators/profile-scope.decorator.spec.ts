import { describe, expect, it } from 'vitest';
import 'reflect-metadata';
import { ALLOW_RESTRICTED_KEY, AllowRestricted } from './profile-scope.decorator.js';

describe('AllowRestricted', () => {
  it('marks the route as callable with a restricted session', () => {
    class Probe {
      @AllowRestricted()
      profile() {}
    }
    expect(Reflect.getMetadata(ALLOW_RESTRICTED_KEY, Probe.prototype.profile)).toBe(true);
  });

  it('leaves unmarked routes without the flag', () => {
    class Probe {
      plain() {}
    }
    expect(Reflect.getMetadata(ALLOW_RESTRICTED_KEY, Probe.prototype.plain)).toBeUndefined();
  });
});
