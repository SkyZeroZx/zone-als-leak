import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideClientHydration, withIncrementalHydration } from '@angular/platform-browser';
import { routes } from './app.routes';

// `ng new --ssr --zoneless=false`: v21 and v22 both default to zoneless now, so
// this is the configuration an application keeps rather than the one it is given.
// provideClientHydration() with no features is the scaffold's own line; on v22 it
// enables incremental hydration, which is what the @defer blocks need.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // Explicit because v21 needs it: v22 enables incremental hydration from a bare
    // provideClientHydration() unless you pass withNoIncrementalHydration(), while
    // v21 and earlier make it opt-in. The @defer (hydrate …) blocks need it on.
    provideClientHydration(withIncrementalHydration()),
    provideHttpClient(withFetch()),
  ],
};
