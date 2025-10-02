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
