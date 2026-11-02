/**
 * Starts an application with Angular's own dynamic imports already loaded, so
 * a crossing measured afterwards cannot come from them.
 *
 * On its first request the SSR manifest import()s `main.server.mjs` and
 * `index.server.html`. Loading both before the server listens is the control
 * for that. PRELOAD=all also loads every lazy server chunk, which closes the
 * @defer and lazy-route cases as well, so it doubles as a deployment workaround.
 *
 *   APP_ROOT=app21 APP_DIST=app node tools/preload.mjs
 *
 * APP_ROOT  application directory (default `app`)
 * APP_DIST  build inside it (default `app`, or `app-zoneless`, `patched`)
 * PRELOAD   `manifest` (default) or `all`
 */
const root = process.env.APP_ROOT ?? 'app';
const dist = process.env.APP_DIST ?? 'app';
const base = new URL(`../${root}/dist/${dist}/server/`, import.meta.url);

await import(new URL('polyfills.server.mjs', base).href);
const manifest = (await import(new URL('angular-app-manifest.mjs', base).href)).default;

await manifest.bootstrap();
await manifest.assets['index.server.html'].text();

if (process.env.PRELOAD === 'all') {
  const {readdir} = await import('node:fs/promises');
  const {fileURLToPath} = await import('node:url');
  const files = await readdir(fileURLToPath(base));
  await Promise.all(
    files.filter((f) => f.startsWith('chunk-') && f.endsWith('.mjs'))
      .map((f) => import(new URL(f, base).href)),
  );
}

// The generated Angular server starts listening when pm_id is present.
process.env.pm_id = 'preloaded';
await import(new URL('server.mjs', base).href);
