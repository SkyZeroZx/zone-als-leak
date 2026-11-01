/**
 * The attacker. Keep-alive connections per target, all requests written in one burst so
 * they land in the same event-loop turn. Each request carries its own session cookie and
 * its own W3C traceparent.
 *
 *   TRACE  @opentelemetry/*     distinct trace ids the backend was shown
 *   LOGS   pino                 render log lines whose user is not the caller
 *   TOKEN  express-http-context distinct bearer tokens the backend was shown
 *
 * TRACE and TOKEN are observed by the backend, not by the code under test.
 *
 * Usage: node tools/attack.mjs <rounds> <concurrency> <apiUrl> <label=url> ...
 */
import http from 'node:http';
import http2 from 'node:http2';

const ROUNDS = Number(process.argv[2] ?? 5);
const CONC = Number(process.argv[3] ?? 20);
const API = process.argv[4] ?? 'http://127.0.0.1:4799';
/** WARMUP=0 measures a cold process: the very first requests it ever serves. */
const WARMUP = Number(process.env.WARMUP ?? 2);
const TARGETS = process.argv.slice(5).map((t) => {
  const i = t.indexOf('=');
  return { label: t.slice(0, i), url: new URL(t.slice(i + 1)) };
});
if (!TARGETS.length) {
  console.error('usage: node tools/attack.mjs <rounds> <concurrency> <apiUrl> <label=url> ...');
  process.exit(2);
}

const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
const field = (html, id) => new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)?.[1]?.trim() || null;

/**
 * HTTP/2 variant (target spelled h2://host:port): one connection, one stream per request.
 */
function renderH2(session, user, traceId) {
  return new Promise((resolve) => {
    const s = session.request({
      ':path': '/account',
      ':method': 'GET',
      cookie: `session=${user}`,
      traceparent: `00-${traceId}-${hex(16)}-01`,
    });
    let body = '';
    let status = 0;
    s.on('response', (h) => (status = Number(h[':status'])));
    s.setEncoding('utf8');
    s.on('data', (c) => (body += c));
    s.on('error', (e) => resolve({ sent: user, status: 0, error: e.message }));
    s.on('end', () =>
      resolve({
        sent: user,
        status,
        trueUser: field(body, 'trueUser'),
        alsUser: field(body, 'alsUser'),
        account: field(body, 'user'),
        iban: field(body, 'iban'),
      }),
    );
  });
}

function render(target, agent, user, traceId) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: target.url.hostname,
        port: target.url.port || 80,
        path: '/account',
        agent,
        headers: { cookie: `session=${user}`, traceparent: `00-${traceId}-${hex(16)}-01` },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () =>
          resolve({
            sent: user,
            status: res.statusCode,
            trueUser: field(body, 'trueUser'),
            alsUser: field(body, 'alsUser'),
            account: field(body, 'user'),
            iban: field(body, 'iban'),
          }),
        );
      },
    );
    req.on('error', (e) => resolve({ sent: user, status: 0, error: e.message }));
    req.end();
  });
}

