# Measurements

Measured on Windows 11 with the scripts in [`../tools/`](../tools/), unless a
section says Linux. zone.js 0.16.3 unless a table says otherwise. `app/` is
Angular 22.2.4 (`@angular/ssr` 22.2.5) and `app21/` is Angular 21.2.26
(`@angular/ssr` 21.2.29), with the same `src`.

Each Angular row is 3 new processes with 20 concurrent requests each, and every
request has its own session cookie. A cell counts the renders that read another
request's identity, out of the renders where that part of the page appeared. A
value only counts as crossed if it is one of the identities sent in the same
burst. `inject(REQUEST)` was right in every render.

The Sentry rows on 22.23.4, the `useValue` rows on 22.23.4 and 26.13.0, section 6
and the Angular 21 rows for `/profile`, `/account` and `/` + `/settings` were run
more than once, and the runs matched.

## 1. The mechanism, no Angular

`node tools/mechanism.mjs`, `ZONE=0 node tools/mechanism.mjs`, `FIX=1 node tools/mechanism.mjs`

| Node | zone.js | `ZONE=0` | `FIX=1` | candidate patch bundle |
| --- | ---: | ---: | ---: | ---: |
| 20.19.5 | 3/8 | | | 0/8 |
| 22.16.0 | | | | 0/8 |
| 22.22.3, Linux | 3/8 | 0/8 | | |
| 22.23.4 | 3/8 | | | |
| 24.16.0 | 3/8 | 0/8 | 0/8 | 0/8 |
| 26.13.0 | 3/8 | | | 0/8 |

Reactions that saw another request's `AsyncLocalStorage` store. `Zone.current`
belonged to another request in 0 of 8; 2 of 8 were `<root>`, both after a native
`await`. The bundle is `fix/zone-node.mjs` (sha256 `7dff9b67…62ee`), imported
instead of `zone.js/node`. Linux is the `node:22-alpine` Docker image.

Older zone.js releases, `npm install zone.js@<version>` and the same script, on
Node 24.16.0 and 22.23.4:

| zone.js | 0.9.1 | 0.10.3 | 0.11.8 | 0.12.0 | 0.13.3 | 0.14.10 | 0.15.1 | 0.16.3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| store from another request | 3/8 | 3/8 | 3/8 | 3/8 | 3/8 | 3/8 | 3/8 | 3/8 |

## 2. How long a cold import() stays pending

`node tools/import-window.mjs app21/dist/app/server chunk-L52IIFEW.mjs` (the
`/profile` chunk), 3 new processes per version:

| Node | time | event-loop turns |
| --- | ---: | ---: |
| 20.19.5 | 1.69–1.77 ms | 8–24 |
| 20.20.2 | 1.67–1.86 ms | 17–22 |
| 22.16.0 | 1.39–2.23 ms | 10–23 |
| 22.17.1 | 1.42–1.95 ms | 11–18 |
| 22.18.0 | 1.23–1.33 ms | 0 |
| 22.23.4 | 1.18–1.33 ms | 0 |
| 24.22.2 | 1.17–1.21 ms | 0 |
| 26.13.0 | 1.04–1.14 ms | 0 |

22.18.0 is the release with nodejs/node#57419 (*esm: syncify default path of
`ModuleLoader.load`*).

## 3. Angular's own imports, on Angular 21

`node tools/matrix.mjs app21 <route> --patched <node>`, and `PRELOAD=all` for the
fourth column.

Node 22.17.1:

