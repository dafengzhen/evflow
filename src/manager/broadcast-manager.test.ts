import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BroadcastAdapter, EventContext } from '../types.ts';

import { BroadcastManager } from './broadcast-manager.ts';

// Mock genId 和 now
vi.mock('../utils', () => ({
  genId: vi.fn(() => 'mock-broadcast-id'),
  now: vi.fn(() => 123456789),
}));

/**
 * BroadcastManager.
 *
 * @author dafengzhen
 */
describe('BroadcastManager', () => {
  type EM = { testEvent: { value: number } };

  let manager: BroadcastManager<EM>;
  let handleError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handleError = vi.fn(async () => {});
    manager = new BroadcastManager<EM>('node-1', handleError, 3);
  });

  it('should add and remove broadcast adapters', () => {
    const adapter: BroadcastAdapter = {
      name: 'adapter1',
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };

    manager.addBroadcastAdapter(adapter);
    expect(manager.getAdapterNames()).toContain('adapter1');

    manager.removeBroadcastAdapter('adapter1');
    expect(manager.getAdapterNames()).not.toContain('adapter1');
  });

  it('should add and remove broadcast filters', () => {
    const filter = vi.fn().mockReturnValue(true);
    manager.addBroadcastFilter(filter);
    expect((manager as any).broadcastFilters).toContain(filter);

    manager.removeBroadcastFilter(filter);
    expect((manager as any).broadcastFilters).not.toContain(filter);
  });

  it('should set emit handler and call it during broadcast', async () => {
    const handleLocalEmit = vi.fn().mockResolvedValue('ok');
    const context: EventContext<{ value: number }> = {
      meta: { value: 42 },
      name: 'test',
      traceId: 'trace-1',
      version: 1,
    };
    const result = await manager.broadcast('testEvent', context, {}, handleLocalEmit);
    expect(result).toBe('ok');
    expect(handleLocalEmit).toHaveBeenCalledWith('testEvent', context);
  });

  it('should check broadcast adapters health', async () => {
    const adapter: BroadcastAdapter = {
      healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
      name: 'adapter1',
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    manager.addBroadcastAdapter(adapter);

    const status = await manager.checkBroadcastAdapters();
    expect(status).toEqual([{ healthy: true, name: 'adapter1' }]);
  });

  it('should subscribe and unsubscribe channels', async () => {
    const adapter: BroadcastAdapter = {
      name: 'adapter1',
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    manager.addBroadcastAdapter(adapter);

    await manager.subscribeBroadcast('channel1');
    expect(manager.getSubscribedChannels()).toContain('channel1');

    await manager.unsubscribeBroadcast('channel1');
    expect(manager.getSubscribedChannels()).not.toContain('channel1');
  });

  it('should handle incoming broadcast and call handleEmit', async () => {
    const handleEmit = vi.fn().mockResolvedValue('ok');
    manager.setEmitHandler(handleEmit);

    const message = {
      broadcastId: 'b1',
      context: { name: 'test', traceId: 'trace-1', version: 1 },
      eventName: 'testEvent',
      id: 'b1',
      source: 'node-2',
      timestamp: 123456,
      traceId: 'trace-1',
      version: 1,
    };

    await manager.handleIncomingBroadcast(message);
    expect(handleEmit).toHaveBeenCalledWith('testEvent', expect.objectContaining({ broadcast: true }));
  });

  it('should destroy manager and clear state', async () => {
    const adapter: BroadcastAdapter = {
      disconnect: vi.fn().mockResolvedValue(undefined),
      name: 'adapter1',
      publish: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    manager.addBroadcastAdapter(adapter);
    await manager.subscribeBroadcast('channel1');

    await manager.destroy();
    expect(manager.getAdapterNames()).toHaveLength(0);
    expect(manager.getSubscribedChannels()).toHaveLength(0);
    expect((manager as any).broadcastFilters).toHaveLength(0);
  });
});
