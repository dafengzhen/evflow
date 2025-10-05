import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BroadcastMessage } from '../types.ts';

import { MemoryBroadcastAdapter } from './memory-broadcast-adapter.ts';

/**
 * MemoryBroadcastAdapter.
 *
 * @author dafengzhen
 */
describe('MemoryBroadcastAdapter', () => {
  let adapterA: MemoryBroadcastAdapter;
  let adapterB: MemoryBroadcastAdapter;
  const channel = 'test-channel';

  beforeEach(() => {
    adapterA = new MemoryBroadcastAdapter('A');
    adapterB = new MemoryBroadcastAdapter('B');

    // 清空共享频道，确保测试独立
    (MemoryBroadcastAdapter as any).sharedChannels = new Map();
  });

  it('should set name correctly', () => {
    expect(adapterA.name).toBe('A');
  });

  it('should subscribe and publish messages', async () => {
    const callbackA = vi.fn();
    const callbackB = vi.fn();

    await adapterA.subscribe(channel, callbackA);
    await adapterB.subscribe(channel, callbackB);

    const message: BroadcastMessage = {
      broadcastId: '1',
      context: { excludeSelf: false },
      eventName: 'event',
      id: 'msg1',
      source: 'test',
      timestamp: Date.now(),
      traceId: 'trace1',
      version: 1,
    };

    await adapterA.publish(channel, message);

    expect(callbackA).toHaveBeenCalledWith(message);
    expect(callbackB).toHaveBeenCalledWith(message);
  });

  it('should respect excludeSelf flag', async () => {
    const callbackA = vi.fn();
    const callbackB = vi.fn();

    await adapterA.subscribe(channel, callbackA);
    await adapterB.subscribe(channel, callbackB);

    const message: BroadcastMessage = {
      broadcastId: '2',
      context: { excludeSelf: true },
      eventName: 'event',
      id: 'msg2',
      source: 'test',
      timestamp: Date.now(),
      traceId: 'trace2',
      version: 1,
    };

    await adapterA.publish(channel, message);

    expect(callbackA).not.toHaveBeenCalled(); // 排除自己
    expect(callbackB).toHaveBeenCalledWith(message);
  });

  it('should handle unsubscribe', async () => {
    const callback = vi.fn();

    await adapterA.subscribe(channel, callback);
    await adapterA.unsubscribe(channel);

    const message: BroadcastMessage = {
      broadcastId: '3',
      context: {},
      eventName: 'event',
      id: 'msg3',
      source: 'test',
      timestamp: Date.now(),
      traceId: 'trace3',
      version: 1,
    };

    await adapterA.publish(channel, message);
    expect(callback).not.toHaveBeenCalled();
  });

  it('should disconnect and cleanup all channels', async () => {
    const callbackA = vi.fn();
    const callbackB = vi.fn();

    await adapterA.subscribe(channel, callbackA);
    await adapterB.subscribe(channel, callbackB);

    await adapterA.disconnect();

    const debugInfo = MemoryBroadcastAdapter.getDebugInfo();
    expect(debugInfo[channel]).toContain('B');
    expect(debugInfo[channel]).not.toContain('A');
  });

  it('should handle publish to empty channel gracefully', async () => {
    const message: BroadcastMessage = {
      broadcastId: '4',
      context: {},
      eventName: 'event',
      id: 'msg4',
      source: 'test',
      timestamp: Date.now(),
      traceId: 'trace4',
      version: 1,
    };

    await expect(adapterA.publish('nonexistent', message)).resolves.toBeUndefined();
  });

  it('should not break when subscriber callback throws', async () => {
    const errorCallback = vi.fn(() => {
      throw new Error('fail');
    });
    await adapterA.subscribe(channel, errorCallback);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const message: BroadcastMessage = {
      broadcastId: '5',
      context: {},
      eventName: 'event',
      id: 'msg5',
      source: 'test',
      timestamp: Date.now(),
      traceId: 'trace5',
      version: 1,
    };

    await adapterA.publish(channel, message);

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('getDebugInfo should return correct info', async () => {
    await adapterA.subscribe(channel, vi.fn());
    await adapterB.subscribe(channel, vi.fn());

    const debugInfo = MemoryBroadcastAdapter.getDebugInfo();
    expect(debugInfo[channel]).toEqual(['A', 'B']);
  });
});
