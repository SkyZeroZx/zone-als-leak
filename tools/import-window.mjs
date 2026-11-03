/**
 * How many event-loop turns one cold import() spans.
 *
 * Angular's own batchers are a cold import() that a second render joins while it
 * is still pending. A new request arrives in an I/O callback, not a microtask, so
 * it can only join if the event loop turns while the import() is pending.
 *
 * Loads everything the SSR manifest needs for a first render, then times one more
 * chunk in the same fresh process.
 *
 *   node tools/import-window.mjs app21/dist/app/server <chunk>.mjs
 *
 * The /profile chunk of app21, three new processes per version:
 *
 *   v20.19.5   1.69 - 1.77ms    8 - 24 turns
 *   v20.20.2   1.67 - 1.86ms   17 - 22 turns
 *   v22.16.0   1.39 - 2.23ms   10 - 23 turns
 *   v22.17.1   1.42 - 1.95ms   11 - 18 turns
 *   v22.18.0   1.23 - 1.33ms    0 turns
 *   v22.23.4   1.18 - 1.33ms    0 turns
 *   v24.22.2   1.17 - 1.21ms    0 turns
 *   v26.13.0   1.04 - 1.14ms    0 turns
 *
 * The time barely changes; the turns go to 0 at 22.18.0, which is where
 * nodejs/node#57419 (esm: syncify default path of ModuleLoader.load) shipped.
 */
import {pathToFileURL} from 'node:url';
import {join, resolve} from 'node:path';

const [serverDir, chunk] = process.argv.slice(2);
if (!serverDir || !chunk) {
  console.error('usage: node tools/import-window.mjs <server dist dir> <chunk file>');
  process.exit(2);
}
const dir = resolve(serverDir);
const url = (file) => pathToFileURL(join(dir, file)).href;

let turns = 0;
let running = true;
(function spin() {
  if (!running) return;
  turns++;
  setImmediate(spin);
})();

await import(url('polyfills.server.mjs'));
const manifest = (await import(url('angular-app-manifest.mjs'))).default;
await manifest.bootstrap();
await manifest.assets['index.server.html'].text();

const before = turns;
const started = process.hrtime.bigint();
await import(url(chunk));
const ms = Number(process.hrtime.bigint() - started) / 1e6;
const spanned = turns - before;
running = false;

console.log(`${process.version}\t${chunk}: ${ms.toFixed(2)}ms over ${spanned} event-loop turns`);
