import { beforeEach, describe, expect, it } from 'vitest';

import { Injector } from './injector';

describe('Injector', () => {
  let injector: Injector;

  beforeEach(() => {
    injector = new Injector();
  });

  describe('register', () => {
    it('should register a token', () => {
      injector.register('token', 'instance');
      expect(injector.has('token')).toBe(true);
    });

    it('should throw if token is already registered', () => {
      injector.register('token', 'instance');
      expect(() => injector.register('token', 'new')).toThrowError(/already registered/);
    });
  });

  describe('resolve', () => {
    it('should return undefined for unregistered token', () => {
      expect(injector.resolve('unknown')).toBeUndefined();
    });

    it('should return cached instance after first resolve', () => {
      injector.register('token', 'instance');
      injector.resolve('token');
      injector['instances'].delete('token');
      expect(injector.resolve('token')).toBe('instance');
    });
  });

  describe('inject', () => {
    it('should inject dependencies and call factory', () => {
      injector.register('dep1', 10);
      injector.register('dep2', 20);
      const factory = (a: number, b: number) => a + b;
      const result = injector.inject(factory, ['dep1', 'dep2']);
      expect(result).toBe(30);
    });
  });

  describe('clear', () => {
    it('should clear all instances and cache', () => {
      injector.register('token', 'instance');
      injector.resolve('token');
      injector.clear();
      expect(injector.has('token')).toBe(false);
      expect(injector.resolve('token')).toBeUndefined();
    });
  });

  describe('has', () => {
    it('should return false for unregistered token', () => {
      expect(injector.has('token')).toBe(false);
    });
  });
});
