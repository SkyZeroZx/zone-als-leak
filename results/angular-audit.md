# What else Angular shares between requests

I read the server code of `@angular/ssr` 22.2.5, `@angular/platform-server`,
`@angular/core`, `@angular/router` and `@angular/common/http`, looking for any
other way one request's data could reach another. I didn't find one that
discloses user data.

## Per request

1. **The platform injector isn't reused on the server.**
   `createOrReusePlatformInjector` (`core.mjs:2390-2403`) only caches it when
   `ngServerMode` is off:

   ```js
   if (typeof ngServerMode === 'undefined' || !ngServerMode) {
     _platformInjector = injector;
   }
   ```

   So every render gets its own platform.

2. **There is very little module-level state, and none of it is per request.**
   These are the module-scoped `let`s in the five packages:

   | file | variables |
   | --- | --- |
   | `ssr.mjs` | `angularAppManifest`, `angularAppEngineManifest` (build manifests), `urlSerializer` (stateless), `angularServerApp` |
   | `core.mjs` | `isHydrationSupportEnabled`, `moduleBootstrapImpl`, `_platformInjector` (see 1), `_unregisterAiTools`, `tViewSsrId`, `enablePerfLogging`, `warningLogged` |
   | `http.mjs` | `textEncoder` (stateless) |
   | `router.mjs`, `platform-server.mjs` | none |

3. **The HTTP transfer cache is per request.** `transferCacheInterceptorFn`
   (`http.mjs:93-105`) reads `inject(TransferState)`, which belongs to the
   render's injector.

4. **The critical CSS cache stores CSS, not HTML.** `ssr.mjs:1213-1219` creates one
   Beasties processor per process with `cache: true`, but Beasties keys that cache
   on the set of selectors a page uses (`beasties/dist/runtime.mjs:635-708`) and
   stores the CSS it computed. Even a wrong hit would only serve CSS.

5. **`tViewSsrId` doesn't count requests.** `getSsrId` (`core.mjs:2470-2476`)
   stores the id on the `TView`, which is the static template, so it's assigned
   once per template.

6. **The CSP nonce comes from the build.** `ssr.mjs:1204-1208` reads `nonce` from
   the build manifest, so the process-wide processor doesn't reuse a request's
   nonce.

## One coupling that isn't a data leak

If the app doesn't use `provideServerRendering(withRoutes(...))`, the route tree is
extracted once per process, with the first request's protocol and `Host`:

```text
ssr.mjs:1051   this.router ??= await ServerRouter.from(this.manifest, url);
ssr.mjs:1000   ServerRouter.#extractionPromise ??= extractRoutesAndCreateRouteTree({ url, manifest })
ssr.mjs:802    { provide: INITIAL_CONFIG, useValue: { document, url: `${protocol}//${host}/` } }
```

It also needs a permissive host check, like `NG_ALLOWED_HOSTS=*`, because an
unknown `Host` gets a 400 by default (`node.mjs:133`). The scaffold uses
`withRoutes`, so the apps here take the static path. The effect is on routing,
once, when the process starts.

## What else the shared drain touches

zone.js runs many requests' continuations in one drain, so I also read what else
depends on it.

- **Unhandled rejections.** zone.js keeps them in one array and reports them after
  the drain (`zone-node.umd.js:976`, `:992`, `:1138`), but it reports each one
  inside `uncaughtPromiseError.zone.runGuarded(...)`, so the zone of each error is
  right.
- **Stability.** NgZone uses its own `hasPendingMicrotasks`,
  `hasPendingMacrotasks` and `onMicrotaskEmpty` (`core.mjs:1560`, `1671-1678`), and
  every render forks its own NgZone.
- **Anything keyed on the zone.** The drain calls `task.zone.runTask(task)`, so
  `Zone.current` is right for every task.

So what breaks is the code that reads Node's async context: `AsyncLocalStorage`
and everything built on it.
