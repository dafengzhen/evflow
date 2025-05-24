import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Injector } from './injector';

describe('Injector', () => {
  let injector: Injector;

  beforeEach(() => {
    injector = new Injector();
  });

  describe('constructor', () => {
    it('should set cloneStrategy when provided', () => {
      const cloneStrategy = vi.fn();
      const injector = new Injector({ cloneStrategy });
      expect(injector['cloneStrategy']).toBe(cloneStrategy);
    });
  });

  describe('clear', () => {
    it('should clear all instances and cache', () => {
      injector.register('token', {});
      injector.resolve('token');
      injector.clear();
      expect(injector.has('token')).toBe(false);
      expect(injector['resolvedCache'].size).toBe(0);
    });
  });

  describe('has', () => {
    it('should return false for unregistered token', () => {
      expect(injector.has('token')).toBe(false);
    });

    it('should return true for registered token', () => {
      injector.register('token', {});
      expect(injector.has('token')).toBe(true);
    });
  });

  describe('register', () => {
    it('should register new instance', () => {
      const instance = {};
      injector.register('token', instance);
      expect(injector['instances'].get('token')).not.toBe(instance);
    });

    it('should throw when registering duplicate token', () => {
      injector.register('token', {});
      expect(() => injector.register('token', {})).toThrowError(/already registered/);
    });

    it('should clear resolved cache for token when re-registered', () => {
      injector.register('token', {});
      injector.resolve('token');
      expect(injector['resolvedCache'].has('token')).toBe(true);

      injector.clear();

      injector.register('token', {});
      expect(injector['resolvedCache'].has('token')).toBe(false);
    });
  });

  describe('resolve', () => {
    it('should throw for unregistered token by default', () => {
      expect(() => injector.resolve('token')).toThrowError(/not registered/);
    });

    it('should return undefined when throwIfNotRegistered=false', () => {
      expect(injector.resolve('token', { throwIfNotRegistered: false })).toBeUndefined();
    });

    it('should return cloned instance', () => {
      const instance = { data: 'test' };
      injector.register('token', instance);
      const result = injector.resolve('token');
      expect(result).toEqual(instance);
      expect(result).not.toBe(instance);
    });

    it('should use cached instance for subsequent calls', () => {
      const instance = {};
      injector.register('token', instance);
      const first = injector.resolve('token');
      const second = injector.resolve('token');
      expect(first).not.toBe(second);
      expect(injector['resolvedCache'].has('token')).toBe(true);
    });
  });

  describe('inject', () => {
    it('should inject dependencies', () => {
      const factory = vi.fn((a, b) => a + b);
      injector.register('dep1', 1);
      injector.register('dep2', 2);
      const result = injector.inject(factory, ['dep1', 'dep2']);
      expect(result).toBe(3);
      expect(factory).toHaveBeenCalledWith(1, 2);
    });
  });

  describe('deepClone', () => {
    it('should return primitives directly', () => {
      expect(injector['deepClone'](42, [], new WeakMap())).toBe(42);
      expect(injector['deepClone']('test', [], new WeakMap())).toBe('test');
      expect(injector['deepClone'](null, [], new WeakMap())).toBeNull();
    });

    it('should use cloneStrategy', () => {
      const cloneStrategy = vi.fn(() => 'cloned');
      const injector = new Injector({ cloneStrategy });
      const value = {};
      const path = ['customPath'];

      const result = injector['deepClone'](value, path, new WeakMap());

      expect(cloneStrategy).toHaveBeenCalledWith(value, path);
      expect(result).toBe('cloned');
    });

    it('should throw for functions', () => {
      const testFunction = () => {};
      const path = ['testPath'];

      const act = () => {
        injector['deepClone'](testFunction, path, new WeakMap());
      };

      expect(act).toThrowError(Error);
      expect(act).toThrowError(`Cannot clone function at path: ${path.join('.')}.`);
    });

    it('should throw for DOM elements', () => {
      const div = document.createElement('div');
      expect(() => injector['deepClone'](div, [], new WeakMap())).toThrowError(/Cannot clone DOM element/);
    });

    it('should throw for custom class instances', () => {
      class CustomClass {}
      expect(() => injector['deepClone'](new CustomClass(), [], new WeakMap())).toThrowError(
        /Cannot clone custom class instance/,
      );
    });

    it('should handle circular references', () => {
      const obj: any = {};
      obj.self = obj;
      const cloned = injector['deepClone'](obj, [], new WeakMap());
      expect(cloned.self).toBe(cloned);
    });

    it('should clone arrays and objects', () => {
      const original = { a: [1, { b: 2 }] };
      const cloned = injector['deepClone'](original, [], new WeakMap());
      expect(cloned).toEqual(original);
      expect(cloned.a).not.toBe(original.a);
      expect(cloned.a[1]).not.toBe(original.a[1]);
    });
  });
});
