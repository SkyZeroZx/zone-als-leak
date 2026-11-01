/**
 * The backend. Records, per call, the bearer token presented and the traceparent trace id
 * received, so both are observed by a third party rather than by the code under test.
 * The driver sends a distinct session and trace id per request.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.API_PORT ?? 4799);
const SETTINGS_DELAY = Number(process.env.SETTINGS_DELAY ?? 40);

const accountOf = (user) => ({
  user,
  email: `${user}@bank.example`,
  iban: `ES76 0000 ${String(user.length * 7777).padStart(4, '0')} ${Buffer.from(user).toString('hex').slice(0, 4)}`,
  balance: 1000 + (user.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 9000),
});

let tokens = new Map();
let traces = new Map();
let calls = 0;

const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

createServer((req, res) => {
  const json = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (req.url === '/__reset') {
    tokens = new Map();
    traces = new Map();
    calls = 0;
    return json(200, { reset: true });
  }

  if (req.url === '/__stats') {
    return json(200, { calls, tokens: [...tokens], traces: [...traces] });
  }

  // public, harmless, shared by every request: the shared-in-flight-promise payload
  if (req.url === '/api/settings') {
    return setTimeout(() => json(200, { theme: 'light', locale: 'en' }), SETTINGS_DELAY);
  }

  if (req.url === '/api/me') {
    const token = /^Bearer (.+)$/.exec(req.headers['authorization'] ?? '')?.[1];
    const traceId = /^00-([0-9a-f]{32})-/.exec(req.headers['traceparent'] ?? '')?.[1];

    // Docker healthchecks share this backend; the reserved identity is not counted.
    if (token === 'tok-healthcheck') {
      return json(200, accountOf('healthcheck'));
    }

    calls++;
    // whose trace did this render continue? (00-<trace id>-<span id>-<flags>)
    bump(traces, traceId ?? 'none');
    // whose credentials did this render present?
    bump(tokens, token ?? 'none');

    // With no credentials the render gets a guest payload rather than an error, so the
    // telemetry case can run with no identity code in the application at all.
    return json(200, token?.startsWith('tok-') ? accountOf(token.slice(4)) : accountOf('guest'));
  }

  json(404, { error: 'not found' });
}).listen(PORT, () => console.log(`api listening on port ${PORT}`));
