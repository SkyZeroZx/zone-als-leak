import pino from 'pino';
import httpContext from 'express-http-context';

// pino's `mixin`, the pattern its docs recommend for request context.
export const logger = pino({
  base: null,
  timestamp: false,
  mixin: () => ({ user: httpContext.get('user') ?? null }),
});
