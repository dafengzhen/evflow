/**
 * EventCancelledError.
 *
 * @author dafengzhen
 */
export class EventCancelledError extends Error {
  constructor(message = 'Event cancelled') {
    super(message);
    this.name = 'EventCancelledError';
  }
}

/**
 * EventTimeoutError.
 *
 * @author dafengzhen
 */
export class EventTimeoutError extends Error {
  constructor(message = 'Event timeout') {
    super(message);
    this.name = 'EventTimeoutError';
  }
}
