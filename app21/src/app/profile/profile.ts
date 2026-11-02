import { Component, inject, REQUEST } from '@angular/core';
import { REQUEST_IDENTITY } from '../identity';

/**
 * A lazy route unrelated to `/account`, and with no resolver: the identity is read
 * inside the component, which runs in the continuation of the router's own
 * `loadComponent` import. `/account` reads its identity in a resolver instead,
 * which the router runs before that import.
 */
@Component({
  selector: 'app-profile',
  template: `
    <dl>
      <dt>profile: inject(REQUEST)</dt>
      <dd id="profileTrueUser">{{ trueUser }}</dd>
      <dt>profile: the ambient async context</dt>
      <dd id="profileAlsUser">{{ alsUser }}</dd>
    </dl>
  `,
})
export default class ProfilePage {
  private readonly cookie = inject(REQUEST, { optional: true })?.headers.get('cookie') ?? '';
  protected readonly trueUser = /(?:^|;\s*)session=([^;]+)/.exec(this.cookie)?.[1] ?? null;
  protected readonly alsUser = inject(REQUEST_IDENTITY)();
}
