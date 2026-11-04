# What the docs say

## `useValue` on the server

angular.dev's [SSR guide](https://angular.dev/guide/ssr), in *Setting providers
on the server*:

> On the server side, top level provider values are set once when the application
> code is initially parsed and evaluated.

> providers configured with `useValue` will keep their value across multiple
> requests

> If you want to generate a new value for each request, use a factory provider with
> `useFactory`.

That's case 5, and `useFactory` does fix that case (section 4 of
[the results](README.md)). It doesn't fix the zone.js bug, though: the Sentry rows
and the Angular 21 rows have no `useValue` provider at all.

The same guide already warns about one cross-request leak, in the HTTP transfer
cache:

> Avoid including sensitive headers like authentication tokens. These can leak
> user-specific data between requests.

Angular also ships `includeRequestsWithAuthHeaders: false` as the default there.
There's no equivalent setting for `AsyncLocalStorage`, and the guide doesn't
mention `AsyncLocalStorage` at all.

## zone.js is still supported

- [angular.dev/reference/deprecations](https://angular.dev/reference/deprecations)
  has no entry for zone.js, `NgZone`, `provideZoneChangeDetection` or zone-based
  change detection.
- `provideZoneChangeDetection` has no `@deprecated` tag
  (`@angular/core/types/core.d.ts:3393` in 22.2.4), and neither does `NgZone`.
- `ng new --ssr --zoneless=false` still writes `polyfills: ["zone.js"]` and
  `provideZoneChangeDetection({ eventCoalescing: true })`. `app/` was created
  with `npx @angular/cli@22.2.4 new app --ssr --zoneless=false --style=css --defaults`.
- On [angular.dev/reference/releases](https://angular.dev/reference/releases),
  v22 has active support until 2027-06 and LTS until 2028-06.
- zone.js's README says it no longer accepts new features or low priority bug
  fixes, and then: "Any critical bug fixes that relate to Angular's direct use of
  Zone.js will still be accepted." and "While still a supported part of Angular,
  the Angular team strongly discourages using Zone.js outside of Angular
  application contexts."
