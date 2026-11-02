/**
 * The driver. Starts a fresh server per row and sends one concurrent burst at it,
 * every request carrying its own session cookie, so each row is the first traffic
 * a process ever sees.
 *
 *   node tools/matrix.mjs app21 home,settings  <node20>            what the HTML says
 *   node tools/matrix.mjs app21 account --backend  <node20> <node22>   what the backend saw
 *
 * First argument is the application: `app` (Angular 22) or `app21` (Angular 21).
 * Second is a comma-separated list of routes, assigned round robin over the burst;
 * `home` means `/`. Then the Node binaries to run it under.
 *
 * Two observables:
 *   default     the identities printed in the HTML, by element id
 *   --patched   adds a row for a dist/patched build, see README
 *   --backend   what the backend was shown - distinct bearer tokens for N renders,
 *               and pino lines filed under the wrong user. Runs attack.mjs.
 *
 * Rows per Node binary: the zone build with Angular's own first imports left in
 * the window, the same with them preloaded away, and the zoneless control. With
 * --backend it also runs the application's `useValue` cache on, which is the one
 * batcher the application itself supplies.
 *
 * RUNS and CONC override the defaults of 3 cold processes and 20 requests.
 * AGENT=sentry or AGENT=otel starts every server with agents/<name>-init.mjs
 * loaded through --import, the way both vendors document it.
 */
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';

const argv = process.argv.slice(2);
const backend = argv.includes('--backend');
const patched = argv.includes('--patched');
const [appRoot, routeArg, ...nodeBins] = argv.filter((a) => a !== '--backend' && a !== '--patched');
if (!appRoot || !nodeBins.length) {
  console.error('usage: node tools/matrix.mjs <app|app21> <home|route[,route]> [--backend] <nodeBinary> ...');
  process.exit(2);
}

const repo = fileURLToPath(new URL('../', import.meta.url));
const RUNS = Number(process.env.RUNS ?? 3);
const CONC = Number(process.env.CONC ?? 20);
const API = 'http://127.0.0.1:4799';
const AGENT = process.env.AGENT ? ['--import', `./agents/${process.env.AGENT}-init.mjs`] : [];

const routes = (routeArg ?? 'home').split(',')
  .map((r) => (!r || r === 'home' ? '/' : r.startsWith('/') ? r : `/${r}`));

// Every identity the pages print, by element id.
const PROBES = [
  ['account', 'trueUser', 'alsUser'],
  ['panel', 'deferTrueUser', 'deferAlsUser'],
  ['profile', 'profileTrueUser', 'profileAlsUser'],
];

const field = (html, id) => new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)?.[1]?.trim() || null;

async function freePort() {
  const s = createServer();
  await new Promise((res, rej) => { s.once('error', rej); s.listen(0, '127.0.0.1', res); });
  const {port} = s.address();
  await new Promise((res, rej) => s.close((e) => (e ? rej(e) : res())));
  return port;
}

function waitForLine(child, needle) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const timer = setTimeout(() => reject(new Error(`timed out: ${err || out}`)), 30_000);
    child.stdout.on('data', (c) => { out += c; if (out.includes(needle)) { clearTimeout(timer); resolve(); } });
    child.stderr.on('data', (c) => { err += c; });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`exited ${code}: ${err}`)); });
  });
}

async function stop(child) {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((r) => child.once('exit', r));
  }
}

async function version(bin) {
  return new Promise((resolve) => {
    const p = spawn(bin, ['--version'], {stdio: ['ignore', 'pipe', 'ignore']});
    let v = '';
    p.stdout.on('data', (c) => (v += c));
    p.once('exit', () => resolve(v.trim()));
  });
}

// The pages fetch their own data, so a run must not silently measure a page whose
// own request failed instantly.
const api = spawn(process.execPath, ['tools/api.mjs'], {cwd: repo, stdio: 'ignore'});
let apiUp = false;
for (let i = 0; i < 50 && !apiUp; i++) {
  apiUp = await fetch(`${API}/__stats`).then(() => true, () => new Promise((r) => setTimeout(() => r(false), 100)));
}
if (!apiUp) throw new Error('the backend did not come up on 4799');

