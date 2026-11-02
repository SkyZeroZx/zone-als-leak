import { Component, inject, REQUEST } from '@angular/core';
import { REQUEST_IDENTITY } from '../identity';

/**
 * One deferred panel, deferred by two pages. Rendered on the server and hydrated
 * later in the browser, which is what `@defer (hydrate …)` is for. The identity is
 * read here, inside the block, so it is read in the continuation of Angular's own
 * dependency load.
 */
@Component({
  selector: 'app-deferred-panel',
  template: `
    <dl>
      <dt>panel: inject(REQUEST)</dt>
      <dd id="deferTrueUser">{{ trueUser }}</dd>
      <dt>panel: the ambient async context</dt>
      <dd id="deferAlsUser">{{ alsUser }}</dd>
    </dl>
  `,
})
export class DeferredPanel {
  private readonly cookie = inject(REQUEST, { optional: true })?.headers.get('cookie') ?? '';
  protected readonly trueUser = /(?:^|;\s*)session=([^;]+)/.exec(this.cookie)?.[1] ?? null;
  protected readonly alsUser = inject(REQUEST_IDENTITY)();
}
