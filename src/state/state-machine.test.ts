import { beforeEach, describe, expect, it } from 'vitest';

import type { EventStatus } from '../types';

import { StateMachine } from './state-machine';

describe('StateMachine', () => {
  let machine: StateMachine;

  beforeEach(() => {
    machine = new StateMachine();
  });

  it("initial state should be 'idle'", () => {
    expect(machine.current).toBe('idle');
  });

  it('isTerminal returns true when in a terminal state', () => {
    ['completed', 'failed', 'terminated'].forEach((status) => {
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
      ['scheduled', 'terminated', true],
      ['scheduled', 'idle', false],
      ['running', 'completed', true],
      ['running', 'failed', true],
      ['running', 'terminated', true],
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
});
