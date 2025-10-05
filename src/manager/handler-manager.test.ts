import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventContext, EventHandler, EventMiddleware, EventMigrator } from '../types.ts';

import { HandlerManager } from './handler-manager.ts';

// Mock utils.now
vi.mock('../utils', () => ({
  now: vi.fn(() => 1000),
}));

interface TestEvents {
  other: { text: string };
  test: { value: number };
}

/**
 * HandlerManager.
 *
 * @author dafengzhen
 */
describe('HandlerManager', () => {
  let manager: HandlerManager<any>;

  beforeEach(() => {
    manager = new HandlerManager<any>(2, 2); // small limits for testing
  });

  it('should register and retrieve handlers', () => {
    const handler: EventHandler<TestEvents['test'], string> = async () => 'ok';
    manager.on('test', handler, 1);

    const handlers = manager.getHandlers('test', 1);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]).toBe(handler);

    const latest = manager.getLatestHandler('test');
    expect(latest?.handler).toBe(handler);
    expect(latest?.version).toBe(1);
  });

  it('should unregister handlers using off', () => {
    const handler: EventHandler<TestEvents['test']> = async () => 'ok';
    manager.on('test', handler, 1);

    expect(manager.off('test', handler, 1)).toBe(true);
    expect(manager.getHandlers('test', 1)).toHaveLength(0);
    expect(manager.off('test', handler, 1)).toBe(false); // already removed
  });

  it('should remove all handlers when off is called without handler', () => {
    const h1: EventHandler<TestEvents['test']> = async () => {};
    const h2: EventHandler<TestEvents['test']> = async () => {};
    manager.on('test', h1, 1);
    manager.on('test', h2, 2);

    expect(manager.off('test')).toBe(true);
    expect(manager.getHandlers('test', 1)).toHaveLength(0);
    expect(manager.getHandlers('test', 2)).toHaveLength(0);
  });

  it('should enforce maxHandlersPerEvent', () => {
    manager.on('test', async () => {});
    manager.on('test', async () => {});
    expect(() => manager.on('test', async () => {})).toThrow(/Exceeded max handlers/);
  });

  it('should register and remove middlewares', () => {
    const mw: EventMiddleware<TestEvents['test']> = async (ctx, next) => next();
    const off = manager.use('test', mw);

    expect(manager.getMiddlewares('test')).toContain(mw);
    off();
    expect(manager.getMiddlewares('test')).not.toContain(mw);
  });

  it('should enforce maxMiddlewarePerEvent', () => {
    manager.use('test', async (ctx, next) => next());
    manager.use('test', async (ctx, next) => next());
    expect(() => manager.use('test', async (ctx, next) => next())).toThrow(/Exceeded max middlewares/);
  });

  it('should register migrators and migrate context', () => {
    const handler: EventHandler<TestEvents['test']> = async () => {};
    manager.on('test', handler, 2);

    const migrator: EventMigrator<TestEvents['test']> = (ctx) => ({
      ...ctx,
      meta: { value: (ctx.meta?.value ?? 0) + 1 },
    });
    manager.registerMigrator('test', 1, migrator);

    const ctx: EventContext<TestEvents['test']> = { meta: { value: 1 }, version: 1 };
    const migrated = manager.migrateContext('test', ctx);

    expect(migrated.version).toBe(2);
    expect(migrated.meta?.value).toBe(2);
  });

  it('should track handler, middleware, and migrator usage', () => {
    const handler: EventHandler<TestEvents['test']> = async () => {};
    manager.on('test', handler, 1);
    manager.trackHandlerUsage('test', 1);

    const mw: EventMiddleware<TestEvents['test']> = async (ctx, next) => next();
    manager.use('test', mw);
    manager.trackMiddlewareUsage('test');

    const migrator: EventMigrator<TestEvents['test']> = (ctx) => ctx;
    manager.registerMigrator('test', 1, migrator);
    manager.trackMigratorUsage('test');

    const stats = manager.getUsageStats();
    expect(stats.handlers.byEvent['test']).toBe(1);
    expect(stats.middlewares.byEvent['test']).toBe(1);
    expect(stats.migrators.byEvent['test']).toBe(1);
  });

  it('should cleanup usage maps', () => {
    const handler: EventHandler<TestEvents['test']> = async () => {};
    manager.on('test', handler, 1);
    manager.trackHandlerUsage('test', 1);

    const mw: EventMiddleware<TestEvents['test']> = async (ctx, next) => next();
    manager.use('test', mw);
    manager.trackMiddlewareUsage('test');

    const migrator: EventMigrator<TestEvents['test']> = (ctx) => ctx;
    manager.registerMigrator('test', 1, migrator);
    manager.trackMigratorUsage('test');

    manager.cleanup({
      handlerInactivityThreshold: -1,
      middlewareInactivityThreshold: -1,
      migratorInactivityThreshold: -1,
    });

    // All usage maps should be empty after cleanup
    expect(manager['handlerUsage'].size).toBe(0);
    expect(manager['middlewareUsage'].size).toBe(0);
    expect(manager['migratorUsage'].size).toBe(0);
  });

  it('should destroy all internal maps', () => {
    manager.on('test', async () => {});
    manager.use('test', async (ctx, next) => next());
    manager.registerMigrator('test', 1, (ctx) => ctx);

    manager.destroy();
    expect(manager['handlers'].size).toBe(0);
    expect(manager['middlewares'].size).toBe(0);
    expect(manager['migrators'].size).toBe(0);
    expect(manager['handlerUsage'].size).toBe(0);
    expect(manager['middlewareUsage'].size).toBe(0);
    expect(manager['migratorUsage'].size).toBe(0);
  });
});
