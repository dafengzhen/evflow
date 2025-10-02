## 📌 简介

[![GitHub License](https://img.shields.io/github/license/dafengzhen/evflow?color=blue)](https://github.com/dafengzhen/evflow)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/dafengzhen/evflow/pulls)

EventBus 是一个轻量级、TypeScript 优先的事件系统，支持 异步任务处理、重试机制、超时控制 和 任务取消

非常适合在事件驱动架构中使用，尤其是事件可能失败、超时或需要重试的场景

[English](./README.md)

## ✨ 特性

- TypeScript 强类型事件定义
- 支持并行或串行执行
- 全局超时控制
- 重试 + 回退策略
- 任务可取消
- 状态变更钩子
- 事件持久化
- 事件版本化
- 事件版本迁移
- 事件广播
- 中间件系统

## 📦 安装

```bash
npm install evflow
```

## 🚀 使用示例

```ts
import { EventBus, EventState } from "evflow";

type MyEvents = {
  userLogin: { username: string };
  dataFetch: { url: string };
};

const bus = new EventBus<MyEvents>();

// 订阅事件
bus.on("userLogin", async (ctx) => {
  console.log("用户登录:", ctx.meta.username);
});

// 触发事件
bus.emit("userLogin", { meta: { username: "alice" } });
```

```ts
bus.on("dataFetch", async (ctx) => {
  // 模拟请求
  await new Promise((r) => setTimeout(r, 200));
  return `来自 ${ctx.meta.url} 的数据`;
});

const results = await bus.emit(
  "dataFetch",
  { meta: { url: "https://api.example.com" } },
  { retries: 3, retryDelay: 100, timeout: 1000 },
  { parallel: true, stopOnError: false, globalTimeout: 2000 }
);

console.log(results);
```

## 贡献

欢迎贡献！欢迎提交 Issue 或 Pull Request

## License

[MIT](https://opensource.org/licenses/MIT)

