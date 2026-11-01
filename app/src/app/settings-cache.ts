import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

export interface Settings {
  theme: string;
  locale: string;
}

// Angular's SSR guide: a `useValue` provider keeps its value across requests.
// https://angular.dev/guide/ssr -> "Setting providers on the server"
export class SettingsCache {
  settings$?: Observable<Settings>;
  cachedAt = 0;
}

export const SETTINGS_CACHE = new InjectionToken<SettingsCache>('SETTINGS_CACHE');
