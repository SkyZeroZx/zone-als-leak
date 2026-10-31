/**
 * The bug without Angular. No dependencies besides zone.js.
 *
 * zone.js replaces the global Promise. Its then() remembers Zone.current but not
 * Node's async context, and it runs every queued reaction from one native microtask,
 * scheduled by whoever queued first (bundles/zone-node.umd.js:587-644). So every
 * reaction in that drain sees the first one's AsyncLocalStorage store.
 *
 *   node tools/mechanism.mjs          zone.js        exits 1
 *   ZONE=0 node tools/mechanism.mjs   no zone.js     exits 0
 *   FIX=1 node tools/mechanism.mjs    zone.js, with then() callbacks bound to the
 *                                     async context they were queued in   exits 0
 *
 * Same result on Node 20.19.5, 22.23.4, 24.16.0 and 26.13.0, and with every
 * zone.js release from 0.9.1 to 0.16.3 (`npm install zone.js@<version>`).
 */
import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks';
import { createRequire } from 'node:module';

const WITH_ZONE = process.env.ZONE !== '0';
if (WITH_ZONE) {
  // zone.js/node exists from 0.11; older releases only ship dist/zone-node.js.
  await import('zone.js/node').catch(() => import('zone.js/dist/zone-node.js'));
}

// The fix, applied from outside: capture the async context when the reaction is
// queued, and run the reaction inside it. In zone.js this belongs in then()
// (lib/common/promise.ts) and in the queueMicrotask patch.
if (WITH_ZONE && process.env.FIX === '1') {
  const then = Promise.prototype.then;
  const bind = (fn) => (typeof fn === 'function' ? AsyncResource.bind(fn) : fn);
  Promise.prototype.then = function (onFulfilled, onRejected) {
    return then.call(this, bind(onFulfilled), bind(onRejected));
  };
}

const als = new AsyncLocalStorage();
const hasZone = typeof globalThis.Zone !== 'undefined';

// One SSR request: its own ALS store and its own Zone.
function request(user, body) {
  return als.run({ user }, () => {
    const zone = hasZone ? Zone.current.fork({ name: `req-${user}` }) : null;
    const ctx = {
      user,
      alsUser: () => als.getStore()?.user ?? null,
      zoneName: () => (hasZone ? Zone.current.name : 'n/a'),
    };
    return zone ? zone.run(() => body(ctx)) : body(ctx);
  });
}

const results = [];
const record = (test, ctx) =>
  results.push({ test, user: ctx.user, zone: ctx.zoneName(), store: ctx.alsUser() });

// victim first, attacker second: the attacker only has to arrive in the same turn
const PAIR = ['victim', 'attacker'];

async function both(test, body) {
  await Promise.all(
    PAIR.map((user) => new Promise((done) => request(user, (ctx) => body(ctx, () => {
      record(test, ctx);
      done();
    })))),
  );
}

// A. Two reactions queued in the same turn.
await both('A same-turn .then()', (ctx, check) => {
  Promise.resolve().then(check);
});

// B. One in-flight promise both requests wait on, settled by the victim's own work.
//    This is the shape of a cache, a lazy import() or a deduplicated fetch.
{
  let settle;
  const shared = new Promise((r) => (settle = r));
  const waiting = both('B shared in-flight promise', (ctx, check) => {
    shared.then(check);
  });
  request('victim', () => settle('settings'));
  await waiting;
}

// C. The wrong store stays for the rest of the chain. Downleveled await is .then().
await both('C still wrong 3 hops later', (ctx, check) => {
  Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => new Promise((r) => setTimeout(r, 5)))
    .then(check);
});

// D. Native await. Node restores the store; zone.js cannot see it and drops to <root>.
await both('D native await', async (ctx, check) => {
  await new Promise((r) => setTimeout(r, 5));
  await null;
  check();
});

const version = WITH_ZONE
  ? createRequire(import.meta.url)('zone.js/package.json').version
  : 'not loaded';
const pad = (s, n) => String(s).padEnd(n);
const fix = WITH_ZONE && process.env.FIX === '1' ? ', FIX=1' : '';

console.log(`node ${process.version}, zone.js ${version}${fix}\n`);
console.log(pad('test', 30) + pad('request', 10) + pad('Zone.current', 15) + pad('als.getStore()', 16) + 'verdict');
for (const r of results) {
  const ok = r.store === r.user;
  console.log(pad(r.test, 30) + pad(r.user, 10) + pad(r.zone, 15) + pad(r.store, 16) + (ok ? 'ok' : 'LEAK'));
}

const leaks = results.filter((r) => r.store !== r.user).length;
const otherZone = results.filter((r) => r.zone.startsWith('req-') && r.zone !== `req-${r.user}`).length;
const rootZone = results.filter((r) => r.zone === '<root>').length;
console.log(`\nAsyncLocalStorage store from another request: ${leaks}/${results.length}`);
if (hasZone) {
  console.log(`Zone.current from another request:            ${otherZone}/${results.length}` +
    (rootZone ? ` (${rootZone} are <root> after native await)` : ''));
}
process.exit(leaks ? 1 : 0);
