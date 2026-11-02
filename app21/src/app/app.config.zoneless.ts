import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideClientHydration, withIncrementalHydration } from '@angular/platform-browser';
import { routes } from './app.routes';

// The control. Zoneless is the default from v21, so this is what `ng new --ssr`
// produces and it needs no change-detection provider at all.
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // Explicit because v21 needs it: v22 enables incremental hydration from a bare
    // provideClientHydration() unless you pass withNoIncrementalHydration(), while
    // v21 and earlier make it opt-in. The @defer (hydrate …) blocks need it on.
    provideClientHydration(withIncrementalHydration()),
    provideHttpClient(withFetch()),
  ],
};
