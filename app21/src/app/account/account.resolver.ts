import { inject, REQUEST } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ResolveFn } from '@angular/router';
import { firstValueFrom, Observable, shareReplay } from 'rxjs';
import { EXPERIMENT, RENDER_LOG, REQUEST_IDENTITY } from '../identity';
import { SETTINGS_CACHE, SettingsCache, Settings } from '../settings-cache';

export interface Account {
  user: string;
  email: string;
  iban: string;
  balance: number;
}

export interface AccountView {
  trueUser: string | null; // inject(REQUEST)
  alsUser: string | null; // the ambient Node async context
  account: Account; // fetched with the token that context yielded
}

function sharedSettings(
  http: HttpClient,
  cache: SettingsCache,
  ttlMs: number,
): Observable<Settings> {
  const now = Date.now();
  if (!cache.settings$ || now - cache.cachedAt > ttlMs) {
    cache.cachedAt = now;
    cache.settings$ = http
      .get<Settings>('/api/settings')
      .pipe(shareReplay({ bufferSize: 1, refCount: false }));
  }
  return cache.settings$;
}

/**
 * A resolver rather than a route resource, deliberately: it is the only hook the
 * router runs *before* `loadComponent`, which is the whole contrast with
 * `/profile`. That is why this route reads the right identity while `/profile`
 * does not.
 */
export const accountResolver: ResolveFn<AccountView> = async () => {
  const http = inject(HttpClient);
  const experiment = inject(EXPERIMENT);
  const readIdentity = inject(REQUEST_IDENTITY);
  const log = inject(RENDER_LOG);
  const cookie = inject(REQUEST)?.headers.get('cookie') ?? '';
  const trueUser = /(?:^|;\s*)session=([^;]+)/.exec(cookie)?.[1] ?? null;

  // preFetch: the same call, no cache. The control, which measures 0.
  if (experiment.preFetch) {
    await firstValueFrom(http.get('/api/settings'));
  }
  // sharedCache: the same call through one process-wide in-flight promise.
  if (experiment.sharedCache) {
    await firstValueFrom(
      sharedSettings(http, inject(SETTINGS_CACHE), experiment.settingsTtlMs),
    );
  }

  const alsUser = readIdentity();
  log(trueUser);

  const account = await firstValueFrom(http.get<Account>('/api/me'));
  return { trueUser, alsUser, account };
};
