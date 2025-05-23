import type { EventStatus } from '../types.ts';

const VALID_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  completed: [],
  failed: [],
  idle: ['scheduled'],
  running: ['completed', 'failed', 'terminated'],
  scheduled: ['running', 'terminated'],
  terminated: [],
};

export class StateMachine {
  get current(): EventStatus {
    return this._current;
  }

  get isTerminal(): boolean {
    return ['completed', 'failed', 'terminated'].includes(this._current);
  }

  private _current: EventStatus;

  constructor() {
    this._current = 'idle';
  }

  canTransition(to: EventStatus): boolean {
    return VALID_TRANSITIONS[this._current].includes(to);
  }

  transition(to: EventStatus): void {
    if (!this.canTransition(to)) {
      throw new Error(`Invalid transition: ${this._current} → ${to}.`);
    }
    this._current = to;
  }
}
