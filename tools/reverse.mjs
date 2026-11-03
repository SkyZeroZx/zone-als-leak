/**
 * The other direction: one attacker request among ordinary users, and how many of
 * those users' renders end up running as the attacker.
 *
 *   node tools/reverse.mjs <app|app21> <nodeBinary> [rounds] [app|app-zoneless]
 *
 * Starts the backend and one server with the application's `useValue` cache on
 * (batcher 5), discards two warm-up rounds, then sends `rounds` bursts of 20
 * concurrent requests to /account. Each burst has one request with the session
 * `attacker-r<n>` at a random position (AT=<i> to fix it); the other 19 are victims with their own
 * sessions. A victim is counted when inject(REQUEST) matches its own cookie, so
 * the harness cannot miscount.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [appRoot = 'app', bin = process.execPath, roundsArg = '10', dist = 'app'] = process.argv.slice(2);
const ROUNDS = Number(roundsArg);
const CONC = 20;
const API = 'http://127.0.0.1:4799';
const PORT = 4620;
const repo = fileURLToPath(new URL('../', import.meta.url));
const field = (html, id) => new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)?.[1]?.trim() || null;

const api = spawn(process.execPath, ['tools/api.mjs'], { cwd: repo, stdio: 'ignore' });
const server = spawn(bin, [`${appRoot}/dist/${dist}/server/server.mjs`], {
  cwd: repo,
  env: { ...process.env, PORT: String(PORT), NODE_OPTIONS: '', NG_ALLOWED_HOSTS: '*', SHARED_CACHE: '1' },
  stdio: 'ignore',
});

async function up(url) {
  for (let i = 0; i < 100; i++) {
    if (await fetch(url).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${url} did not come up`);
}

async function burst(round) {
  const attacker = `attacker-r${round}`;
  const at = process.env.AT === undefined ? Math.floor(Math.random() * CONC) : Number(process.env.AT);
  const users = Array.from({ length: CONC }, (_, i) => (i === at ? attacker : `v-r${round}-${i}`));
  await fetch(`${API}/__reset`);
  const pages = await Promise.all(users.map(async (user) => {
    const html = await fetch(`http://127.0.0.1:${PORT}/account`, {
      headers: { cookie: `session=${user}` },
      signal: AbortSignal.timeout(20_000),
    }).then((r) => r.text());
    return { user, trueUser: field(html, 'trueUser'), alsUser: field(html, 'alsUser'), shown: field(html, 'user') };
  }));
  const stats = await fetch(`${API}/__stats`).then((r) => r.json());
  const attackerCalls = new Map(stats.tokens).get(`tok-${attacker}`) ?? 0;
  const victims = pages.filter((p) => p.user !== attacker && p.trueUser === p.user);
  return {
    victims: victims.length,
    ranAsAttacker: victims.filter((p) => p.alsUser === attacker).length,
    shownAttackersAccount: victims.filter((p) => p.shown === attacker).length,
    backendCallsWithAttackerToken: attackerCalls,
  };
}

try {
  await up(`${API}/__stats`);
  await up(`http://127.0.0.1:${PORT}/favicon.ico`);
  for (let w = 0; w < 2; w++) await burst(`warmup${w}`);
  const total = { victims: 0, ranAsAttacker: 0, shownAttackersAccount: 0, backendCallsWithAttackerToken: 0 };
  for (let round = 0; round < ROUNDS; round++) {
    const r = await burst(round);
    for (const k of Object.keys(total)) total[k] += r[k];
  }
  const version = await new Promise((resolve) => {
    let v = '';
    const p = spawn(bin, ['--version']);
    p.stdout.on('data', (c) => (v += c));
    p.once('exit', () => resolve(v.trim()));
  });
  console.log(`${appRoot}/${dist} on ${version}, ${ROUNDS} rounds of ${CONC}, one attacker per round` + (process.env.AT === undefined ? ', random position' : `, position ${process.env.AT}`));
  console.log(`  victim renders                              ${total.victims}`);
  console.log(`  victim renders that ran as the attacker     ${total.ranAsAttacker}`);
  console.log(`  victim pages showing the attacker's account ${total.shownAttackersAccount}`);
  console.log(`  backend calls with the attacker token       ${total.backendCallsWithAttackerToken} (${ROUNDS} are the attacker's own)`);
} finally {
  server.kill();
  api.kill();
}
