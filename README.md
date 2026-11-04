# zone-als-leak

Angular SSR with zone.js on the server. If two renders are waiting on the same
pending work, zone.js runs both continuations in the async context of the first
one, and `AsyncLocalStorage.getStore()` returns the other request's store.
Anything that looks up the current request that way gets the wrong one:
express-http-context, pino, OpenTelemetry, Sentry. `Zone.current` and
`inject(REQUEST)` stay correct.

All the numbers are in [results/](results/README.md).

## Without Angular

```bash
npm install
node tools/mechanism.mjs          # exits 1
ZONE=0 node tools/mechanism.mjs   # exits 0
FIX=1 node tools/mechanism.mjs    # exits 0
```

```text
node v24.16.0, zone.js 0.16.3

test                          request   Zone.current   als.getStore()  verdict
A same-turn .then()           victim    req-victim     victim          ok
A same-turn .then()           attacker  req-attacker   victim          LEAK
B shared in-flight promise    victim    req-victim     victim          ok
B shared in-flight promise    attacker  req-attacker   victim          LEAK
C still wrong 3 hops later    victim    req-victim     victim          ok
C still wrong 3 hops later    attacker  req-attacker   victim          LEAK
D native await                victim    <root>         victim          ok
D native await                attacker  <root>         attacker        ok

AsyncLocalStorage store from another request: 3/8
Zone.current from another request:            0/8 (2 are <root> after native await)
```

Same result with every zone.js release from 0.9.1 to 0.16.3
(`npm install zone.js@<version>`). With 0.16.3 it's the same on Node 20.19.5,
22.23.4, 24.16.0 and 26.13.0, and on Linux.

