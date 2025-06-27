# EvFlow

[![GitHub License](https://img.shields.io/github/license/dafengzhen/evflow?color=blue)](https://github.com/dafengzhen/evflow)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/dafengzhen/evflow/pulls)

**EvFlow** 是一个简单的事件管理库，支持依赖管理、生命周期钩子、中间件以及事件发布/订阅。它适用于一般的业务流程控制场景。

[English](./README.md)

## 安装

```bash
npm install evflow
```

## 快速示例

### 浏览器兼容性

EvFlow 提供了对旧浏览器的兼容版本（legacy build）

如果你的项目需要支持旧版浏览器，请使用以下方式引入：

```javascript
import {Dispatcher} from 'evflow/legacy';
```

### 基本用法

```javascript
import {Dispatcher} from 'evflow';

const hub = new Dispatcher();

// 注册依赖事件
hub.add('payment_processed');
hub.add('inventory_check');

// 注册主事件（依赖事件已存在）
hub.add('order_created', ['payment_processed', 'inventory_check']);

// 为所有依赖事件注册处理器
hub.handle('payment_processed', async () => {
  console.log('正在处理付款...');
  return {success: true};
});

hub.handle('inventory_check', async () => {
  console.log('正在检查库存...');
  return {stock: 100};
});

hub.handle('order_created', async (_, paymentResult, inventoryResult) => {
  console.log('订单已创建！', paymentResult, inventoryResult);
});

// 触发事件
await hub.run('order_created');

// 控制台输出：
/*
正在处理付款...
正在检查库存...
订单已创建！ { success: true } { stock: 100 }
*/
```

## 核心 API

### 方法

| 方法                                   | 描述                |
|--------------------------------------|-------------------|
| `add(event, deps?, tags?)`           | 注册事件              |
| `handle(eventId, handler)`           | 注册事件处理函数          |
| `run(eventId, options?)`             | 触发单个事件            |
| `runAll(eventIds?, mode?, options?)` | 触发多个事件            |
| `use(middleware)`                    | 向事件流添加中间件         |
| `subscribe(eventId, callback)`       | 订阅某事件的状态变化        |
| `unsubscribe(eventId, callback)`     | 取消订阅某事件的状态变化      |
| `onLifecycle(phase, hook)`           | 注册全局生命周期钩子        |
| `onEvent(eventId, phase, hook)`      | 为特定事件注册生命周期钩子     |
| `clear()`                            | 清除所有已注册的事件、处理器和状态 |

## 贡献

欢迎贡献！欢迎提交 Issue 或 Pull Request

## License

[MIT](https://opensource.org/licenses/MIT)

