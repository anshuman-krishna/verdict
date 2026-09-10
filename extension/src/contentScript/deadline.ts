export const FIRST_PAINT_BUDGET_MS = 400;

export interface Timers {
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function callIfSlower(
  work: Promise<unknown>,
  ms: number,
  onSlow: () => void,
  timers: Timers = {},
): void {
  const set = timers.setTimer ?? ((run, delay) => setTimeout(run, delay));
  const clear = timers.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let settled = false;
  const handle = set(() => {
    if (!settled) {
      onSlow();
    }
  }, ms);
  const stop = (): void => {
    settled = true;
    clear(handle);
  };
  work.then(stop, stop);
}
