declare module 'mouse-nav' {
  /** Start the native mouse side-button monitor. `cb` gets 'back' or 'forward'. */
  export function start(cb: (direction: 'back' | 'forward') => void): void
  /** Stop monitoring. */
  export function stop(): void
  /** True when the native monitor is available (macOS with the binary loaded). */
  export const available: boolean
}
