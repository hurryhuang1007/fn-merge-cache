import { isEqual, throttle } from "lodash-es";
import { EventEmitter } from "events";

const oneHour = 60 * 60 * 1000;
// hack for next.js edge runtime
const _queueMicrotask: typeof queueMicrotask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (fn) => Promise.resolve().then(fn);
export type PromiseFn<A extends any[], R> = (...args: A) => Promise<R> | R;

const revalidateEE = new EventEmitter();

class MergePromise<A extends any[], R> {
  private _promiseFn;
  private _persist;
  private _persistOnReject;
  private _argComparer;
  private _ttl;
  private _maxCacheSize;
  private _tags;

  private _pending = new Map<
    A,
    [((value: R) => void)[], ((reason?: any) => void)[]]
  >(); // arg: [[resolve, ...], [reject, ...]]
  private _result = new Map<A, [number, R?, Error?]>(); // arg: [time, result, error]

  private _callGC = throttle(() => {
    const now = Date.now();
    for (const [k, v] of this._result) {
      if ((this._ttl && now - v[0] > this._ttl) || (this._maxCacheSize && this._result.size > this._maxCacheSize)) {
        this._result.delete(k);
      } else {
        // Since it is sorted by time, you can exit once you encounter an unexpired one.
        break;
      }
    }
  }, 1000);

  /**
   * Merge promise calls with the same parameters (deep comparison)
   * @param {Function} promiseFn
   * @param {object} opt
   * @param {boolean} opt.persist Whether to cache the call result
   * @param {boolean} opt.persistOnReject Should the call result still be cached when rejected
   * @param {Function} opt.argComparer Parameter comparison function, returns true if the parameters are consistent
   * @param {number} opt.ttl Cache lifetime, pass 0 means never expires
   * @param {number} opt.maxCacheSize Cache pool size limit, pass 0 means no limit
   */
  constructor(
    promiseFn: PromiseFn<A, R>,
    {
      persist = false,
      persistOnReject = false,
      argComparer = isEqual,
      ttl = oneHour / 3,
      maxCacheSize = 0,
      tags = [],
    } = {}
  ) {
    this._promiseFn = promiseFn;
    this._persist = persist;
    this._persistOnReject = persistOnReject;
    this._argComparer = argComparer;
    this._ttl = ttl;
    this._maxCacheSize = maxCacheSize;
    this._tags = tags;
  }

  call(...args: A) {
    return new Promise<R>((resolve, reject) => {
      if (this._persist) {
        _queueMicrotask(this._callGC);

        let resultKey
        for (const k of this._result.keys()) {
          if (this._argComparer(k, args)) {
            resultKey = k;
            break;
          }
        }
        if (resultKey) {
          const result = this._result.get(resultKey)!;
          if (!this._ttl || Date.now() - result[0] <= this._ttl) {
            if (result[2]) reject(result[2]);
            else resolve(result[1]!);
            return;
          }

          this._result.delete(resultKey);
        }
      }

      let pendingKey;
      for (const k of this._pending.keys()) {
        if (this._argComparer(k, args)) {
          pendingKey = k;
          break;
        }
      }
      if (pendingKey) {
        const pending = this._pending.get(pendingKey)!;
        pending[0].push(resolve);
        pending[1].push(reject);
        return;
      }

      pendingKey = args;
      const pendingValue = [[resolve], [reject]] as [
        ((value: any) => void)[],
        ((reason?: any) => void)[]
      ];
      this._pending.set(pendingKey, pendingValue);

      const handleResult = (res: R) => {
        pendingValue[0].forEach((fn) => fn(res));
        this._pending.delete(pendingKey);
        if (this._persist) {
          this._result.set(pendingKey, [Date.now(), res]);
        }
      };

      const handleError = (e: Error) => {
        pendingValue[1].forEach((fn) => fn(e));
        this._pending.delete(pendingKey);
        if (this._persist && this._persistOnReject) {
          this._result.set(pendingKey, [Date.now(), undefined, e]);
        }
      };

      try {
        const promise = this._promiseFn.call(undefined, ...args);
        if (promise instanceof Promise) {
          promise.then(handleResult, handleError);
        } else {
          handleResult(promise);
        }
      } catch (e) {
        handleError(e as Error);
      }
    });
  }

  revalidate() {
    this._result.clear();
  }

  dispose() {}
}

export default MergePromise;
