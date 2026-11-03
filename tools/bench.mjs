/**
 * Throughput of one build, to compare the stock zone.js build with the patched one.
 *
 *   node tools/bench.mjs <app|app21> <nodeBinary> <app|patched> <route> [requests] [concurrency]
 *
 * Starts the backend and one server, warms it with 300 requests, then sends
 * `requests` (default 2000) with `concurrency` (default 20) in flight and prints
 * requests per second and the p50 and p99 latency. `home` means `/`.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [appRoot = 'app21', bin = process.execPath, dist = 'app', routeName = 'account', nArg = '2000', cArg = '20'] =
  process.argv.slice(2);
const route = routeName === 'home' ? '/' : `/${routeName}`;
const N = Number(nArg);
const C = Number(cArg);
const PORT = 4640;
const repo = fileURLToPath(new URL('../', import.meta.url));

const api = spawn(process.execPath, ['tools/api.mjs'], {
  cwd: repo,
  stdio: 'ignore',
  env: { ...process.env, SETTINGS_DELAY: '0' },
});
const server = spawn(bin, [`${appRoot}/dist/${dist}/server/server.mjs`], {
  cwd: repo,
  env: { ...process.env, PORT: String(PORT), NODE_OPTIONS: '', NG_ALLOWED_HOSTS: '*', SHARED_CACHE: '0', PRE_FETCH: '0' },
  stdio: 'ignore',
});

async function up(url) {
  for (let i = 0; i < 100; i++) {
    if (await fetch(url).then((r) => r.ok, () => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${url} did not come up`);
}

async function run(total) {
  let next = 0;
  const latencies = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: C }, async () => {
    while (next < total) {
      const i = next++;
      const t = performance.now();
      const response = await fetch(`http://127.0.0.1:${PORT}${route}`, { headers: { cookie: `session=u${i % 50}` } });
      await response.text();
      if (response.status !== 200) throw new Error(`status ${response.status}`);
      latencies.push(performance.now() - t);
    }
  }));
  const ms = performance.now() - started;
  latencies.sort((a, b) => a - b);
  const at = (q) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))].toFixed(1);
  return { rps: (total / ms) * 1000, p50: at(0.5), p99: at(0.99) };
}

try {
  await up('http://127.0.0.1:4799/__stats');
  await up(`http://127.0.0.1:${PORT}/favicon.ico`);
  await run(300);
  const r = await run(N);
  console.log(`${appRoot}/${dist} ${route}  ${r.rps.toFixed(0)} req/s  p50 ${r.p50} ms  p99 ${r.p99} ms`);
} finally {
  server.kill();
  api.kill();
}
