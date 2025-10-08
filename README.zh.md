## 📌 简介

[![GitHub License](https://img.shields.io/github/license/dafengzhen/evflow?color=blue)](https://github.com/dafengzhen/evflow)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/dafengzhen/evflow/pulls)

**EventBus** 是一个基于 TypeScript 的类型事件总线实现，提供模块化、可扩展的事件系统

它支持全局和局部作用域的中间件、插件机制、基于模式的事件匹配、优先级与并发控制，以及健壮的错误处理机制

[English](./README.md)

## ✨ 特性

- 全局和局部中间件
- 插件机制
- 事件模式匹配（支持通配符）
- 并发与顺序执行
- 支持一次性事件处理器
- 超时与错误处理机制

## 📦 安装

```bash
npm install evflow
```

## 🚀 使用示例

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

## 贡献

欢迎贡献！欢迎提交 Issue 或 Pull Request

## License

[MIT](https://opensource.org/licenses/MIT)

