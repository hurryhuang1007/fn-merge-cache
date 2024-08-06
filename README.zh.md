### fn-merge-cache

`FnMergeCache` 是一个缓存工具，允许函数根据输入参数缓存其结果，支持缓存过期时间、大小限制、错误处理和参数比较，同时支持通过标签和全局重新验证进行缓存失效。

[![NPM version](https://img.shields.io/npm/v/fn-merge-cache.svg?style=flat)](https://npmjs.com/package/fn-merge-cache)
[![NPM downloads](http://img.shields.io/npm/dm/fn-merge-cache.svg?style=flat)](https://npmjs.com/package/fn-merge-cache)

## 安装

```bash
npm install fn-merge-cache
```

## 功能

1. 缓存函数：支持缓存函数的返回结果，以提高性能和减少重复计算。
2. 缓存过期：支持设置缓存的过期时间（TTL），并在时间到期后自动清除缓存。
3. 缓存大小限制：支持设置最大缓存大小，以限制缓存池的大小。
4. 错误处理：可以选择在函数调用失败时是否缓存错误结果。
5. 参数比较：允许自定义参数比较函数，以确定是否可以使用缓存结果。
6. 缓存失效：通过标签机制进行缓存失效和重新验证，可以按标签或全局重新验证缓存。
7. 合并承诺：支持处理返回的 Promise，并在 Promise 解决后更新缓存状态。
8. 事件驱动：使用 EventEmitter 进行缓存失效通知，允许对缓存的有效性进行精细控制。
9. 智能缓存策略：未设置缓存ttl时，将切换使用 LRU 算法。

## API

### FnMergeCache

一个用于缓存函数调用结果的工具，支持缓存过期、大小限制、错误处理、标签机制等功能。

#### 构造函数

```typescript
new FnMergeCache<A extends any[], R>(
  fn: (...args: A) => R,
  opt?: {
    cache?: boolean;
    cacheOnError?: boolean;
    argComparer?: (a: A, b: A) => boolean;
    ttl?: number;
    maxCacheSize?: number;
    tags?: string[];
  }
)
```

#### 参数

- fn: 要缓存的函数。
- cache: 是否启用缓存。默认值为 true。
- cacheOnError: 是否在函数抛出错误时缓存结果。默认值为 false。
- argComparer: 用于比较函数参数的自定义函数。默认使用 lodash 的 isEqual。
- ttl: 缓存的生存时间（毫秒），0 表示永不过期。默认值为 0。
- maxCacheSize: 缓存的最大数量，0 表示没有限制。默认值为 0。
- tags: 缓存失效的标签。

#### 方法

- `call(...args: A): R`

  使用提供的参数调用缓存的函数，并返回结果。如果存在有效的缓存结果，则返回缓存结果；否则，执行函数并缓存结果。

- `revalidate()`

  清除所有缓存数据。此方法清除与实例相关的所有缓存数据。

- `dispose()`

  释放缓存实例资源，停止缓存，并移除所有事件监听器。

### createMergedCachedFn

创建一个带有缓存功能的函数。

```typescript
function createMergedCachedFn<A extends any[], R>(
  fn: (...args: A) => R,
  opt?: {
    cache?: boolean;
    cacheOnError?: boolean;
    argComparer?: (a: A, b: A) => boolean;
    ttl?: number;
    maxCacheSize?: number;
    tags?: string[];
  }
): (...args: A) => R
```

#### 参数

- fn: 要缓存的函数。
- opt: 缓存选项，与 FnMergeCache 构造函数的选项相同。

#### 返回值

一个带有缓存功能的函数，行为与 FnMergeCache 相同。

### revalidateTag

通过标签或全局重新验证缓存。

```typescript
function revalidateTag(tags?: string | string[]): void
```

## 基本用法

```javascript
import { FnMergeCache, revalidateTag } from 'fn-merge-cache';

// 定义一个需要缓存的函数
function fetchData(id) {
  console.log(`Fetching data for ${id}`);
  return new Promise((resolve) => {
    setTimeout(() => resolve(`Data for ${id}`), 1000);
  });
}

// 创建一个缓存实例
const cache = new FnMergeCache(fetchData, {
  cache: true, // 启用缓存
  cacheOnError: true, // 缓存错误结果
  ttl: 5000, // 缓存过期时间
  maxCacheSize: 10, // 最大缓存大小
  tags: ['data-fetch'], // 缓存标签
});

// 使用相同参数调用函数
cache.call(1).then((data) => {
  console.log(data); // 输出: Fetching data for 1 \n Data for 1
});
cache.call(1).then((data) => {
  console.log(data); // 输出: Data for 1 (来自缓存)
});

// 使用不同参数调用函数
cache.call(2).then((data) => {
  console.log(data); // 输出: Fetching data for 2 \n Data for 2
});

// 重新验证缓存
cache.revalidate();

// 或通过标签重新验证缓存
revalidateTag('data-fetch');

// 或重新验证所有缓存
revalidateTag();

// 使用相同参数调用函数
cache.call(1).then((data) => {
  console.log(data); // 输出: Fetching data for 1 \n Data for 1 (重新获取)
});

// 释放缓存实例
cache.dispose();
```

### 如果缓存实例不需要释放，可以使用 createMergedCachedFn 函数

```javascript
import { createMergedCachedFn, revalidateTag } from 'fn-merge-cache';

const mergedCachedFn = createMergedCachedFn(fetchData, {
  cache: true,
  cacheOnError: true,
  ttl: 5000,
  maxCacheSize: 10,
  tags: ['data-fetch'],
});

// 使用相同参数调用函数
mergedCachedFn(1).then((data) => {
  console.log(data); // 输出: Fetching data for 1 \n Data for 1
});

// 重新验证缓存
revalidateTag('data-fetch');
```

## 合并用法（仅当函数返回 Promise（异步函数）时）

```javascript
import { createMergedCachedFn } from 'fn-merge-cache';

const justMergeFn = createMergedCachedFn(fetchData, {
  cache: false,
});

justMergeFn(1).then((data) => {
  console.log(data); // 输出: Fetching data for 1 \n Data for 1
});
justMergeFn(1).then((data) => {
  console.log(data); // 输出: Data for 1 (合并调用)

  justMergeFn(1).then((data) => {
    console.log(data); // 输出: Fetching data for 1 \n Data for 1 (重新获取)
  });
});
```

## 许可证

MIT
