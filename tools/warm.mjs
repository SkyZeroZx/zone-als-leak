/**
 * Several bursts against one process: the first burst is a cold start, the rest
 * are warm. Shows which cases only happen in the first requests of a process.
 *
 *   node tools/warm.mjs <app|app21> <nodeBinary> <route[,route]> [bursts] [app|app-zoneless]
 *
 * Starts the backend and one server, then sends `bursts` (default 4) bursts of 20
 * concurrent requests, each with its own session cookie. SHARED_CACHE=1 turns the
 * application's `useValue` cache on. `home` means `/`.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [appRoot = 'app', bin = process.execPath, routeArg = 'account', burstsArg = '4', dist = 'app'] =
  process.argv.slice(2);
const routes = routeArg.split(',').map((r) => (r === 'home' ? '/' : `/${r}`));
const repo = fileURLToPath(new URL('../', import.meta.url));
const PORT = 4630;
const PROBES = [
  ['account', 'trueUser', 'alsUser'],
  ['panel', 'deferTrueUser', 'deferAlsUser'],
  ['profile', 'profileTrueUser', 'profileAlsUser'],
];
const field = (html, id) => new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)?.[1]?.trim() || null;

const api = spawn(process.execPath, ['tools/api.mjs'], { cwd: repo, stdio: 'ignore' });
const server = spawn(bin, [`${appRoot}/dist/${dist}/server/server.mjs`], {
  cwd: repo,
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_OPTIONS: '',
    NG_ALLOWED_HOSTS: '*',
    SHARED_CACHE: process.env.SHARED_CACHE ?? '0',
    PRE_FETCH: '0',
  },
  stdio: 'ignore',
});

async function up(url) {
  for (let i = 0; i < 100; i++) {
    if (await fetch(url).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${url} did not come up`);
}

try {
  await up('http://127.0.0.1:4799/__stats');
  await up(`http://127.0.0.1:${PORT}/favicon.ico`);
  const cells = [];
  for (let b = 0; b < Number(burstsArg); b++) {
    const users = Array.from({ length: 20 }, (_, i) => `b${b}u${i}`);
    const sent = new Set(users);
    const pages = await Promise.all(users.map(async (user, i) => ({
      user,
      html: await fetch(`http://127.0.0.1:${PORT}${routes[i % routes.length]}`, {
        headers: { cookie: `session=${user}` },
        signal: AbortSignal.timeout(20_000),
      }).then((r) => r.text()),
    })));
    cells.push(PROBES.map(([name, trueId, alsId]) => {
      let present = 0;
      let crossed = 0;
      for (const page of pages) {
        const trueUser = field(page.html, trueId);
        const alsUser = field(page.html, alsId);
        if (trueUser === null && alsUser === null) continue;
        present++;
        if (alsUser !== page.user && sent.has(alsUser)) crossed++;
      }
      return present ? `${name} ${crossed}/${present}` : null;
    }).filter(Boolean).join(' '));
  }
  console.log(`${appRoot}/${dist} ${routes.join(' ')}`);
  cells.forEach((cell, i) => console.log(`  burst ${i + 1} ${i === 0 ? '(cold)' : '(warm)'}  ${cell}`));
} finally {
  server.kill();
  api.kill();
}
