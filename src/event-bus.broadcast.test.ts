import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventState } from './enums.ts';
import { EventBus } from './index.ts';
import { MemoryBroadcastAdapter } from './memory-broadcast-adapter.ts';

/**
 * EventBus Broadcast.
 *
 * @author dafengzhen
 */
describe('EventBus Broadcast', () => {
  let eventBus1: EventBus<any>;
  let eventBus2: EventBus<any>;
  let adapter1: MemoryBroadcastAdapter;
  let adapter2: MemoryBroadcastAdapter;

  beforeEach(async () => {
    eventBus1 = new EventBus();
    eventBus2 = new EventBus();

    adapter1 = new MemoryBroadcastAdapter('adapter1');
    adapter2 = new MemoryBroadcastAdapter('adapter2');

    eventBus1.addBroadcastAdapter(adapter1);
    eventBus2.addBroadcastAdapter(adapter2);

    // Subscribe to test channels
    await eventBus1.subscribeBroadcast(['test-channel']);
    await eventBus2.subscribeBroadcast(['test-channel']);
  });

  afterEach(async () => {
    // Cleanup
    await eventBus1.unsubscribeBroadcast(['test-channel']);
    await eventBus2.unsubscribeBroadcast(['test-channel']);
    eventBus1.removeBroadcastAdapter('adapter1');
    eventBus2.removeBroadcastAdapter('adapter2');
  });

  describe('Basic Broadcast', () => {
    it('should broadcast event to other nodes', async () => {
      const eventHandler = vi.fn();
      eventBus2.on('test.event', eventHandler);

      await eventBus1.broadcast(
        'test.event',
        { meta: { data: 'test-data' } },
        { channels: ['test-channel'], excludeSelf: true },
      );

      // Wait for broadcast to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(eventHandler).toHaveBeenCalledTimes(1);
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          broadcast: true,
          broadcastSource: eventBus1.getNodeId(),
          meta: { data: 'test-data' },
        }),
      );
    });

    it('should execute event locally when broadcasting', async () => {
      const localHandler = vi.fn();
      const remoteHandler = vi.fn();

      eventBus1.on('test.event', localHandler);
      eventBus2.on('test.event', remoteHandler);

      const results = await eventBus1.broadcast(
        'test.event',
        { meta: { data: 'test-data' } },
        { channels: ['test-channel'], excludeSelf: true },
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify local execution
      expect(localHandler).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
      expect(results[0].state).toBe(EventState.Succeeded);

      // Verify remote execution
      expect(remoteHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('excludeSelf functionality', () => {
    it('should exclude self when excludeSelf=true', async () => {
      const eventBus1Handler = vi.fn();
      const eventBus2Handler = vi.fn();

      eventBus1.on('test.event', eventBus1Handler);
      eventBus2.on('test.event', eventBus2Handler);

      await eventBus1.broadcast(
        'test.event',
        { meta: { data: 'test-data' } },
        { channels: ['test-channel'], excludeSelf: true },
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // EventBus1 should only receive local execution (1 time), should not receive broadcast
      expect(eventBus1Handler).toHaveBeenCalledTimes(1);

      // EventBus2 should receive broadcast (1 time)
      expect(eventBus2Handler).toHaveBeenCalledTimes(1);

      // Verify EventBus1 did not receive broadcast message
      const calls = eventBus1Handler.mock.calls;
      const hasBroadcast = calls.some((call) => call[0].broadcast === true);
      expect(hasBroadcast).toBe(false);
    });

    it('should include self when excludeSelf=false', async () => {
      const eventBus1Handler = vi.fn();
      const eventBus2Handler = vi.fn();

      eventBus1.on('test.event', eventBus1Handler);
      eventBus2.on('test.event', eventBus2Handler);

      await eventBus1.broadcast(
        'test.event',
        { meta: { data: 'test-data' } },
        { channels: ['test-channel'], excludeSelf: false },
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // EventBus1 should receive local execution + broadcast (2 times)
      expect(eventBus1Handler).toHaveBeenCalledTimes(2);

      // EventBus2 should receive broadcast (1 time)
      expect(eventBus2Handler).toHaveBeenCalledTimes(1);

      // Verify EventBus1 received broadcast message
      const calls = eventBus1Handler.mock.calls;
      const broadcastCalls = calls.filter((call) => call[0].broadcast === true);
      expect(broadcastCalls).toHaveLength(1);
    });
  });

  describe('Multiple Channels', () => {
    it('should broadcast to multiple channels', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      // Subscribe to different channels
      await eventBus1.subscribeBroadcast(['channel-a']);
      await eventBus2.subscribeBroadcast(['channel-b']);

      eventBus1.on('test.event', handler1);
      eventBus2.on('test.event', handler2);

      await eventBus1.broadcast(
        'test.event',
        { meta: { data: 'test-data' } },
        { channels: ['channel-a', 'channel-b'], excludeSelf: true },
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Both handlers should be called
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should only broadcast to specified channels', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      // Subscribe to different channels
      await eventBus1.subscribeBroadcast(['channel-a']);
      await eventBus2.subscribeBroadcast(['channel-b']);

      eventBus1.on('test.event', handler1);
      eventBus2.on('test.event', handler2);

      // Only broadcast to channel-a
      await eventBus1.broadcast(
        'test.event',
        { meta: { data: 'test-data' } },
        { channels: ['channel-a'], excludeSelf: true },
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Only the handler subscribed to channel-a should be called
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(0);
    });
  });

  describe('Broadcast Metadata', () => {
    it('should include broadcast metadata in context', async () => {
      const handler = vi.fn();
      eventBus2.on('test.event', handler);

      await eventBus1.broadcast(
        'test.event',
        { meta: { data: 'test-data' } },
        { channels: ['test-channel'], excludeSelf: true },
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          broadcast: true,
          broadcastChannels: ['test-channel'],
          broadcastId: expect.any(String),
          broadcastSource: eventBus1.getNodeId(),
          excludeSelf: true,
        }),
      );
    });

    it('should preserve original context data', async () => {
      const handler = vi.fn();
      eventBus2.on('test.event', handler);

      const originalContext = {
        customField: 'custom-value',
        data: { id: 123, user: 'test-user' },
        timestamp: 1234567890,
        traceId: 'original-trace-id',
      };

      await eventBus1.broadcast('test.event', originalContext, { channels: ['test-channel'], excludeSelf: true });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          // Broadcast metadata should be merged, not overwritten
          broadcast: true,
          customField: 'custom-value',
          data: { id: 123, user: 'test-user' },
        }),
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle broadcast adapter errors gracefully', async () => {
      const errorAdapter = {
        name: 'error-adapter',
        publish: vi.fn().mockRejectedValue(new Error('Publish failed')),
        subscribe: vi.fn().mockResolvedValue(undefined),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
      };

      eventBus1.addBroadcastAdapter(errorAdapter);

      const handler = vi.fn();
      eventBus1.on('test.event', handler);

      // Broadcast should not fail due to adapter errors
      await expect(
        eventBus1.broadcast(
          'test.event',
          { meta: { data: 'test-data' } },
          { channels: ['test-channel'], excludeSelf: true },
        ),
      ).resolves.toBeDefined();

      // Local execution should still succeed
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle handler errors in broadcast receivers', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('Handler failed'));
      const normalHandler = vi.fn();

      eventBus1.on('test.event', errorHandler);
      eventBus2.on('test.event', normalHandler);

      // Broadcast should not fail due to receiver handler errors
      await expect(
        eventBus1.broadcast(
          'test.event',
          { meta: { data: 'test-data' } },
          { channels: ['test-channel'], excludeSelf: false },
        ),
      ).resolves.toBeDefined();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Normal handler should still be called
      expect(normalHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Broadcast Filters', () => {
    it('should apply broadcast filters', async () => {
      const handler = vi.fn();

      eventBus2.on('test.event', handler, 2); // Register handler for version 2

      const filter = vi.fn().mockImplementation((message) => {
        return message.version === 2;
      });

      eventBus2.addBroadcastFilter(filter);

      // Version 1 message should be filtered
      await eventBus1.broadcast(
        'test.event',
        {
          meta: { data: 'test-data' },
          version: 1,
        },
        { channels: ['test-channel'], excludeSelf: true },
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(filter).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledTimes(0);

      // Reset
      handler.mockClear();
      filter.mockClear();

      // Version 2 message should pass through
      await eventBus1.broadcast(
        'test.event',
        {
          meta: { data: 'test-data' },
          version: 2,
        },
        { channels: ['test-channel'], excludeSelf: true },
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Adapter Management', () => {
    it('should allow adding and removing adapters', () => {
      const newAdapter = new MemoryBroadcastAdapter('new-adapter');

      eventBus1.addBroadcastAdapter(newAdapter);
      expect(eventBus1['broadcastAdapters'].has('new-adapter')).toBe(true);

      eventBus1.removeBroadcastAdapter('new-adapter');
      expect(eventBus1['broadcastAdapters'].has('new-adapter')).toBe(false);
    });

    it('should use specified adapters for broadcasting', async () => {
      const specificAdapter = new MemoryBroadcastAdapter('specific-adapter');
      eventBus1.addBroadcastAdapter(specificAdapter);

      const handler = vi.fn();
      eventBus2.on('test.event', handler);

      // Only use specific-adapter
      await eventBus1.broadcast(
        'test.event',
        { meta: { data: 'test-data' } },
        {
          adapters: ['specific-adapter'],
          channels: ['test-channel'],
          excludeSelf: true,
        },
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Unsubscribe', () => {
    it('should stop receiving broadcasts after unsubscribe', async () => {
      const handler = vi.fn();
      eventBus2.on('test.event', handler);

      // First test that broadcast can be received
      await eventBus1.broadcast(
        'test.event',
        { meta: { data: 'test-data' } },
        { channels: ['test-channel'], excludeSelf: true },
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(handler).toHaveBeenCalledTimes(1);

      // Unsubscribe
      await eventBus2.unsubscribeBroadcast(['test-channel']);

      // Reset counter
      handler.mockClear();

      // Broadcast again
      await eventBus1.broadcast(
        'test.event',
        { meta: { data: 'test-data' } },
        { channels: ['test-channel'], excludeSelf: true },
      );

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should no longer receive messages
      expect(handler).toHaveBeenCalledTimes(0);
    });
  });
});

/**
 * MemoryBroadcastAdapter.
 *
 * @author dafengzhen
 */
describe('MemoryBroadcastAdapter', () => {
  it('should share messages between instances', async () => {
    const adapter1 = new MemoryBroadcastAdapter('adapter1');
    const adapter2 = new MemoryBroadcastAdapter('adapter2');

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    await adapter1.subscribe('test-channel', handler1);
    await adapter2.subscribe('test-channel', handler2);

    const testMessage = {
      broadcastId: 'test-broadcast',
      context: { excludeSelf: true, meta: { data: 'test' } },
      eventName: 'test.event',
      id: 'test-id',
      source: 'test-source',
      timestamp: Date.now(),
      traceId: 'test-trace',
      version: 1,
    };

    await adapter1.publish('test-channel', testMessage);

    expect(handler1).toHaveBeenCalledTimes(0); // Publisher does not receive itself (excludeSelf=true)
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledWith(testMessage);
  });

  it('should handle unsubscribe correctly', async () => {
    const adapter = new MemoryBroadcastAdapter('test-adapter');
    const handler = vi.fn();

    await adapter.subscribe('test-channel', handler);

    // First publish to confirm subscription is working
    await adapter.publish('test-channel', {
      broadcastId: 'test-broadcast',
      context: { excludeSelf: false, meta: { data: 'test-1' } },
      eventName: 'test.event',
      id: 'test-1',
      source: 'test-source',
      timestamp: Date.now(),
      traceId: 'test-trace',
      version: 1,
    });

    expect(handler).toHaveBeenCalledTimes(1);

    // Unsubscribe
    await adapter.unsubscribe('test-channel');

    // Publish again
    await adapter.publish('test-channel', {
      broadcastId: 'test-broadcast',
      context: { excludeSelf: false, meta: { data: 'test-2' } },
      eventName: 'test.event',
      id: 'test-2',
      source: 'test-source',
      timestamp: Date.now(),
      traceId: 'test-trace',
      version: 1,
    });

    // Should no longer receive messages
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
