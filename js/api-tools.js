// API request collections, environments, history, auth, and request execution.
function readApiStore(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value ?? fallback; } catch { return fallback; }
}
function refreshApiMenus() {
  const collections = readApiStore('jsonify-api-collection', []);
  const collectionSelect = document.querySelector('#api-collection-select');
  collectionSelect.replaceChildren(new Option('Choose a saved request…', ''));
  collections.forEach((item, index) => collectionSelect.add(new Option(item.name, String(index))));
  const environments = readApiStore('jsonify-environments', {});
  const environmentSelect = document.querySelector('#api-environment');
  const selected = environmentSelect.value;
  environmentSelect.replaceChildren(new Option('No environment', ''));
  Object.keys(environments).forEach(name => environmentSelect.add(new Option(name, name)));
  if (environments[selected]) environmentSelect.value = selected;
  const history = readApiStore('jsonify-api-history', []);
  const historySelect = document.querySelector('#api-history');
  historySelect.replaceChildren(new Option(history.length ? 'Choose a recent request…' : 'No request history', ''));
  history.forEach((item, index) => historySelect.add(new Option(`${item.method} ${item.status} · ${item.url}`, String(index))));
}
function saveApiHistory(item) {
  const history = readApiStore('jsonify-api-history', []);
  history.unshift({ ...item, at: new Date().toISOString() });
  try { localStorage.setItem('jsonify-api-history', JSON.stringify(history.slice(0, 20))); } catch { showToast('Could not store request history in this browser.', true); }
  refreshApiMenus();
}
document.querySelector('#api-auth-type').addEventListener('change', event => {
  const type = event.target.value;
  document.querySelector('#api-auth-user').hidden = type !== 'basic';
  document.querySelector('#api-auth-key').hidden = type !== 'api-key';
  document.querySelector('#api-auth-secret').placeholder = type === 'bearer' ? 'Bearer token' : type === 'basic' ? 'Password' : type === 'api-key' ? 'API key value' : 'Authentication secret';
});
document.querySelector('#api-save-button').addEventListener('click', () => {
  const name = document.querySelector('#api-save-name').value.trim();
  if (!name) { showToast('Name this saved request first.', true); return; }
  try {
    const headers = JSON.parse(document.querySelector('#api-headers').value || '{}');
    for (const key of Object.keys(headers)) if (/authorization|token|secret|api.?key/i.test(key)) delete headers[key];
    const items = readApiStore('jsonify-api-collection', []);
    const item = { name, method: document.querySelector('#api-method').value, url: document.querySelector('#api-url').value, query: document.querySelector('#api-query').value, headers: JSON.stringify(headers), body: document.querySelector('#api-body').value, authType: document.querySelector('#api-auth-type').value, authKey: document.querySelector('#api-auth-key').value, authUser: document.querySelector('#api-auth-user').value };
    const existing = items.findIndex(entry => entry.name === name);
    if (existing >= 0) items[existing] = item; else items.push(item);
    localStorage.setItem('jsonify-api-collection', JSON.stringify(items));
    refreshApiMenus(); showToast('Request saved locally. Authentication secrets are not saved.');
  } catch { showToast('Headers must be valid JSON before saving.', true); }
});
document.querySelector('#api-collection-select').addEventListener('change', event => {
  if (event.target.value === '') return;
  const item = readApiStore('jsonify-api-collection', [])[Number(event.target.value)]; if (!item) return;
  document.querySelector('#api-method').value = item.method; document.querySelector('#api-url').value = item.url;
  document.querySelector('#api-query').value = item.query; document.querySelector('#api-headers').value = item.headers;
  document.querySelector('#api-body').value = item.body; document.querySelector('#api-auth-type').value = item.authType;
  document.querySelector('#api-auth-key').value = item.authKey || ''; document.querySelector('#api-auth-user').value = item.authUser || ''; document.querySelector('#api-auth-secret').value = '';
  document.querySelector('#api-auth-type').dispatchEvent(new Event('change'));
});
document.querySelector('#api-env-edit-button').addEventListener('click', () => {
  const existing = readApiStore('jsonify-environments', {});
  const name = prompt('Environment name (for example: Development):'); if (!name?.trim()) return;
  const initial = existing[name.trim()] || { baseUrl: 'https://api.example.test' };
  const value = prompt('Enter environment variables as a JSON object. Use {{key}} in the URL, headers, and request body.', JSON.stringify(initial, null, 2));
  if (value === null) return;
  try { const parsed = JSON.parse(value); if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error(); existing[name.trim()] = parsed; localStorage.setItem('jsonify-environments', JSON.stringify(existing)); refreshApiMenus(); document.querySelector('#api-environment').value = name.trim(); showToast('Environment saved in this browser.'); }
  catch { showToast('Environment must be a JSON object.', true); }
});
document.querySelector('#api-history').addEventListener('change', event => {
  if (event.target.value === '') return;
  const item = readApiStore('jsonify-api-history', [])[Number(event.target.value)]; if (!item) return;
  document.querySelector('#api-method').value = item.method; document.querySelector('#api-url').value = item.url;
  document.querySelector('#api-status').textContent = `${item.status} · ${new Date(item.at).toLocaleString()}`;
  document.querySelector('#api-timing').textContent = `${item.elapsed} ms · history`;
  try { const parsed = JSON.parse(item.response); setOutput(JSON.stringify(parsed, null, 2)); } catch { setOutput(item.response, 'api-text'); }
});
refreshApiMenus();
document.querySelector('#api-send-button').addEventListener('click', async event => {
  setActiveTool('api-send-button');
  const button = event.currentTarget;
  const status = document.querySelector('#api-status');
  const timing = document.querySelector('#api-timing');
  const method = document.querySelector('#api-method').value;
  let requestUrl = document.querySelector('#api-url').value;
  let url;
  try {
    const environments = readApiStore('jsonify-environments', {});
    const environment = environments[document.querySelector('#api-environment').value] || {};
    const interpolate = text => text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, key) => key.split('.').reduce((obj, part) => obj?.[part], environment) ?? match);
    requestUrl = interpolate(requestUrl);
    url = new URL(requestUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS URL.');
    const queryText = interpolate(document.querySelector('#api-query').value).trim();
    const query = queryText ? JSON.parse(queryText) : {};
    if (!query || typeof query !== 'object' || Array.isArray(query)) throw new Error('Query parameters must be a JSON object.');
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach(item => url.searchParams.append(key, String(item)));
      else url.searchParams.set(key, value === null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    const headersText = interpolate(document.querySelector('#api-headers').value).trim();
    const headerValues = headersText ? JSON.parse(headersText) : {};
    if (!headerValues || typeof headerValues !== 'object' || Array.isArray(headerValues)) throw new Error('Request headers must be a JSON object.');
    const headers = new Headers();
    Object.entries(headerValues).forEach(([key, value]) => headers.set(key, String(value)));
    const authType = document.querySelector('#api-auth-type').value;
    const authSecret = document.querySelector('#api-auth-secret').value;
    if (authType === 'bearer' && authSecret) headers.set('Authorization', `Bearer ${authSecret}`);
    if (authType === 'basic' && authSecret) headers.set('Authorization', `Basic ${btoa(`${document.querySelector('#api-auth-user').value}:${authSecret}`)}`);
    if (authType === 'api-key' && authSecret) {
      const keyName = document.querySelector('#api-auth-key').value.trim();
      if (!keyName) throw new Error('Enter a header name for the API key.');
      headers.set(keyName, authSecret);
    }
    let body;
    const bodyText = document.querySelector('#api-body').value.trim();
    if (bodyText && !['GET', 'HEAD'].includes(method)) {
      const parsedBody = JSON.parse(interpolate(bodyText));
      body = JSON.stringify(parsedBody);
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    button.disabled = true; button.textContent = 'Sending…'; status.textContent = `${method} request in progress…`;
    const started = performance.now();
    try {
      const useLocalProxy = location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname);
      const response = useLocalProxy
        ? await fetch('/api/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.href, method, headers: Object.fromEntries(headers), body }), signal: controller.signal, cache: 'no-store' })
        : await fetch(url, { method, headers, body, signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
      const responseText = await response.text();
      const elapsed = Number(response.headers.get('x-jsonify-duration')) || Math.round(performance.now() - started);
      timing.textContent = `${elapsed} ms`;
      status.textContent = `${response.status} ${response.statusText}`;
      if (response.headers.get('x-jsonify-truncated') === 'true') document.querySelector('#output-hint').textContent = 'Response exceeded the local 2 MB limit and was truncated.';
      let responseValue;
      if (!responseText.trim()) { responseValue = undefined; setOutput('No response body.', 'api-text'); }
      else {
        try { responseValue = JSON.parse(responseText); setOutput(JSON.stringify(responseValue, null, 2)); }
        catch { responseValue = undefined; setOutput(responseText, 'api-text'); }
      }
      const assertionText = document.querySelector('#api-assertions').value.trim();
      const assertionFailures = [];
      if (assertionText) {
        try {
          const assertions = JSON.parse(assertionText);
          for (const [path, expected] of Object.entries(assertions)) {
            let actual;
            try { const matches = path.startsWith('$') && responseValue !== undefined ? queryJSONPath(responseValue, path) : []; actual = path === 'status' ? response.status : matches.length === 1 ? matches[0].value : matches.length ? matches.map(item => item.value) : undefined; } catch { actual = undefined; }
            const passed = expected === 'exists' ? actual !== undefined : JSON.stringify(canonicalJSON(actual)) === JSON.stringify(canonicalJSON(expected));
            if (!passed) assertionFailures.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
          }
        } catch (error) { assertionFailures.push(`Assertion configuration error: ${error.message}`); }
      }
      saveApiHistory({ method, url: url.href, status: response.status, elapsed, response: responseText.slice(0, 50000) });
      const checkSchema = document.querySelector('#api-validate-response').checked;
      let schemaErrors = [];
      if (checkSchema && responseValue === undefined) schemaErrors = ['Response body is not valid JSON.'];
      if (checkSchema && responseValue !== undefined) {
        try {
          const schemaText = document.querySelector('#json-schema').value.trim();
          if (!schemaText) schemaErrors = ['Add a schema in Validate before enabling response validation.'];
          else {
            const responseSchema = JSON.parse(schemaText);
            schemaErrors = validateSchema(responseValue, responseSchema, '$', [], responseSchema, [], document.querySelector('#schema-draft').value);
          }
        } catch (error) { schemaErrors = [`Schema check failed: ${error.message}`]; }
      }
      if (!response.ok) setStatus('error', `API returned HTTP ${response.status} ${response.statusText}`, 'HTTP ERROR');
      else if (assertionFailures.length) setStatus('invalid', `Assertions failed: ${assertionFailures.slice(0, 2).join('; ')}`, 'ASSERTIONS FAILED');
      else if (schemaErrors.length) setStatus('invalid', `Response failed schema validation: ${schemaErrors.slice(0, 2).join(' ')}`, 'SCHEMA MISMATCH');
      else setStatus('valid', `API response received in ${elapsed} ms`, responseValue === undefined ? 'TEXT RESPONSE' : 'JSON RESPONSE');
    } finally {
      clearTimeout(timeout); button.disabled = false; button.textContent = 'Send request';
    }
  } catch (error) {
    const message = error.name === 'AbortError' ? 'Request timed out after 30 seconds.' : error instanceof SyntaxError ? 'Check that query parameters, headers, and request body contain valid JSON.' : error.message;
    status.textContent = message;
    setStatus('error', message.includes('Failed to fetch') ? 'Request blocked or unreachable. The API may not allow browser CORS requests.' : message, 'REQUEST FAILED');
  }
});
