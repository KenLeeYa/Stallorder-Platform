import type { Dispatch, ReactNode, SetStateAction } from 'react';

// Deterministic Node-only consumer regression support. Real browser QA remains
// required; this does not model React scheduling, hydration or the DOM.
export function createHookRuntime() {
  type Slot = { value?: unknown; set?: (value: unknown) => void; deps?: readonly unknown[]; cleanup?: () => void };
  type Frame = { slots: Slot[]; index: number };
  const frames = new Map<unknown, Frame>();
  const wrappers = new Map<unknown, (props: unknown) => ReactNode>();
  let current: Frame;
  let pending: Array<() => void> = [];
  let dirty = true;
  let stopped = false;
  const equal = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) =>
    Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
  const slot = () => [current, current.index++] as const;
  const run = <T>(key: unknown, fn: () => T) => {
    const previous = current;
    current = frames.get(key) ?? { slots: [], index: 0 };
    frames.set(key, current);
    current.index = 0;
    try { return fn(); } finally { current = previous; }
  };
  const state = <T>(initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] => {
    const [frame, index] = slot();
    if (!frame.slots[index]) {
      const item: Slot = { value: typeof initial === 'function' ? (initial as () => T)() : initial };
      item.set = (value: unknown) => {
        if (stopped) return;
        const next = typeof value === 'function' ? (value as (old: unknown) => unknown)(item.value) : value;
        if (!Object.is(next, item.value)) { item.value = next; dirty = true; }
      };
      frame.slots[index] = item;
    }
    const item = frame.slots[index];
    return [item.value as T, item.set as Dispatch<SetStateAction<T>>];
  };
  const memo = <T>(fn: () => T, deps: readonly unknown[]): T => {
    const [frame, index] = slot();
    if (!frame.slots[index] || !equal(frame.slots[index].deps, deps)) frame.slots[index] = { value: fn(), deps };
    return frame.slots[index].value as T;
  };
  const effect = (fn: () => void | (() => void), deps?: readonly unknown[]) => {
    const [frame, index] = slot();
    const item = frame.slots[index];
    if (item && equal(item.deps, deps)) return;
    frame.slots[index] = { deps, cleanup: item?.cleanup };
    pending.push(() => {
      frame.slots[index].cleanup?.();
      frame.slots[index].cleanup = fn() || undefined;
    });
  };
  return {
    hooks: {
      useState: state, useEffect: effect, useLayoutEffect: effect,
      useMemo: memo, useCallback: <T>(fn: T, deps: readonly unknown[]) => memo(() => fn, deps),
      useRef: <T>(value: T) => memo(() => ({ current: value }), []),
      useReducer: <T, A>(reducer: (value: T, action: A) => T, initial: T) => {
        const [value, set] = state(initial);
        return [value, memo(() => (action: A) => set(old => reducer(old, action)), [])];
      },
      useSyncExternalStore: <T>(_subscribe: unknown, snapshot: () => T) => snapshot(),
    },
    wrap<T>(type: T): T {
      if (typeof type !== 'function') return type;
      const component = type as (props: unknown) => ReactNode;
      if (!wrappers.has(type)) wrappers.set(type, props => run(type, () => component(props)));
      return wrappers.get(type) as T;
    },
    render<T>(fn: () => T) {
      dirty = false;
      const value = run('root', fn);
      const effects = pending;
      pending = [];
      effects.forEach(callback => callback());
      return value;
    },
    get dirty() { return dirty; },
    stop() {
      stopped = true;
      for (const frame of frames.values()) for (const item of frame.slots) item?.cleanup?.();
      pending = [];
    },
    reset() { frames.clear(); wrappers.clear(); pending = []; dirty = true; stopped = false; },
  };
}
