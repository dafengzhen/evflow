import { beforeEach, describe, expect, it } from 'vitest';

import type { EventStatus } from '../types.ts';

import { StateMachine } from './state-machine.ts';

describe('StateMachine', () => {
  let machine: StateMachine;

  beforeEach(() => {
    machine = new StateMachine();
  });

  it("initial state should be 'idle'", () => {
    expect(machine.current).toBe('idle');
  });

  it('isTerminal returns true when in a terminal state', () => {
    ['completed', 'failed', 'timeout'].forEach((status) => {
      machine['_current'] = status as EventStatus;
      expect(machine.isTerminal).toBe(true);
    });

    ['idle', 'scheduled', 'running'].forEach((status) => {
      machine['_current'] = status as EventStatus;
      expect(machine.isTerminal).toBe(false);
    });
  });

  describe('state transitions', () => {
    const testCases: [EventStatus, EventStatus, boolean][] = [
      ['idle', 'scheduled', true],
      ['idle', 'running', false],
      ['scheduled', 'running', true],
      ['scheduled', 'timeout', true],
      ['scheduled', 'idle', false],
      ['running', 'completed', true],
      ['running', 'failed', true],
      ['running', 'timeout', true],
      ['running', 'scheduled', false],
    ];

    testCases.forEach(([from, to, valid]) => {
      it(`transition from ${from} to ${to} should ${valid ? 'succeed' : 'fail'}`, () => {
        machine['_current'] = from;
        if (valid) {
          expect(() => machine.transition(to)).not.toThrow();
          expect(machine.current).toBe(to);
        } else {
          expect(() => machine.transition(to)).toThrow(/Invalid transition/);
        }
      });
    });
  });

  it('throws an error when transitioning to an invalid state', () => {
    expect(() => machine.transition('completed')).toThrowError('Invalid transition: idle → completed.');
  });

  it('throws an error when attempting an invalid transition', () => {
    const sm = new StateMachine();
    const invalidTarget: EventStatus = 'completed';

    expect(() => sm.transition(invalidTarget)).toThrowError(`Invalid transition: idle → ${invalidTarget}.`);
  });

  it('throws an error if current state is not in VALID_TRANSITIONS', () => {
    const sm = new StateMachine() as any;
    sm._current = 'unknown';

    expect(() => sm.canTransition('scheduled')).toThrowError('Unknown current state: unknown');
  });
});
