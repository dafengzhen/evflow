# EvFlow

[![GitHub License](https://img.shields.io/github/license/dafengzhen/evflow?color=blue)](https://github.com/dafengzhen/evflow)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/dafengzhen/evflow/pulls)

**EvFlow** is a simple event management library that supports dependency management, lifecycle hooks, middleware, and
event publishing/subscription. It's designed for use cases involving general business flow control.

[简体中文](./README.zh.md)

## Installation

```bash
npm install evflow
```

## Quick Example

### Browser Compatibility

EvFlow provides a legacy build for compatibility with older browsers.

If your project needs to support older versions of browsers, please import it as follows:

```javascript
import {Dispatcher} from 'evflow/legacy';
```

### Basic Usage

```javascript
import {Dispatcher} from 'evflow';

const hub = new Dispatcher();

// Register dependencies
hub.add('payment_processed');
hub.add('inventory_check');

// Register main event (dependencies already exist)
hub.add('order_created', ['payment_processed', 'inventory_check']);

// Register handlers for all dependencies
hub.handle('payment_processed', async () => {
  console.log('Processing payment...');
  return {success: true};
});

hub.handle('inventory_check', async () => {
  console.log('Checking inventory...');
  return {stock: 100};
});

hub.handle('order_created', async (_, paymentResult, inventoryResult) => {
  console.log('Order created!', paymentResult, inventoryResult);
});

// Dispatch event
await hub.run('order_created');

// Console logs
/*
Processing payment...
Checking inventory...
Order created! { success: true } { stock: 100 }
*/
```

## Core API

### Methods

| Method                           | Description                                        |
|----------------------------------|----------------------------------------------------|
| `add(event, deps?, tags?)`       | Registers an event.                                |
| `handle(eventId, handler)`       | Registers an event handler.                        |
| `run(eventId)`                   | Dispatches a single event.                         |
| `runAll(eventIds?, mode?)`       | Dispatches multiple events.                        |
| `use(middleware)`                | Adds middleware to the event flow.                 |
| `subscribe(eventId, callback)`   | Subscribes to state changes for a given event.     |
| `unsubscribe(eventId, callback)` | Unsubscribes from an event's state changes.        |
| `onLifecycle(phase, hook)`       | Registers a global lifecycle hook.                 |
| `onEvent(eventId, phase, hook)`  | Registers a lifecycle hook for a specific event.   |
| `clear()`                        | Clears all registered events, handlers, and state. |

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

## License

[MIT](https://opensource.org/licenses/MIT)

