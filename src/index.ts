import { isEqual, throttle } from "lodash-es";
import { EventEmitter } from "events";

// hack for next.js edge runtime
const _queueMicrotask: typeof queueMicrotask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (fn) => Promise.resolve().then(fn);

const revalidateEE = new EventEmitter();
const revalidateAllStr = "__FN_MERGE_CACHE_INSIDE__all";

/**
 * A class for merging and caching function calls
 *
 * @typeParam A - Tuple type of function parameters
 * @typeParam R - Function return type
 */
export class FnMergeCache<A extends any[], R> {
  private _disposed = false;
  private _fn;
  private _cache;
  private _cacheOnError;
  private _argComparer;
  private _ttl;
  private _maxCacheSize;
  private _tags;

  private _result = new Map<A, [number, R?, any?]>(); // arg: [time, result, error]

  private _callGC = throttle(() => {
    const now = Date.now();
    for (const [k, v] of this._result) {
      if (
        (this._ttl && now - v[0] > this._ttl) ||
        (this._maxCacheSize && this._result.size > this._maxCacheSize)
      ) {
        this._result.delete(k);
      } else {
        // Since it is sorted by time, you can exit once you encounter an unexpired one.
        break;
      }
    }
  }, 1000);

  /**
   * Creates a new FnMergeCache instance
   *
   * @param fn - The original function to be cached
   * @param options - Configuration options
   * @param options.cache - Whether to enable caching
   * @param options.cacheOnError - Whether to cache results when errors occur
   * @param options.argComparer - Parameter comparison function, returns true if parameters are equal
   * @param options.ttl - Cache lifetime in milliseconds, 0 means never expires
   * @param options.maxCacheSize - Cache pool size limit, 0 means no limit
   * @param options.tags - Tags for cache revalidation
   *
   * @throws Error when using reserved tag names
   */
  constructor(
    fn: (...args: A) => R,
    {
      cache = true,
      cacheOnError = false,
      argComparer = isEqual,
      ttl = 0,
      maxCacheSize = 0,
      tags = [] as string[],
    } = {}
  ) {
    if (tags.includes(revalidateAllStr)) {
      throw new Error(
        `Tag name "${revalidateAllStr}" is reserved, please use another tag name`
      );
    }

    this._fn = fn;
    this._cache = cache;
    this._cacheOnError = cacheOnError;
    this._argComparer = argComparer;
    this._ttl = ttl;
    this._maxCacheSize = maxCacheSize;
    this._tags = tags;

    revalidateEE.on(revalidateAllStr, this.revalidate);
    tags.forEach((tag) => revalidateEE.on(tag, this.revalidate));
  }

  /**
   * Calls the cached function
   *
   * @param args - Arguments passed to the original function
   * @returns Function return value, may be cached result
   * @throws Error if instance is disposed or original function throws
   */
  call(...args: A): R {
    if (this._disposed) {
      throw new Error("FnMergeCache instance has been disposed");
    }

    if (this._cache && (this._ttl || this._maxCacheSize)) {
      _queueMicrotask(this._callGC);
    }

    let resultKey;
    for (const k of this._result.keys()) {
      if (this._argComparer(k, args)) {
        resultKey = k;
        break;
      }
    }
    if (resultKey) {
      const result = this._result.get(resultKey)!;
      if (!this._ttl || Date.now() - result[0] <= this._ttl) {
        if (this._cache && !this._ttl && this._maxCacheSize) {
          // use lru strategy
          this._result.delete(resultKey);
          this._result.set(resultKey, result);
        }

        if (result[2]) throw result[2];
        return result[1]!;
      }

      this._result.delete(resultKey);
    }

    const now = Date.now();
    try {
      const fnResult = this._fn.call(void 0, ...args);
      if (fnResult instanceof Promise) {
        this._result.set(args, [now, fnResult]); // for merge promise call

        fnResult.then(
          () => {
            if (!this._cache) {
              this._result.delete(args);
            }
          },
          () => {
            if (!this._cache || !this._cacheOnError) {
              this._result.delete(args);
            }
          }
        );

        return fnResult;
      } else {
        if (this._cache) {
          this._result.set(args, [now, fnResult]);
        }
        return fnResult;
      }
    } catch (e) {
      if (this._cache && this._cacheOnError) {
        this._result.set(args, [now, void 0, e]);
      }
      throw e;
    }
  }

  /**
   * Clears all cached results
   */
  revalidate = () => {
    this._result.clear();
  };

  /**
   * Destroys the instance, clears all caches and event listeners
   */
  dispose() {
    this._disposed = true;
    this._result.clear();
    revalidateEE.off(revalidateAllStr, this.revalidate);
    this._tags.forEach((tag) => revalidateEE.off(tag, this.revalidate));
  }
}

export default FnMergeCache;

/**
 * Creates a function with caching capability
 *
 * @typeParam A - Tuple type of function parameters
 * @typeParam R - Function return type
 * @param fn - The original function to be cached
 * @param opts - FnMergeCache configuration options
 * @param opts.cache - Whether to enable caching
 * @param opts.cacheOnError - Whether to cache results when errors occur
 * @param opts.argComparer - Parameter comparison function, returns true if parameters are equal
 * @param opts.ttl - Cache lifetime in milliseconds, 0 means never expires
 * @param opts.maxCacheSize - Cache pool size limit, 0 means no limit
 * @param opts.tags - Tags for cache revalidation
 * @returns A new function with caching capability
 */
export function createMergedCachedFn<A extends any[], R>(
  fn: (...args: A) => R,
  opts: ConstructorParameters<typeof FnMergeCache>[1]
) {
  const cache = new FnMergeCache(fn, opts);
  return cache.call.bind(cache);
}

/**
 * Invalidates cache for specified tags
 *
 * @param tag - Tag or array of tags to invalidate, defaults to invalidating all caches
 */
export function revalidateTag(tag: string | string[] = revalidateAllStr) {
  if (Array.isArray(tag)) {
    tag.forEach((t) => revalidateEE.emit(t));
  } else {
    revalidateEE.emit(tag);
  }
}
