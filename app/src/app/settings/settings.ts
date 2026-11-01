import { Component } from '@angular/core';
import { DeferredPanel } from '../panel/deferred-panel';

/**
 * A second page deferring the same panel. Two `@defer` blocks over one chunk, so
 * each page's first request starts its own load of it - which is the case that
 * needs nothing per-request from the application at all.
 */
@Component({
  selector: 'app-settings',
  imports: [DeferredPanel],
  template: `
    <h1>Settings</h1>
    @defer (hydrate on immediate) {
      <app-deferred-panel />
    } @placeholder {
      <p id="deferPlaceholder">loading panel</p>
    }
  `,
})
export default class SettingsPage {}
