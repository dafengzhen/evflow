import type { EventContext, EventOptions, EventStatus } from '../types.ts';

import { StateMachine } from '../state/state-machine.ts';

export class Event<TPayload = any, TResult = any> {
  readonly context: EventContext<TPayload, TResult>;

  readonly initialPayload: TPayload;

  readonly state: StateMachine;

  constructor(id: EventOptions | string, payload?: TPayload, result?: TResult) {
    let options: EventOptions;
    if (typeof id === 'string') {
      options = { id, payload, result };
    } else {
      options = id;
    }

    this.state = new StateMachine();
    this.initialPayload = options.payload as TPayload;
    this.context = {
      id: options.id,
      payload: options.payload,
      result: options.result,
      status: this.state.current,
    };
  }

  reset(preservePayload = false): void {
    this.state.reset();

    if (!preservePayload) {
      this.context.payload = this.initialPayload;
    }

    this.context.status = this.state.current;
  }

  transition(to: EventStatus): void {
    this.state.transition(to);
    this.context.status = this.state.current;
  }

  updatePayload(payload: TPayload): void {
    this.context.payload = payload;
  }
}
