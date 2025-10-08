## 📌 Introduction

[![GitHub License](https://img.shields.io/github/license/dafengzhen/evflow?color=blue)](https://github.com/dafengzhen/evflow)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/dafengzhen/evflow/pulls)

**EventBus** is a TypeScript-based typed event bus implementation that provides a modular and extensible event system.

It supports global and scoped middleware, plugin mechanisms, pattern-based event matching, priority and concurrency control, as well as robust error handling mechanisms.

[简体中文](./README.zh.md)

## ✨ Features

- Global and scoped middleware
- Plugin mechanism
- Event pattern matching (supports wildcards)
- Concurrency and sequential execution
- Support for one-time event handlers
- Timeout and error handling mechanisms

## 📦 Installation

```bash
npm install evflow
```

## 🚀 Usage

```ts
import { EventBus } from "evflow";

type MyEvents = {
  dataFetch: { url: string };
  userLogin: { username: string };
};

const bus = new EventBus<MyEvents>();

// Subscribe
bus.on('userLogin', async (ctx) => {
  console.log('User logged in:', ctx.data.username);
});

// Emit
await bus.emit('userLogin', { data: { username: 'alice' } });
```

```ts
bus.on('dataFetch', async (ctx) => {
  // Simulate request
  await new Promise((r) => setTimeout(r, 200));
  return `Fetched from ${ctx.data.url}`;
});

const results = await bus.emit(
  'dataFetch',
  { data: { url: 'https://api.example.com' } },
  { maxRetries: 3, retryDelay: 100, timeout: 1000 },
  { globalTimeout: 2000, parallel: true, stopOnError: false },
);

console.log(results);
```

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

## License

[MIT](https://opensource.org/licenses/MIT)

