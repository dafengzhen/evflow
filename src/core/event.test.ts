import { describe, expect, it, vi } from 'vitest';

import { StateMachine } from '../state/state-machine.ts';
import { Event } from './event.ts';

describe('Event', () => {
  const mockPayload = { data: 'test' };
  const mockResult = { success: true };

  it('initializes with a string id', () => {
    const event = new Event('event-1', mockPayload, mockResult);
    expect(event.context.id).toBe('event-1');
    expect(event.context.payload).toEqual(mockPayload);
    expect(event.context.result).toEqual(mockResult);
    expect(event.state).toBeInstanceOf(StateMachine);
  });

  it('initializes with an options object', () => {
    const options = { id: 'event-2', payload: mockPayload };
    const event = new Event(options);
    expect(event.context.id).toBe('event-2');
    expect(event.context.payload).toEqual(mockPayload);
  });

  it('updates state and context via transition', () => {
    const event = new Event('event-3');
    const spyTransition = vi.spyOn(event.state, 'transition');

    // Initial state is 'idle', can only transition to 'scheduled'
    event.transition('scheduled');
    expect(spyTransition).toHaveBeenCalledWith('scheduled');
    expect(event.context.status).toBe('scheduled');

    // Then transition to 'running'
    event.transition('running');
    expect(event.context.status).toBe('running');
  });

  it('throws an error when transition is invalid', () => {
    const event = new Event('event-4');
    expect(() => event.transition('completed')).toThrow('Invalid transition: idle → completed');
  });
});
