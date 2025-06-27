import type { EventStatus } from '../types.ts';

const VALID_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  completed: [],
  failed: [],
  idle: ['scheduled'],
  retrying: ['running', 'failed'],
  running: ['completed', 'failed', 'timeout'],
  scheduled: ['running', 'timeout'],
  timeout: [],
};

export class StateMachine {
  get current(): EventStatus {
    return this._current;
  }

  get isTerminal(): boolean {
    return ['completed', 'failed', 'timeout'].includes(this._current);
  }

  private _current: EventStatus;

  constructor() {
    this._current = 'idle';
  }

  canTransition(to: EventStatus): boolean {
    const allowed = VALID_TRANSITIONS[this._current];
    if (!allowed) {
      throw new Error(`Unknown current state: ${this._current}.`);
    }
    return allowed.includes(to);
  }

  reset(): void {
    this._current = 'idle';
  }

  transition(to: EventStatus): void {
    if (!this.canTransition(to)) {
      throw new Error(`Invalid transition: ${this._current} → ${to}.`);
    }
    this._current = to;
  }
}