const configs = backend
  ? [
      {label: 'cache on, the app\'s own batcher', dist: 'app', cache: '1'},
      {label: 'cache off', dist: 'app', cache: '0'},
      {label: 'cache off, imports preloaded', dist: 'app', cache: '0', preload: true},
      {label: 'cache off, zoneless', dist: 'app-zoneless', cache: '0'},
    ]
  : [
      {label: 'zone', dist: 'app', cache: '0'},
      {label: 'zone, imports preloaded', dist: 'app', cache: '0', preload: true},
      {label: 'zoneless', dist: 'app-zoneless', cache: '0'},
      ...(patched ? [{label: 'zone.js with the candidate patch', dist: 'patched', cache: '0'}] : []),
    ];

console.log(`${appRoot} ${routes.join(' ')} - ${RUNS} cold process(es) of ${CONC} concurrent requests` +
  (process.env.AGENT ? `, agent ${process.env.AGENT}` : ''));
console.log('-'.repeat(94));

for (const bin of nodeBins) {
  const v = await version(bin);
  for (const cfg of configs) {
    const totals = new Map(PROBES.map(([name]) => [name, {present: 0, cross: 0, wrongTrue: 0}]));
    let row = '';
    let bad = 0;
    for (let run = 0; run < RUNS; run++) {
      const port = await freePort();
      const entry = cfg.preload ? 'tools/preload.mjs' : `${appRoot}/dist/${cfg.dist}/server/server.mjs`;
      const server = spawn(bin, [...AGENT, entry], {
        cwd: repo,
        env: {...process.env, PORT: String(port), NODE_OPTIONS: '', NG_ALLOWED_HOSTS: '*',
              SHARED_CACHE: cfg.cache, PRE_FETCH: '0', APP_ROOT: appRoot, APP_DIST: cfg.dist},
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      try {
        await waitForLine(server, 'listening');
        if (backend) {
          // attack.mjs reports what the backend was shown, which is the impact
          // an operator would see: whose token, whose name in the logs.
          const attack = spawn(process.execPath,
            ['tools/attack.mjs', '1', String(CONC), API, `app=http://127.0.0.1:${port}`],
            {cwd: repo, env: {...process.env, WARMUP: '0'}, stdio: ['ignore', 'pipe', 'pipe']});
          let out = '';
          attack.stdout.on('data', (c) => (out += c));
          await new Promise((r) => attack.once('exit', r));
          row = (out.split('\n').find((l) => l.startsWith('app ')) ?? '(no row)').replace(/\s+/g, ' ');
        } else {
          const users = Array.from({length: CONC}, (_, i) => `u${i}`);
          const sent = new Set(users);
          const replies = await Promise.all(users.map(async (user, i) => {
            const url = `http://127.0.0.1:${port}${routes[i % routes.length]}`;
            const response = await fetch(url,
              {headers: {cookie: `session=${user}`}, signal: AbortSignal.timeout(20_000)});
            return {user, status: response.status, html: await response.text()};
          }));
          for (const reply of replies) {
            if (reply.status !== 200) { bad++; continue; }
            for (const [name, trueId, alsId] of PROBES) {
              const trueUser = field(reply.html, trueId);
              const alsUser = field(reply.html, alsId);
              if (trueUser === null && alsUser === null) continue;
              const t = totals.get(name);
              t.present++;
              if (trueUser !== reply.user) t.wrongTrue++;
              if (alsUser !== reply.user && sent.has(alsUser)) t.cross++;
            }
          }
        }
      } catch (e) {
        row = `ERROR ${e.message.slice(0, 90)}`;
      } finally {
        await stop(server);
      }
    }
    if (!backend) {
      const shown = [...totals].filter(([, t]) => t.present > 0)
        .map(([name, t]) => `${name} ${t.cross}/${t.present}`).join('  ');
      row = (shown || '(no probe in these pages)') +
        (bad ? `  (${bad} non-200)` : '') +
        ([...totals].some(([, t]) => t.wrongTrue) ? '  REQUEST WRONG' : '');
    }
    console.log(`${v.padEnd(9)} ${cfg.label.padEnd(30)} ${row}`);
  }
}

await stop(api);
console.log('-'.repeat(94));
console.log(backend
  ? 'columns: renders, TRACE ids seen, worst, TOKENs seen, worst, LOG lines wrong, LOST'
  : 'each cell: renders that read another request\'s identity / renders where that probe appeared');
