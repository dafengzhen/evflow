## 📌 Introduction

[![GitHub License](https://img.shields.io/github/license/dafengzhen/evflow?color=blue)](https://github.com/dafengzhen/evflow)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/dafengzhen/evflow/pulls)

A fully type-safe, feature-rich **event system** built with TypeScript, supporting:

- ✔️ Event listeners & emitters
- ✔️ Listener priority ordering
- ✔️ One-time listeners (`once`)
- ✔️ Execution state tracking
- ✔️ Timeout & cancellation via `AbortSignal`
- ✔️ Retry mechanism (maxRetries / retryDelay / isRetryable)
- ✔️ Strongly-typed payloads & contexts
- ✔️ Hooks for retry, timeout, cancellation, and state changes

This project aims to provide a safer and more controllable alternative to traditional event emitter implementations.

[简体中文](./README.zh.md)

## 📦 Installation

```bash
npm install evflow
```

## 🚀 Usage

```ts
import { EventEmitter } from "evflow";

interface AppEvents extends BaseEventDefinitions {
  'user:registered': {
    payload: {
      userId: string;
      email: string;
    };
  };
}

const emitter = new EventEmitter<AppEvents>();

// High priority: Send welcome email
emitter.on(
  'user:registered',
  async ({ email }) => {
    console.log(`[Email] Sending welcome email to ${email}`);
    // Simulate success
  },
  { priority: 10 },
);

// Low priority: Create default user configuration
emitter.on(
  'user:registered',
  async ({ userId }) => {
    console.log(`[Config] Creating initial configuration for ${userId}`);
  },
  { priority: 0 },
);

await emitter.emit(
  'user:registered',
  { userId: 'u_001', email: 'test@example.com' },
  undefined,
  {
    maxRetries: 2,
    isRetryable: () => true,
  },
);

// [Email] Sending welcome email to test@example.com
// [Config] Creating initial configuration for u_001
```

## Contributing

Pull requests are welcome!

## License

[MIT](https://opensource.org/licenses/MIT)