async function run(target) {
  const isH2 = target.url.protocol === 'h2:';
  const agent = isH2 ? null : new http.Agent({ keepAlive: true, maxSockets: CONC + 4 });
  const session = isH2
    ? http2.connect(`http://${target.url.hostname}:${target.url.port}`)
    : null;
  if (session) await new Promise((r, j) => { session.once('connect', r); session.once('error', j); });
  await fetch(`${API}/__reset`);

  const s = { renders: 0, failed: 0, logLeak: 0, tokenLeak: 0, lost: 0, example: null };
  const tracesSent = new Set();

  // two warm-up rounds, discarded from the per-render counts (the backend reset already
  // happened, so warm-up calls are excluded by resetting again right after)
  for (let r = -WARMUP; r < ROUNDS; r++) {
    if (r === 0) await fetch(`${API}/__reset`);
    if (r === 0) tracesSent.clear();
    const batch = Array.from({ length: CONC }, (_, i) => {
      const traceId = hex(32);
      if (r >= 0) tracesSent.add(traceId);
      const user = `${target.label}.r${r}x${i}`;
      return session ? renderH2(session, user, traceId) : render(target, agent, user, traceId);
    });
    const res = await Promise.all(batch);
    if (r < 0) continue;
    for (const x of res) {
      if (x.status !== 200) {
        s.failed++;
        continue;
      }
      s.renders++;
      // inject(REQUEST) must equal the cookie we sent, or the harness itself is wrong
      if (x.trueUser !== x.sent) {
        s.failed++;
        s.renders--;
        continue;
      }
      // identity LOST: the store was gone, so pino logged nobody and no token was sent
      if (x.alsUser === null || x.account === 'guest') s.lost++;
      if (x.alsUser !== null && x.alsUser !== x.sent) s.logLeak++;
      if (x.account !== 'guest' && x.account !== x.sent) {
        s.tokenLeak++;
        s.example ??= { attacker: x.sent, pino_logged: x.alsUser, account_shown: x.account, iban: x.iban };
      }
    }
  }
  agent?.destroy();
  session?.close();

  const stats = await (await fetch(`${API}/__stats`)).json();
  const seen = (list) => list.filter(([k]) => k !== 'none');
  const traces = seen(stats.traces);
  const tokens = seen(stats.tokens);
  const maxOf = (l) => l.reduce((a, [, n]) => Math.max(a, n), 0);

  // Distinguish "no telemetry in this process" from "telemetry leaked". Without the
  // OpenTelemetry agent nothing injects a traceparent, so every call arrives with none;
  // that is an absent signal, not a leak, and must not be printed as 0/N.
  const withoutTrace = stats.traces.find(([k]) => k === 'none')?.[1] ?? 0;
  const hasTelemetry = traces.length > 0 && withoutTrace < s.renders / 2;

  return {
    ...s,
    apiCalls: stats.calls,
    tracesSent: tracesSent.size,
    tracesSeen: traces.length,
    traceMax: maxOf(traces),
    tokensSeen: tokens.length,
    tokenMax: maxOf(tokens),
    hasTelemetry,
    hadIdentity: tokens.length > 0,
  };
}

const rows = [];
for (const t of TARGETS) {
  process.stderr.write(`attacking ${t.label.padEnd(22)} `);
  const r = await run(t);
  rows.push({ label: t.label, ...r });
  process.stderr.write(
    `traces ${r.tracesSeen}/${r.tracesSent}` + (r.hadIdentity ? `, tokens ${r.tokensSeen}/${r.renders}, logs ${r.logLeak}` : '') + '\n',
  );
}

const pad = (v, n) => String(v).padEnd(n);
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');

console.log(`\n${ROUNDS} rounds x ${CONC} concurrent requests per target.`);
console.log(`Each render has its own session cookie and its own W3C traceparent.`);
console.log(`A correct system shows the backend exactly one distinct trace id and one`);
console.log(`distinct token per render.\n`);

console.log(
  pad('target', 24) + pad('renders', 9) +
  pad('TRACE ids seen', 16) + pad('worst', 8) +
  pad('TOKENs seen', 13) + pad('worst', 8) +
  pad('LOG wrong', 14) + pad('LOST', 8) + '',
);
console.log('-'.repeat(114));
for (const r of rows) {
  const na = r.hadIdentity ? null : '-';
  const nt = r.hasTelemetry ? null : '-';
  console.log(
    pad(r.label, 24) + pad(r.renders, 9) +
    pad(nt ?? `${r.tracesSeen}/${r.tracesSent}`, 16) + pad(nt ?? `${r.traceMax}x`, 8) +
    pad(na ?? `${r.tokensSeen}/${r.renders}`, 13) + pad(na ?? `${r.tokenMax}x`, 8) +
    pad(na ?? `${r.logLeak} (${pct(r.logLeak, r.renders)})`, 14) +
    pad(na ?? `${r.lost}`, 8) +
    (r.failed ? `  (${r.failed} failed)` : ''),
  );
}
console.log('-'.repeat(96));
console.log(`TRACE ids seen  = distinct trace ids the backend received / sent by the driver`);
console.log(`worst           = how many different renders continued the same trace / used the same token`);
console.log(`LOST            = renders whose request context was gone entirely: pino logged no user`);
console.log(`                  and no credentials were sent, so the backend answered as guest`);
console.log(`"-"             = that signal does not exist in this configuration: no identity code in`);
console.log(`                  the application, or no OpenTelemetry agent injecting a traceparent\n`);

const ex = rows.find((r) => r.example)?.example;
if (ex) console.log('example:', JSON.stringify(ex));

const leaked = rows.some(
  (r) => (r.hasTelemetry && r.tracesSeen < r.tracesSent) || r.logLeak || r.tokenLeak || r.lost,
);
process.exit(leaked ? 1 : 0);
