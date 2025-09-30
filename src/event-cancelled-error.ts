export class EventCancelledError extends Error {
  constructor(message = 'Event cancelled') {
    super(message);
    this.name = 'EventCancelledError';
  }
}
