import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventMiddleware } from '../types.ts';

import { MiddlewareManager } from './middleware-manager.ts';

/**
 * MiddlewareManager.
 *
 * @author dafengzhen
 */
describe('MiddlewareManager', () => {
  let manager: MiddlewareManager<any>;
  const inactivityThreshold = 1000; // 1s
  const maxMiddlewarePerEvent = 2;

  beforeEach(() => {
    manager = new MiddlewareManager<any>({
      inactivityThreshold,
      maxMiddlewarePerEvent,
    });
  });

  it('should register and retrieve middleware', () => {
    const mw: EventMiddleware<{ foo: string }> = async (ctx, next) => next();
    manager.use('testEvent', mw);

    const middlewares = manager.getMiddlewares('testEvent');
    expect(middlewares).toContain(mw);
  });

  it('should return empty array for event without middleware', () => {
    const middlewares = manager.getMiddlewares('anotherEvent');
    expect(middlewares).toEqual([]);
  });

  it('should track usage correctly', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);

    manager.trackUsage('testEvent');

    const usage = (manager as any).usage.get('testEvent');
    expect(usage).toEqual({ lastUsed: 1000, usageCount: 1 });

    nowSpy.mockReturnValue(2000);
    manager.trackUsage('testEvent');
    const usage2 = (manager as any).usage.get('testEvent');
    expect(usage2).toEqual({ lastUsed: 2000, usageCount: 2 });

    nowSpy.mockRestore();
  });

  it('should return stats correctly', () => {
    const mw1: EventMiddleware<{ foo: string }> = async (ctx, next) => next();
    const mw2: EventMiddleware<{ foo: string }> = async (ctx, next) => next();
    manager.use('testEvent', mw1);
    manager.use('testEvent', mw2);

    const stats = manager.getStats();
    expect(stats.total).toBe(2);
    expect(stats.byEvent['testEvent']).toBe(2);
  });

  it('should cleanup inactive middlewares', () => {
    const mw: EventMiddleware<{ foo: string }> = async (ctx, next) => next();
    manager.use('testEvent', mw);

    // simulate lastUsed in the past
    (manager as any).usage.set('testEvent', { lastUsed: Date.now() - inactivityThreshold - 1, usageCount: 1 });

    manager.cleanup();
    expect(manager.getMiddlewares('testEvent')).toEqual([]);
    expect((manager as any).usage.has('testEvent')).toBe(false);
  });

  it('should remove middleware using the returned function', () => {
    const mw: EventMiddleware<{ foo: string }> = async (ctx, next) => next();
    const remove = manager.use('testEvent', mw);

    remove();
    expect(manager.getMiddlewares('testEvent')).toEqual([]);
    expect((manager as any).usage.has('testEvent')).toBe(false);
  });

  it('should throw when exceeding maxMiddlewarePerEvent', () => {
    const mw: EventMiddleware<{ foo: string }> = async (ctx, next) => next();
    manager.use('testEvent', mw);
    manager.use('testEvent', mw);

    expect(() => manager.use('testEvent', mw)).toThrow(/Maximum middleware \(2\) exceeded for event: testEvent/);
  });
});