| route | zone.js | manifest imports preloaded | all chunks preloaded | zoneless | patched |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/account` | 57/60 | 0/60 | | 0/60 | 0/60 |
| `/profile` | 57/60 | 57/60 | 0/60 | 0/60 | 0/60 |
| `/`, `/settings` | 30/33 | 30/33 | 0/60 | 0/33 | 0/33 |

20.19.5 and 22.16.0 give the same numbers in every column. On 22.18.0, `/profile`
and `/` + `/settings` are 0/60 in every column.

- `/account` reads the identity in a resolver, before the router loads anything,
  so only the manifest's two imports can put two renders together. Preloading
  them takes it to 0.
- `/profile` reads it in a lazy component, so the router's `loadComponent` still
  does it with the manifest preloaded.
- `/` and `/settings` share a `@defer (hydrate on …)` panel. 33 is the number of
  renders that loaded the panel: the 10 `/` renders and the first `/settings`
  render of each process. `/` waits on its own `httpResource`, which keeps the
  render open long enough for the chunk to load.
- The patched build shows the panel and the lazy component in the same responses
  as the stock one: 33 of 60, and 60 of 60.

These only happen in the first requests of a process. `node tools/warm.mjs app21
<node> <route> 4` sends four bursts of 20 to one process. On 22.17.1, in two or
three processes per route, the first burst crossed 19 of 20 on `/account` and
`/profile` and 10 of 11 on the panel, and every burst after it was 0 of 20.

What the backend saw, `node tools/matrix.mjs app21 account --backend <node>` (one
new process of 20 requests per row, through `tools/attack.mjs`):

| Node | application cache | bearer tokens for 20 renders | pino lines under the wrong user |
| --- | --- | ---: | ---: |
| 20.19.5, 22.16.0, 22.17.1 | on | 1 | 19 |
| 20.19.5, 22.16.0, 22.17.1 | off | 1 | 19 |
| 20.19.5, 22.16.0, 22.17.1 | off, manifest preloaded | 20 | 0 |
| 20.19.5, 22.16.0, 22.17.1 | off, zoneless | 20 | 0 |

## 4. Angular 22 on the Node versions it supports

`node tools/matrix.mjs app <route> <node>` on 22.23.4, 24.22.2 and 26.13.0:
`/account`, `/profile` and `/` + `/settings` are 0/60 in every column, because the
import window is closed on those versions.

What the backend saw, `node tools/matrix.mjs app account --backend <node>`, new
process. Tokens for 20 renders, and pino lines under the wrong user:

| | 22.23.4 | 24.22.2 | 26.13.0 |
| --- | ---: | ---: | ---: |
| `useValue` cache on | 1, 19 | 1, 19 | 1, 19 |
| cache off | 20, 0 | 20, 0 | 20, 0 |
| cache on, `PER_REQUEST_CACHE=1` (`useFactory`) | 20, 0 | 20, 0 | 20, 0 |
| cache on, zoneless | 20, 0 | 20, 0 | 20, 0 |
| `AGENT=sentry`, cache off | 1, 19 | 20, 0 | 20, 0 |
| `AGENT=sentry`, cache off, manifest preloaded | 1, 19 | 20, 0 | 20, 0 |
| `AGENT=sentry`, cache off, zoneless | 20, 0 | 20, 0 | 20, 0 |

The zoneless row with the cache on is `tools/attack.mjs 1 20` with `WARMUP=0`
against `app/dist/app-zoneless` started with `SHARED_CACHE=1`.

The same on Linux, Node 22.22.3 (Angular 22's minimum), `node:22-alpine`:

| | tokens for 20 renders | pino lines wrong |
| --- | ---: | ---: |
| `useValue` cache on | 1 | 19 |
| `AGENT=sentry`, cache off | 1 | 19 |
| `AGENT=sentry`, cache off, manifest preloaded | 3 | 17 |
| `AGENT=sentry`, cache off, zoneless | 20 | 0 |

With Sentry, the app was copied into the container first. Read through the
mounted Windows folder, Sentry's module hooks made the server take more than 30
seconds to start.

`AGENT=sentry` is `@sentry/node` 11.10.0 loaded with `--import`
([`agents/sentry-init.mjs`](../agents/sentry-init.mjs)). Its loader only uses the
synchronous `module.registerHooks()` on Node 24.13+ and 25.1+, and on anything
older it registers two asynchronous `module.register()` hooks
(`@sentry/server-runtime-injection/build/cjs/register.js:28-34`). With those hooks
every `import()` resolves off the main thread, and `@angular/ssr` imports
`index.server.html` on every render (`ssr.mjs:1172`), so there's always one to
share.

Warm process, 2 rounds thrown away and then 5 rounds of 20 (`tools/attack.mjs 5 20`):

| | Node | bearer tokens for 100 renders | pino lines wrong |
| --- | --- | ---: | ---: |
| `AGENT=sentry`, cache off, 3 runs | 22.23.4 | 14–16 | 84–86 |
| `useValue` cache on | 22.23.4 | 69 | 31 |
| `useValue` cache on | 26.13.0 | 81 | 19 |
| cache off | 26.13.0 | 100 | 0 |

OpenTelemetry with no identity code in the application (`AGENT=otel
IDENTITY_MIDDLEWARE=0`, `@opentelemetry/auto-instrumentations-node` 0.82.0): with
the cache on, the backend received 1 trace id for 20 renders on 22.23.4 and on
26.13.0, and 20 with the cache off. Its context manager reads the store in
`active()` (`@opentelemetry/context-async-hooks` 3.0.0,
`dist/AsyncLocalStorageContextManager.cjs:41`).

## 5. The candidate patch

Built into `app21/dist/patched` as described in [app21/README.md](../app21/README.md).

Sections 1 and 3 have the patched columns. For Sentry and the cache, on Angular
21.2.26 and Node 22.23.4, with `tools/attack.mjs` against `app21/dist/app` and
`app21/dist/patched`:

| | stock, new process | patched, new process | stock, warm | patched, warm |
| --- | ---: | ---: | ---: | ---: |
| `useValue` cache on | 1/20 | 20/20 | 62/100 | 100/100 |
| `--import ./agents/sentry-init.mjs`, cache off | 1/20 | 20/20 | 14/100 | 100/100 |

Throughput, `node tools/bench.mjs app21 <node 22.23.4> <app|patched> <route> 2000 20`,
warm server, runs alternated:

| route | stock, requests per second | patched |
| --- | --- | --- |
| `/account` | 293, 309, 306 | 297, 304, 301 |
| `/` | 308, 307 | 306, 296 |

p50 was 60 to 66 ms in every run, with or without the patch.

## 6. The other direction

`node tools/reverse.mjs app <node> 10 [app|app-zoneless]`: `useValue` cache on, 2
warm-up rounds, then 10 bursts of 20 to `/account` with one attacker session per
burst.

Whoever starts the shared fetch, the other 19 renders in that burst run as them:
they show that user's account, loaded with that user's token. So the count moves
in steps of 19, and what changes from run to run is how many bursts the attacker
took.

| attacker position | Node | bursts the attacker took, of 10, per run |
| --- | --- | --- |
| first (`AT=0`) | 22.23.4 | 1, 1, 2, 0, 1, 3 |
| first (`AT=0`) | 26.13.0 | 3, 3, 3, 4, 3, 4, 4, 2, 3 |
| first (`AT=0`), zoneless | 26.13.0 | 0 |

The backend calls with the attacker's token are 19 for every burst taken, plus
the attacker's own 10. One of the 4-burst runs had 76 victim renders and 86 calls
with the attacker's token, the same as an earlier measurement made with a
different script.

## Other files

- [`angular-audit.md`](angular-audit.md): what else Angular SSR keeps per process.
  Nothing per request is shared.
- [`docs.md`](docs.md): what angular.dev says about `useValue` on the server, and
  why zone.js still counts as supported.
