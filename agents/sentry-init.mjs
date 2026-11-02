/**
 * Sentry's documented Node setup, loaded with `--import`, exactly as its Express guide
 * shows. Here Sentry is being tested as a BATCHER, not as a victim: the question is only
 * whether its ESM loader hooks make concurrent `import()`s resolve together on Node 22.
 */
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
});
