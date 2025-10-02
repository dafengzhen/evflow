## 📌 Introduction

[![GitHub License](https://img.shields.io/github/license/dafengzhen/evflow?color=blue)](https://github.com/dafengzhen/evflow)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/dafengzhen/evflow/pulls)

`EventBus` is a lightweight, TypeScript-first event system with **async task handling**, **retries**, **timeouts**, and **cancellation support**.

It is designed for building reliable event-driven applications where event handlers may fail, timeout, or need retries.

[简体中文](./README.zh.md)

## ✨ Features

- TypeScript generic event typing
- Parallel or serial event emission
- Global timeout control
- Retry with backoff strategy
- Task cancellation
- Hook for task state change
- Event persistence
- Event versioning
- Event version migration
- Event broadcast
- Middleware system

## 📦 Installation

```bash
npm install evflow
```

## 🚀 Usage

```ts
import { EventBus, EventState } from "evflow";

type MyEvents = {
  userLogin: { username: string };
  dataFetch: { url: string };
};

const bus = new EventBus<MyEvents>();

// Subscribe
bus.on("userLogin", async (ctx) => {
  console.log("User logged in:", ctx.meta.username);
});

// Emit
bus.emit("userLogin", { meta: { username: "alice" } });
```

```ts
bus.on("dataFetch", async (ctx) => {
  // Simulate request
  await new Promise((r) => setTimeout(r, 200));
  return `Fetched from ${ctx.meta.url}`;
});

const results = await bus.emit(
  "dataFetch",
  { meta: { url: "https://api.example.com" } },
  { retries: 3, retryDelay: 100, timeout: 1000 },
  { parallel: true, stopOnError: false, globalTimeout: 2000 }
);

console.log(results);
```

## Contributing

Contributions are welcome! Feel free to submit issues or pull requests.

## License

[MIT](https://opensource.org/licenses/MIT)

