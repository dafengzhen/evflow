import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventEntity, MiddlewareContext } from '../types';

import { Lifecycle } from './lifecycle.ts';

describe('Lifecycle', () => {
  let lifecycle: Lifecycle;
  const mockEvent = { context: { id: 'test-event' } } as EventEntity;
  const mockContext = {} as MiddlewareContext;
  const mockHook = vi.fn();

  beforeEach(() => {
    lifecycle = new Lifecycle();
    vi.clearAllMocks();
  });

  describe('registerForEvent', () => {
    it('should register event-specific hooks', () => {
      lifecycle.registerForEvent('event1', 'running', mockHook);
      const hooks = lifecycle['eventHooks'].get('event1')?.get('running');
      expect(hooks).toHaveLength(1);
    });

    it('should handle multiple hooks for same event and phase', () => {
      const hook2 = vi.fn();
      lifecycle.registerForEvent('event1', 'running', mockHook);
      lifecycle.registerForEvent('event1', 'running', hook2);
      expect(lifecycle['eventHooks'].get('event1')?.get('running')).toHaveLength(2);
    });
  });

  describe('registerGlobal', () => {
    it('should register global hooks', () => {
      lifecycle.registerGlobal('running', mockHook);
      expect(lifecycle['globalHooks'].get('running')).toContain(mockHook);
    });
  });

  describe('trigger', () => {
    it('should trigger global and event-specific hooks', async () => {
      const globalHook = vi.fn();
      const specificHook = vi.fn();

      lifecycle.registerGlobal('running', globalHook);
      lifecycle.registerForEvent(mockEvent.context.id, 'running', specificHook);

      await lifecycle.trigger(mockEvent, 'running', mockContext);

      expect(globalHook).toHaveBeenCalledWith(mockEvent, mockContext);
      expect(specificHook).toHaveBeenCalledWith(mockEvent, mockContext);
    });

    it('should handle missing hooks gracefully', async () => {
      await expect(lifecycle.trigger(mockEvent, 'invalid-phase' as any, mockContext)).resolves.not.toThrow();
    });

    it('should execute hooks in sequence', async () => {
      const order: number[] = [];
      const hook1 = vi.fn().mockImplementation(() => order.push(1));
      const hook2 = vi.fn().mockImplementation(() => order.push(2));

      lifecycle.registerGlobal('running', hook1);
      lifecycle.registerForEvent(mockEvent.context.id, 'running', hook2);

      await lifecycle.trigger(mockEvent, 'running', mockContext);
      expect(order).toEqual([1, 2]);
    });
  });

  describe('clear', () => {
    it('should clear all hooks', () => {
      lifecycle.registerGlobal('running', mockHook);
      lifecycle.registerForEvent('event1', 'running', mockHook);

      lifecycle.clear();

      expect(lifecycle['globalHooks'].size).toBe(0);
      expect(lifecycle['eventHooks'].size).toBe(0);
    });
  });
});
