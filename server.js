// Optional local backend for scheduled API requests, monitors, and webhooks.
// It uses only Node.js built-ins and binds exclusively to loopback.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const STATE_FILE = path.join(ROOT, '.jsonify-state.json');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const MAX_BODY = 1024 * 1024;
const state = loadState();
const timers = new Map();

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [], monitors: Array.isArray(parsed.monitors) ? parsed.monitors : [], webhooks: Array.isArray(parsed.webhooks) ? parsed.webhooks : [] };
  } catch { return { schedules: [], monitors: [], webhooks: [] }; }
}
function persist() { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 }); }
function send(res, status, data) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); }
async function readBody(req, limit = MAX_BODY) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw Object.assign(new Error('Request body is too large.'), { status: 413 }); chunks.push(chunk); }
  const text = Buffer.concat(chunks).toString('utf8'); return text ? JSON.parse(text) : {};
}
function validUrl(value) {
  let url; try { url = new URL(value); } catch { throw new Error('Provide a valid absolute URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
  return url.href;
}
function method(value) { const result = String(value || 'GET').toUpperCase(); if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(result)) throw new Error('Unsupported HTTP method.'); return result; }
async function timedFetch(config, timeoutMs = 15000) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), timeoutMs); const start = performance.now();
  try {
    const response = await fetch(validUrl(config.url), { method: method(config.method), headers: config.headers || {}, body: ['GET', 'HEAD'].includes(method(config.method)) ? undefined : config.body, signal: controller.signal, redirect: 'manual' });
    const text = await response.text(); return { status: response.status, statusText: response.statusText, elapsedMs: Math.round(performance.now() - start), body: text.slice(0, 50000), ok: response.ok };
  } finally { clearTimeout(timeout); }
}
function scheduleJob(job) {
  const handle = setInterval(async () => {
    try { const result = await timedFetch(job, 15000); job.lastRun = new Date().toISOString(); job.lastResult = { status: result.status, elapsedMs: result.elapsedMs, ok: result.ok }; }
    catch (error) { job.lastRun = new Date().toISOString(); job.lastResult = { error: error.message }; }
    persist();
  }, job.intervalSeconds * 1000);
  timers.set(`schedule:${job.id}`, handle);
}
function monitorJob(monitor) {
  const handle = setInterval(async () => {
    const start = Date.now();
    try { const result = await timedFetch({ url: monitor.url, method: 'GET' }, 10000); monitor.checks.unshift({ at: new Date().toISOString(), status: result.status, elapsedMs: result.elapsedMs, ok: result.ok }); }
    catch (error) { monitor.checks.unshift({ at: new Date().toISOString(), error: error.message, elapsedMs: Date.now() - start, ok: false }); }
    monitor.checks = monitor.checks.slice(0, 100); persist();
  }, monitor.intervalSeconds * 1000);
  timers.set(`monitor:${monitor.id}`, handle);
  void (async () => { try { const result = await timedFetch({ url: monitor.url, method: 'GET' }, 10000); monitor.checks.unshift({ at: new Date().toISOString(), status: result.status, elapsedMs: result.elapsedMs, ok: result.ok }); } catch (error) { monitor.checks.unshift({ at: new Date().toISOString(), error: error.message, ok: false }); } monitor.checks = monitor.checks.slice(0, 100); persist(); })();
}
for (const job of state.schedules) scheduleJob(job);
for (const monitor of state.monitors) monitorJob(monitor);

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const origin = req.headers.origin;
    if (origin) {
      const parsedOrigin = new URL(origin);
      if (!['127.0.0.1', 'localhost'].includes(parsedOrigin.hostname) || parsedOrigin.port !== String(PORT)) return send(res, 403, { error: 'Cross-origin requests are not allowed.' });
    }
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, node: process.version, schedules: state.schedules.length, monitors: state.monitors.length, webhookCount: state.webhooks.length });
    if (url.pathname === '/api/request' && req.method === 'POST') {
      const config = await readBody(req); const target = validUrl(config.url); const verb = method(config.method); const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30000); const started = performance.now();
      try {
        const upstream = await fetch(target, { method: verb, headers: config.headers || {}, body: ['GET', 'HEAD'].includes(verb) ? undefined : config.body || undefined, signal: controller.signal, redirect: 'manual', credentials: 'omit' });
        let text = await upstream.text(); const truncated = text.length > 2 * 1024 * 1024; if (truncated) text = text.slice(0, 2 * 1024 * 1024);
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') || 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-jsonify-duration': String(Math.round(performance.now() - started)), 'x-jsonify-truncated': String(truncated) }); return res.end(text);
      } finally { clearTimeout(timeout); }
    }
    if (url.pathname === '/api/schedules' && req.method === 'GET') return send(res, 200, state.schedules);
    if (url.pathname === '/api/schedules' && req.method === 'POST') {
      const body = await readBody(req); const intervalSeconds = Math.max(30, Math.min(86400, Number(body.intervalSeconds) || 0));
      const job = { id: crypto.randomUUID(), name: String(body.name || 'Scheduled request').slice(0, 100), url: validUrl(body.url), method: method(body.method), headers: body.headers || {}, body: body.body || '', intervalSeconds, createdAt: new Date().toISOString(), lastRun: null, lastResult: null };
      state.schedules.push(job); persist(); scheduleJob(job); return send(res, 201, job);
    }
    if (url.pathname.startsWith('/api/schedules/') && req.method === 'DELETE') { const id = url.pathname.split('/').pop(); clearInterval(timers.get(`schedule:${id}`)); timers.delete(`schedule:${id}`); const before = state.schedules.length; state.schedules = state.schedules.filter(item => item.id !== id); persist(); return send(res, before === state.schedules.length ? 404 : 200, { removed: before !== state.schedules.length }); }
    if (url.pathname === '/api/monitors' && req.method === 'GET') return send(res, 200, state.monitors);
    if (url.pathname === '/api/monitors' && req.method === 'POST') {
      const body = await readBody(req); const intervalSeconds = Math.max(15, Math.min(86400, Number(body.intervalSeconds) || 0));
      const monitor = { id: crypto.randomUUID(), name: String(body.name || 'Endpoint').slice(0, 100), url: validUrl(body.url), intervalSeconds, checks: [] };
      state.monitors.push(monitor); persist(); monitorJob(monitor); return send(res, 201, monitor);
    }
    if (url.pathname.startsWith('/api/monitors/') && req.method === 'DELETE') { const id = url.pathname.split('/').pop(); clearInterval(timers.get(`monitor:${id}`)); timers.delete(`monitor:${id}`); const before = state.monitors.length; state.monitors = state.monitors.filter(item => item.id !== id); persist(); return send(res, before === state.monitors.length ? 404 : 200, { removed: before !== state.monitors.length }); }
    if (url.pathname === '/api/load-test' && req.method === 'POST') {
      const body = await readBody(req); const target = validUrl(body.url); const verb = method(body.method); const count = Math.max(1, Math.min(50, Number(body.count) || 1)); const concurrency = Math.max(1, Math.min(5, Number(body.concurrency) || 1));
      const results = []; let cursor = 0; const worker = async () => { while (cursor < count) { const index = cursor++; try { results[index] = await timedFetch({ url: target, method: verb, headers: body.headers || {}, body: body.body || '' }, 10000); } catch (error) { results[index] = { ok: false, error: error.message }; } } };
      await Promise.all(Array.from({ length: Math.min(concurrency, count) }, worker));
      const times = results.map(item => item.elapsedMs).filter(Number.isFinite).sort((a, b) => a - b); const successes = results.filter(item => item.ok).length;
      return send(res, 200, { requested: count, concurrency, successes, failures: count - successes, minMs: times[0] ?? null, maxMs: times.at(-1) ?? null, averageMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null, results });
    }
    if (url.pathname === '/api/webhooks' && req.method === 'GET') return send(res, 200, state.webhooks.map(({ id, createdAt, events }) => ({ id, createdAt, eventCount: events.length, lastEvent: events.at(-1)?.at || null })));
    if (url.pathname === '/api/webhooks' && req.method === 'POST') { if (state.webhooks.length >= 100) return send(res, 429, { error: 'Webhook receiver limit reached.' }); const hook = { id: crypto.randomBytes(12).toString('hex'), createdAt: new Date().toISOString(), events: [] }; state.webhooks.push(hook); persist(); return send(res, 201, hook); }
    if (url.pathname.startsWith('/api/webhooks/') && req.method === 'GET') { const id = url.pathname.split('/').pop(); const hook = state.webhooks.find(item => item.id === id); return hook ? send(res, 200, hook) : send(res, 404, { error: 'Webhook not found.' }); }
    if (url.pathname.startsWith('/api/webhooks/') && req.method === 'DELETE') { const id = url.pathname.split('/').pop(); const before = state.webhooks.length; state.webhooks.splice(0, state.webhooks.length, ...state.webhooks.filter(item => item.id !== id)); persist(); return send(res, before === state.webhooks.length ? 404 : 200, { removed: before !== state.webhooks.length }); }
    const hookMatch = url.pathname.match(/^\/webhooks\/([a-f0-9]+)$/);
    if (hookMatch && req.method === 'POST') { const hook = state.webhooks.find(item => item.id === hookMatch[1]); if (!hook) return send(res, 404, { error: 'Webhook not found.' }); let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > MAX_BODY) return send(res, 413, { error: 'Payload too large.' }); } hook.events.push({ at: new Date().toISOString(), contentType: req.headers['content-type'] || '', body: raw }); hook.events = hook.events.slice(-100); persist(); return send(res, 202, { received: true }); }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 404, { error: 'Route not found.' });
    const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const filename = path.resolve(ROOT, `.${requested}`);
    if (!filename.startsWith(ROOT + path.sep) || filename === STATE_FILE || requested.split('/').some(part => part.startsWith('.'))) return send(res, 404, { error: 'Not found.' });
    const stat = await fs.promises.stat(filename).catch(() => null); if (!stat?.isFile()) return send(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'content-type': mime[path.extname(filename)] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') return res.end(); fs.createReadStream(filename).pipe(res);
  } catch (error) { send(res, error.status || 400, { error: error.message || 'Request failed.' }); }
});

server.listen(PORT, HOST, () => console.log(`JSONify local service: http://${HOST}:${PORT}`));
server.on('close', () => { for (const timer of timers.values()) clearInterval(timer); });
