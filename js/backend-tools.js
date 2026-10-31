// UI for the optional local Node service: schedules, monitors, webhooks, and load checks.
async function backendRequest(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Local service returned HTTP ${response.status}.`);
  return result;
}
function backendLine(container, message, actionText, action) {
  const row = document.createElement('div'); row.className = 'backend-row'; const text = document.createElement('span'); text.textContent = message; row.append(text);
  if (actionText) { const button = document.createElement('button'); button.type = 'button'; button.textContent = actionText; button.addEventListener('click', action); row.append(button); }
  container.append(row);
}
function renderSchedules(items) {
  const list = document.querySelector('#schedule-list'); list.replaceChildren();
  if (!items.length) return backendLine(list, 'No scheduled requests.');
  items.forEach(job => backendLine(list, `${job.name} · ${job.method} every ${job.intervalSeconds}s · ${job.lastResult?.status || 'waiting'}`, 'Stop', async () => { await backendRequest(`/api/schedules/${job.id}`, { method: 'DELETE' }); await refreshBackendTools(); }));
}
function renderMonitors(items) {
  const list = document.querySelector('#monitor-list'); list.replaceChildren();
  if (!items.length) return backendLine(list, 'No monitored endpoints.');
  items.forEach(item => { const latest = item.checks?.[0]; const state = latest ? latest.ok ? `${latest.status} · ${latest.elapsedMs} ms` : latest.error || 'failed' : 'checking'; backendLine(list, `${item.name} · ${state}`, 'Stop', async () => { await backendRequest(`/api/monitors/${item.id}`, { method: 'DELETE' }); await refreshBackendTools(); }); });
}
async function refreshBackendTools() {
  const status = document.querySelector('#backend-status');
  try {
    const health = await backendRequest('/api/health'); status.textContent = `Local service ready · Node ${health.node}`;
    const [schedules, monitors, webhooks] = await Promise.all([backendRequest('/api/schedules'), backendRequest('/api/monitors'), backendRequest('/api/webhooks')]);
    renderSchedules(schedules); renderMonitors(monitors); renderWebhooks(webhooks);
  } catch { status.textContent = 'Local service is off. Run “npm start” in the JSONify folder, then open http://127.0.0.1:4173.'; }
}
function renderWebhooks(items) {
  const list = document.querySelector('#webhook-list'); list.replaceChildren();
  if (!items.length) return backendLine(list, 'No webhook receiver created.');
  items.forEach(hook => {
    const row = document.createElement('div'); row.className = 'backend-row'; const text = document.createElement('span'); text.textContent = `${location.origin}/webhooks/${hook.id} · ${hook.eventCount} event(s)`; row.append(text);
    const view = document.createElement('button'); view.type = 'button'; view.textContent = 'View'; view.addEventListener('click', async () => { try { const data = await backendRequest(`/api/webhooks/${hook.id}`); setOutput(JSON.stringify(data.events, null, 2)); setStatus('valid', `Captured ${data.events.length} webhook payload(s)`, 'WEBHOOK EVENTS'); } catch (error) { showToast(error.message, true); } }); row.append(view);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.addEventListener('click', async () => { try { await backendRequest(`/api/webhooks/${hook.id}`, { method: 'DELETE' }); await refreshBackendTools(); } catch (error) { showToast(error.message, true); } }); row.append(remove); list.append(row);
  });
}
function scheduledRequestConfig() {
  const method = document.querySelector('#api-method').value; let url = document.querySelector('#api-url').value;
  const environments = readApiStore('jsonify-environments', {}); const env = environments[document.querySelector('#api-environment').value] || {};
  const substitute = text => text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => key.split('.').reduce((obj, part) => obj?.[part], env) ?? match);
  url = substitute(url); for (const [key, value] of Object.entries(JSON.parse(substitute(document.querySelector('#api-query').value || '{}')))) url += `${url.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value))}`;
  const headers = JSON.parse(substitute(document.querySelector('#api-headers').value || '{}'));
  const auth = document.querySelector('#api-auth-type').value; const secret = document.querySelector('#api-auth-secret').value;
  if (auth === 'bearer' && secret) headers.Authorization = `Bearer ${secret}`;
  if (auth === 'basic' && secret) headers.Authorization = `Basic ${btoa(`${document.querySelector('#api-auth-user').value}:${secret}`)}`;
  if (auth === 'api-key' && secret) headers[document.querySelector('#api-auth-key').value] = secret;
  const bodyText = document.querySelector('#api-body').value.trim();
  return { method, url, headers, body: bodyText ? JSON.stringify(JSON.parse(substitute(bodyText))) : '' };
}
document.querySelector('#backend-refresh').addEventListener('click', refreshBackendTools);
document.querySelector('#schedule-create').addEventListener('click', async () => {
  try { const config = scheduledRequestConfig(); const job = await backendRequest('/api/schedules', { method: 'POST', body: JSON.stringify({ ...config, name: document.querySelector('#api-save-name').value || `${config.method} ${new URL(config.url).pathname}`, intervalSeconds: Number(document.querySelector('#schedule-interval').value) }) }); showToast(`Scheduled locally every ${job.intervalSeconds} seconds.`); await refreshBackendTools(); }
  catch (error) { showToast(error.message, true); }
});
document.querySelector('#monitor-create').addEventListener('click', async () => {
  try { const url = document.querySelector('#monitor-url').value || document.querySelector('#api-url').value; const item = await backendRequest('/api/monitors', { method: 'POST', body: JSON.stringify({ url, intervalSeconds: Number(document.querySelector('#monitor-interval').value) }) }); showToast(`Monitoring started for ${new URL(item.url).host}.`); await refreshBackendTools(); }
  catch (error) { showToast(error.message, true); }
});
document.querySelector('#webhook-create').addEventListener('click', async () => {
  try { await backendRequest('/api/webhooks', { method: 'POST', body: '{}' }); await refreshBackendTools(); showToast('Local webhook receiver created.'); }
  catch (error) { showToast(error.message, true); }
});
document.querySelector('#load-run').addEventListener('click', async () => {
  try {
    const config = scheduledRequestConfig(); const count = Math.max(1, Math.min(50, Number(document.querySelector('#load-count').value) || 1)); const concurrency = Math.max(1, Math.min(5, Number(document.querySelector('#load-concurrency').value) || 1));
    const result = await backendRequest('/api/load-test', { method: 'POST', body: JSON.stringify({ ...config, count, concurrency }) });
    const list = document.querySelector('#load-result'); list.replaceChildren(); backendLine(list, `${result.successes}/${result.requested} succeeded · average ${result.averageMs ?? '—'} ms · ${result.failures} failed.`);
  } catch (error) { showToast(error.message, true); }
});
refreshBackendTools();
let backendRefreshTimer;
document.querySelector('.backend-panel').addEventListener('toggle', event => {
  clearInterval(backendRefreshTimer);
  if (event.target.open) { refreshBackendTools(); backendRefreshTimer = setInterval(refreshBackendTools, 15000); }
});
