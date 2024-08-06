# fn-merge-cache

`FnMergeCache` is a caching utility that allows functions to cache their results based on input arguments, with options for cache lifetime, size limits, error handling, and parameter comparison, while supporting cache invalidation via tags and global revalidation.

[![NPM version](https://img.shields.io/npm/v/fn-merge-cache.svg?style=flat)](https://npmjs.com/package/fn-merge-cache)
[![NPM downloads](http://img.shields.io/npm/dm/fn-merge-cache.svg?style=flat)](https://npmjs.com/package/fn-merge-cache)
[中文文档](https://github.com/hurryhuang1007/fn-merge-cache/blob/main/README.zh.md)

## Install

```bash
npm install fn-merge-cache
```

## Features

1. Cache function: supports caching the return results of functions to improve performance and reduce repeated calculations.
2. Cache expiration: supports setting the expiration time (TTL) of the cache, and automatically clears the cache after the time expires.
3. Cache size limit: supports setting the maximum cache size to limit the size of the cache pool.
4. Error handling: you can choose whether to cache the error result when the function call fails.
5. Parameter comparison: allows custom parameter comparison functions to determine whether the cached results can be used.
6. Cache invalidation: cache invalidation and revalidation (revalidation) through the tag mechanism, you can revalidate the cache by tag or globally.
7. Merge promises: support processing the returned Promise, and update the cache status after the Promise is resolved.
8. Event-driven: use EventEmitter for cache invalidation notification, allowing fine control over the validity of the cache.

## API

### FnMergeCache

A tool for caching function call results, supporting cache expiration, size limits, error handling, tag mechanisms, and more.

#### Constructor

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

#### Parameters

- fn: The function to be cached.
- cache: Whether to enable caching. Default is true.
- cacheOnError: Whether to cache the result even if the function throws an error. Default is false.
- argComparer: A custom function to compare function arguments. Defaults to lodash's isEqual.
- ttl: The cache time-to-live (in milliseconds), 0 means never expires. Default is 0.
- maxCacheSize: The maximum number of cached items, 0 means no limit. Default is 0.
- tags: Tags for cache invalidation.

#### Methods

- `call(...args: A): R`

  Calls the cached function with the provided arguments args, returning the result. If a valid cached result exists, it returns the cached result; otherwise, it executes the function and caches the result.

- `revalidate()`

  Clears all cached data. This method clears all cache data related to the instance.

- `dispose()`

  Releases the cache instance resources, stops caching, and removes all event listeners.

### createMergedCachedFn

Creates a function with caching functionality.

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

#### Parameters

- fn: The function to be cached.
- opt: Cache options, same as the options for FnMergeCache constructor.

#### Returns

A function with caching functionality, behaving the same as FnMergeCache.

### revalidateTag

Revalidate the cache by tag(s) or globally.

```typescript
function revalidateTag(tags?: string | string[]): void
```

## Basic Usage

```javascript
import { FnMergeCache, revalidateTag } from 'fn-merge-cache';

// define a function that needs to be cached
function fetchData(id) {
  console.log(`Fetching data for ${id}`);
  return new Promise((resolve) => {
    setTimeout(() => resolve(`Data for ${id}`), 1000);
  });
}

// create a cache instance
const cache = new FnMergeCache(fetchData, {
  cache: true, // enable cache
  cacheOnError: true, // cache error results
  ttl: 5000, // cache expiration time
  maxCacheSize: 10, // maximum cache size
  tags: ['data-fetch'], // cache tags
});

// call the function with the same parameter
cache.call(1).then((data) => {
  console.log(data); // Output: Fetching data for 1 \n Data for 1
});
cache.call(1).then((data) => {
  console.log(data); // Output: Data for 1 (from cache)
});

// call the function with different parameters
cache.call(2).then((data) => {
  console.log(data); // Output: Fetching data for 2 \n Data for 2
});

// revalidate the cache
cache.revalidate();

// or revalidate the cache by tag(s)
revalidateTag('data-fetch');

// or revalidate all caches
revalidateTag();

// call the function with the same parameter
cache.call(1).then((data) => {
  console.log(data); // Output: Fetching data for 1 \n Data for 1 (fetch again)
});

// dispose the cache instance
cache.dispose();
```

### if a cache instance DO NOT need to be disposed, you can use the createMergedCachedFn function

```javascript
import { createMergedCachedFn, revalidateTag } from 'fn-merge-cache';

const mergedCachedFn = createMergedCachedFn(fetchData, {
  cache: true,
  cacheOnError: true,
  ttl: 5000,
  maxCacheSize: 10,
  tags: ['data-fetch'],
});

// call the function with the same parameter
mergedCachedFn(1).then((data) => {
  console.log(data); // Output: Fetching data for 1 \n Data for 1
});

// revalidate the cache
revalidateTag('data-fetch');
```

## Merge Usage (only when the fn returns a Promise (async function))

```javascript
import { createMergedCachedFn } from 'fn-merge-cache';

const justMergeFn = createMergedCachedFn(fetchData, {
  cache: false,
});

justMergeFn(1).then((data) => {
  console.log(data); // Output: Fetching data for 1 \n Data for 1
});
justMergeFn(1).then((data) => {
  console.log(data); // Output: Data for 1 (merged call)

  justMergeFn(1).then((data) => {
    console.log(data); // Output: Fetching data for 1 \n Data for 1 (fetch again)
  });
});
```

## LICENSE

MIT
