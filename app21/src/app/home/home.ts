import { Component } from '@angular/core';
import { httpResource } from '@angular/common/http';
import { DeferredPanel } from '../panel/deferred-panel';
import { Settings } from '../settings-cache';

/**
 * An ordinary dashboard: it loads its own summary per request and defers a panel
 * with incremental hydration. Neither is shared between requests - httpResource
 * holds no cross-request cache and the deferred panel is Angular's own lazy load.
 * The request this page makes is what keeps the render open; with no per-request
 * work at all the deferred panel reaches only 3 of 60 responses.
 */
@Component({
  selector: 'app-home',
  imports: [DeferredPanel],
  template: `
    <h1>Dashboard</h1>
    @if (settings.hasValue()) {
      <p id="homeTheme">{{ settings.value().theme }}</p>
    }
    @defer (hydrate on immediate) {
      <app-deferred-panel />
    } @placeholder {
      <p id="deferPlaceholder">loading panel</p>
    }
  `,
})
export default class HomePage {
  // No `id`: angular.dev/guide/signals/resource warns against setting one on a
  // resource whose data belongs to the user who triggered the render, so the
  // browser loads it again after hydration. That is what we want here.
  protected readonly settings = httpResource<Settings>(() => '/api/settings');
}
