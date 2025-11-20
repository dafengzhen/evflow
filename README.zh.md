## 📌 简介

[![GitHub License](https://img.shields.io/github/license/dafengzhen/evflow?color=blue)](https://github.com/dafengzhen/evflow)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/dafengzhen/evflow/pulls)

一个基于 TypeScript 的 **强类型事件系统**，支持：

- ✔️ 事件监听与触发
- ✔️ 事件优先级（priority）
- ✔️ 一次性监听（once）
- ✔️ 任务执行状态（pending/running/retrying/succeeded/failed/timeout/cancelled）
- ✔️ 超时控制（timeout）
- ✔️ AbortSignal 取消
- ✔️ 自动重试机制（maxRetries / retryDelay / isRetryable）
- ✔️ 强类型 Payload 与 Context 推断

本库旨在提供一个更安全、更可控、更灵活的事件执行机制

[English](./README.md)

## 📦 安装

```bash
npm install evflow
```

## 🚀 示例

```ts
import { createEventEmitter } from "evflow";

interface AppEvents extends BaseEventDefinitions {
  'user:registered': {
    payload: {
      userId: string;
      email: string;
    };
  };
}

const emitter = createEventEmitter<AppEvents>();

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

## 贡献

欢迎贡献 PR！

## License

[MIT](https://opensource.org/licenses/MIT)

