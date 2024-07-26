import { isEqual, throttle } from "lodash-es";
import { EventEmitter } from "events";

// hack for next.js edge runtime
const _queueMicrotask: typeof queueMicrotask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (fn) => Promise.resolve().then(fn);

const revalidateEE = new EventEmitter();
const revalidateAllStr = "__FN_MERGE_CACHE_INSIDE__all";

class FnMergeCache<A extends any[], R> {
  private _disposed = false;
  private _fn;
  private _persist;
  private _persistOnError;
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
   * Merge same (async) function calls by the same parameters (deep comparison)
   * @param {Function} fn
   * @param {object} opt
   * @param {boolean} opt.persist Whether to cache the call result
   * @param {boolean} opt.persistOnError Should the call result still be cached when error occurs
   * @param {Function} opt.argComparer Parameter comparison function, returns true if the parameters are consistent
   * @param {number} opt.ttl Cache lifetime, pass 0 means never expires. default 0
   * @param {number} opt.maxCacheSize Cache pool size limit, pass 0 means no limit
   * @param {string[]} opt.tags revalidate tags
   */
  constructor(
    fn: (...args: A) => R,
    {
      persist = false,
      persistOnError = false,
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
    this._persist = persist;
    this._persistOnError = persistOnError;
    this._argComparer = argComparer;
    this._ttl = ttl;
    this._maxCacheSize = maxCacheSize;
    this._tags = tags;

    revalidateEE.on(revalidateAllStr, this.revalidate);
    tags.forEach((tag) => revalidateEE.on(tag, this.revalidate));
  }

  call(...args: A): R {
    if (this._disposed) {
      throw new Error("FnMergeCache instance has been disposed");
    }

    if (this._persist) {
      _queueMicrotask(this._callGC);

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
          if (result[2]) throw result[2];
          return result[1]!;
        }

        this._result.delete(resultKey);
      }
    }

    const now = Date.now();
    try {
      const fnResult = this._fn.call(void 0, ...args);
      if (fnResult instanceof Promise) {
        this._result.set(args, [now, fnResult]); // for merge promise call

        return fnResult.then(
          (res) => {
            if (!this._persist) {
              this._result.delete(args);
            }
            return res;
          },
          (e) => {
            if (!this._persist || !this._persistOnError) {
              this._result.delete(args);
            }
            throw e;
          }
        ) as R;
      } else {
        if (this._persist) {
          this._result.set(args, [now, fnResult]);
        }
        return fnResult;
      }
    } catch (e) {
      if (this._persist && this._persistOnError) {
        this._result.set(args, [now, void 0, e]);
      }
      throw e;
    }
  }

  revalidate = () => {
    this._result.clear();
  };

  dispose() {
    this._disposed = true;
    this._result.clear();
    revalidateEE.off(revalidateAllStr, this.revalidate);
    this._tags.forEach((tag) => revalidateEE.off(tag, this.revalidate));
  }
}

export default FnMergeCache;

export function revalidateTag(tag: string | string[] = revalidateAllStr) {
  if (Array.isArray(tag)) {
    tag.forEach((t) => revalidateEE.emit(t));
  } else {
    revalidateEE.emit(tag);
  }
}