`then()` only saves `Zone.current`
([promise.ts#L545-L550](https://github.com/angular/angular/blob/zone.js-0.16.3/packages/zone.js/lib/common/promise.ts#L545-L550)).
All reactions go into one queue, which is drained from a single native microtask
scheduled by the first one
([zone-impl.ts#L1513-L1565](https://github.com/angular/angular/blob/zone.js-0.16.3/packages/zone.js/lib/zone-impl.ts#L1513-L1565)),
and Node runs that microtask in the first one's context. `FIX=1` wraps the
`then()` callbacks with `AsyncResource.bind`, and that's enough to fix the script.

With zone.js in `polyfills`, the CLI compiles `async`/`await` in the app to
generators over the global `Promise`, so render code always goes through `then()`.
The zone.js server bundles here have no native `await` left. A native `await`,
like the ones in `server.ts`, keeps the right store. That's row D.

## The apps

`app/` is `ng new --ssr --zoneless=false` on Angular 22.2.4, and `app21/` is the
same `src` on Angular 21.2.26. On top of the scaffold I added express-http-context
with a session cookie, pino, an interceptor that sends the user's token to a
backend (`tools/api.mjs`), and four routes:

| route | what it does | what makes two renders wait on the same work |
| --- | --- | --- |
| `/account` | reads the identity in a resolver and fetches the account | the SSR manifest's first `import()` calls, or the `useValue` cache |
| `/profile` | lazy, reads the identity in the component | the router's `loadComponent` |
| `/` | loads data with `httpResource` and defers a panel | the `@defer` chunk |
| `/settings` | defers the same panel and loads nothing | the `@defer` chunk |

`src/app/identity.ts` keeps the Node-only code out of the browser bundle, and
`app.config.server.ts` provides the real implementation.

```bash
cd app21 && npm ci && npx ng build && npx ng build --configuration zoneless && cd ..
node tools/matrix.mjs app21 profile /path/to/node-22.17.1
node tools/matrix.mjs app21 account --backend /path/to/node-22.17.1
```

`tools/matrix.mjs` starts the backend and a new server for every run, then sends
20 concurrent requests, each with its own session cookie. With `--backend` it
reports what the backend received instead of what the page printed. `AGENT=sentry`
or `AGENT=otel` loads that agent with `--import`. Any Node version can be
downloaded from `https://nodejs.org/dist/v<version>/`.

## Results

Five things make two renders wait on the same work. Only the last one is
application code, and in all five the same app without zone.js is correct.

| | what both renders wait on | what the app needs | first requests of a process | after warm-up |
| --- | --- | --- | --- | --- |
| 1 | the SSR manifest's `import()` of `main.server.mjs` and the index HTML | nothing | yes | no |
| 2 | the router's `loadComponent` | a lazy route that reads the identity | yes | no |
| 3 | a `@defer (hydrate …)` chunk | that block, with incremental hydration on | yes | no |
| 4 | every `import()`, once an async ESM loader hook is registered | `@sentry/node` on Node 22 | yes | yes |
| 5 | a request shared through a `useValue` provider | that provider | yes | yes |

Angular 22.2.4 on the Node versions it supports, `/account`, distinct tokens the
backend received for 20 renders in a new process:

| | 22.23.4 | 24.22.2 | 26.13.0 |
| --- | ---: | ---: | ---: |
| `@sentry/node` 11.10.0, no cache (4) | 1 | 20 | 20 |
| `useValue` cache (5) | 1 | 1 | 1 |
| neither | 20 | 20 | 20 |
| zoneless, with Sentry or with the cache | 20 | 20 | 20 |

The Sentry row has no cache and no shared state in the app, and it's the same with
the manifest's imports already loaded. On Linux with Node 22.22.3, Angular 22's
minimum, it's 1 token for 20 renders too. After warm-up it keeps going: 14 to 16
tokens for 100 renders on 22.23.4 over three runs. Sentry only uses the
synchronous loader API from Node 24.13 on. Before that it registers asynchronous
`module.register()` hooks, and `@angular/ssr` imports the index HTML on every
render.

The cache holds public settings and is shared on purpose. What crosses is the
identity, not the cached value. After warm-up it gives 69 tokens for 100 renders
on 22.23.4 and 81 on 26.13.0.

OpenTelemetry's zero-code agent, with the cache on and no identity code in the app
at all: 1 trace id for 20 renders, on 22.23.4 and on 26.13.0.

Angular 21 on Node 22.17.1, 3 new processes with 20 requests each:

| route | zone.js | zoneless | [candidate patch](fix/) |
| --- | ---: | ---: | ---: |
| `/account` (1) | 57/60 | 0/60 | 0/60 |
| `/profile` (2) | 57/60 | 0/60 | 0/60 |
| `/`, `/settings` (3) | 30/33 | 0/33 | 0/33 |

Same on 20.19.5 and 22.16.0. On `/account` without the cache, the backend got one
token for 20 renders, and pino filed 19 of 20 lines under the wrong user. These
three happen in the first requests of a process, after a deploy or a restart.

They stop at Node 22.18.0. A new request comes in through an I/O callback, so it
can only join an `import()` that is still pending after a turn of the event loop.
`tools/import-window.mjs` counts those turns: 11 to 18 on 22.17.1, none from
22.18.0 on. That release has
[nodejs/node#57419](https://github.com/nodejs/node/pull/57419), which made the
default ESM load path synchronous. Angular 21 supports Node 20 and 22 before
22.18.0; Angular 22 requires newer versions.

It also works the other way. `tools/reverse.mjs` sends 10 bursts of 20 with one
attacker request first. Whoever starts the shared fetch takes the other 19 renders
of that burst with them. The attacker took over 2 to 4 bursts per run on 26.13.0
and up to 3 on 22.23.4, and in each one, 19 renders showed the attacker's
account, loaded with the attacker's token. Zoneless, none.

## Fix

[`fix/zone.js-async-context.patch`](fix/zone.js-async-context.patch) applies to
the `zone.js-0.16.3` tag and to `main` of angular/angular
(`git apply --directory=packages/zone.js`). It captures an `AsyncResource` where a
reaction is queued (`then()` and `queueMicrotask`) and runs the reaction inside it,
which is what Node's docs ask of a custom thenable. It also adds
`__Zone_disable_asyncContext` to turn it off, and `test/node/async_context.spec.ts`.

[`fix/zone-node.mjs`](fix/zone-node.mjs) is the build I used for the patched rows,
and [app21/README.md](app21/README.md) shows how to build the app with it. With the
patch every case here is 0, the deferred panel and the lazy component show up in
the same responses as before, and throughput is within 2% of the stock build
(`tools/bench.mjs`: 301 vs 303 requests per second on `/account`).

Until there's a fix: zoneless, `inject(REQUEST)` instead of an `AsyncLocalStorage`
context in application code, `useFactory` for anything per request, `PRELOAD=all`
in `tools/preload.mjs` for 1 to 3, and Node 22.18.0 or later for 1 to 3, or 24.13 or
later for 4.

## Files

```text
tools/
  mechanism.mjs      the bug without Angular
  matrix.mjs         new-process runs per route, build and Node version
  attack.mjs         the concurrent client behind --backend
  reverse.mjs        the attacker going first
  warm.mjs           several bursts against one process, cold then warm
  import-window.mjs  event-loop turns one cold import() spans
  preload.mjs        starts an app with Angular's imports already loaded
  bench.mjs          throughput of one build, stock or patched
  api.mjs            the backend; records tokens and trace ids
agents/              Sentry and OpenTelemetry, loaded with --import
app/                 Angular 22.2.4
app21/               Angular 21.2.26, same src
fix/                 candidate zone.js patch and its build
results/             measurements, a source audit of Angular's own shared state,
                     and what the docs say
```
