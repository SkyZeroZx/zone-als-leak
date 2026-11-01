import { InjectionToken } from '@angular/core';

/**
 * The seam between the shared application graph and the Node-only code.
 *
 * `express-http-context`, `pino` and `process.env` all belong to the server. If a
 * component or resolver imports them directly they end up in the browser bundle,
 * where `process` does not exist and the client never bootstraps - so the
 * hydration half of this proof of concept would never run. These tokens keep them
 * on the server side; `app.config.server.ts` provides the real implementations.
 *
 * The timing the finding depends on is unchanged: the closure still reads the
 * ambient async context at the moment the component or resolver calls it.
 */

/** Whose request the ambient Node async context says this is. */
export const REQUEST_IDENTITY = new InjectionToken<() => string | null>('REQUEST_IDENTITY', {
  factory: () => () => null,
});

/** One render log line, which is where the wrong user becomes an audit record. */
export const RENDER_LOG = new InjectionToken<(requestedBy: string | null) => void>('RENDER_LOG', {
  factory: () => () => {},
});

/** The switches this experiment flips, read from the environment on the server. */
export interface Experiment {
  /** Hand every request the same in-flight promise. Batcher 5. */
  sharedCache: boolean;
  /** Make the same call without the cache: the control that measures 0. */
  preFetch: boolean;
  settingsTtlMs: number;
}

export const EXPERIMENT = new InjectionToken<Experiment>('EXPERIMENT', {
  factory: () => ({ sharedCache: false, preFetch: false, settingsTtlMs: 200 }),
});
