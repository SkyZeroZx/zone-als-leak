import { mergeApplicationConfig, ApplicationConfig } from '@angular/core';
import { provideServerRendering, withRoutes } from '@angular/ssr';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import httpContext from 'express-http-context';
import { appConfig } from './app.config';
import { serverRoutes } from './app.routes.server';
import { authInterceptor } from './auth-interceptor';
import { logger } from './logger';
import { EXPERIMENT, RENDER_LOG, REQUEST_IDENTITY } from './identity';
import { SETTINGS_CACHE, SettingsCache } from './settings-cache';

// Everything Node-only lives here, in the server graph: express-http-context,
// pino, and every environment switch.
const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(withRoutes(serverRoutes)),
    // server-only: forward this request's credentials to the backend
    provideHttpClient(withInterceptors([authInterceptor])),
    {
      provide: REQUEST_IDENTITY,
      useValue: () => (httpContext.get('user') as string | undefined) ?? null,
    },
    {
      provide: RENDER_LOG,
      useValue: (requestedBy: string | null) => logger.info({ requestedBy }, 'rendering /account'),
    },
    {
      provide: EXPERIMENT,
      useValue: {
        sharedCache: process.env['SHARED_CACHE'] !== '0',
        preFetch: process.env['PRE_FETCH'] === '1',
        settingsTtlMs: Number(process.env['SETTINGS_TTL'] ?? 200),
      },
    },
    // angular.dev/guide/ssr: "providers configured with `useValue` will keep their
    // value across multiple requests", and "if you want to generate a new value for
    // each request, use a factory provider with `useFactory`". Both halves measured.
    process.env['PER_REQUEST_CACHE'] === '1'
      ? { provide: SETTINGS_CACHE, useFactory: () => new SettingsCache() }
      : { provide: SETTINGS_CACHE, useValue: new SettingsCache() },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
