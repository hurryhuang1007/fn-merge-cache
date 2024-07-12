import { isEqual, throttle } from "lodash-es";
import { EventEmitter } from "events";

const oneHour = 60 * 60 * 1000;
// hack for next.js edge runtime
const _queueMicrotask: typeof queueMicrotask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (fn) => Promise.resolve().then(fn);
export type PromiseFn<A extends any[], R> = (...args: A) => Promise<R>;
export type MergedPromise<A extends any[], R> = PromiseFn<A, R> & {
  revalidate: () => void;
  dispose: () => void;
};

const revalidateEE = new EventEmitter();

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
export default function mergePromise<A extends any[], R>(
  promiseFn: PromiseFn<A, R>,
  {
    persist = false,
    persistOnReject = false,
    argComparer = isEqual,
    ttl = oneHour / 3,
    maxCacheSize = 0,
  } = {}
): MergedPromise<A, R> {
  const _pending = new Map<
    A,
    [((value: R) => void)[], ((reason?: any) => void)[]]
  >(); // arg: [[resolve, ...], [reject, ...]]
  const _resultKeys = new Set<[A, number]>(); // [[arg, time], ...]
  const _result = new WeakMap<A, [R?, Error?]>(); // arg: [result, error]

  const callGC = throttle(() => {
    const now = Date.now();
    for (const i of _resultKeys) {
      if (
        !_result.has(i[0]) ||
        (ttl && now - i[1] > ttl) ||
        (maxCacheSize && _resultKeys.size > maxCacheSize)
      ) {
        _result.delete(i[0]);
        _resultKeys.delete(i);
      } else {
        // Since it is sorted by time, you can exit once you encounter an unexpired one.
        break;
      }
    }
  }, 1000);

  function mergedPromise(...args: A) {
    return new Promise((resolve, reject) => {
      if (persist) {
        _queueMicrotask(callGC);

        const resultKey = [..._resultKeys].find((i) => argComparer(i[0], args));
        if (resultKey) {
          if (!ttl || Date.now() - resultKey[1] <= ttl) {
            const result = _result.get(resultKey[0]);
            if (result) {
              if (result[1]) reject(result[1]);
              else resolve(result[0]!);
              return;
            }
          }

          _result.delete(resultKey[0]);
          _resultKeys.delete(resultKey);
        }
      }

      let pendingKey = [..._pending.keys()].find((i) => argComparer(i, args));
      if (pendingKey) {
        const pending = _pending.get(pendingKey)!;
        pending[0].push(resolve);
        pending[1].push(reject);
        return;
      }

      pendingKey = args;
      const pendingValue = [[resolve], [reject]] as [
        ((value: any) => void)[],
        ((reason?: any) => void)[]
      ];
      _pending.set(pendingKey, pendingValue);
      promiseFn(...args)
        .then((res) => {
          pendingValue[0].forEach((fn) => fn(res));
          _pending.delete(pendingKey!);
          if (persist) {
            _resultKeys.add([pendingKey!, Date.now()]);
            _result.set(pendingKey!, [res]);
          }
        })
        .catch((e) => {
          pendingValue[1].forEach((fn) => fn(e));
          _pending.delete(pendingKey!);
          if (persist && persistOnReject) {
            _resultKeys.add([pendingKey!, Date.now()]);
            _result.set(pendingKey!, [undefined, e]);
          }
        });
    });
  }

  mergedPromise.revalidate = () => {};

  mergedPromise.dispose = () => {};

  return mergedPromise as MergedPromise<A, R>;
}
