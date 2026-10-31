// Shared app state and navigation, status, output, and formatting helpers.
const input = document.querySelector('#json-input');
const output = document.querySelector('#json-output');
const inputLines = document.querySelector('#input-lines');
const outputLines = document.querySelector('#output-lines');
const statusBar = document.querySelector('#status-bar');
const statusText = document.querySelector('#status-text');
const validityText = document.querySelector('#validity-text');
const toast = document.querySelector('#toast');
let toastTimer;
let activeSearchIndex = -1;
let outputKind = 'json';

const sampleJSON = `{
  "project": "JSONify",
  "version": 1,
  "description": "A friendly JSON toolkit",
  "features": ["format", "validate", "minify"],
  "settings": {
    "private": true,
    "indentation": 2
  },
  "maintainer": {
    "name": "Alex Morgan",
    "active": true
  }
}`;

function byteSize(text) {
  return new Blob([text]).size;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
}

function updateStats() {
  const text = input.value;
  const lines = text ? text.split('\n').length : 0;
  document.querySelector('#input-lines-count').textContent = lines;
  document.querySelector('#input-char-count').textContent = text.length;
  inputLines.textContent = text ? Array.from({ length: lines }, (_, i) => i + 1).join('\n') : '1';
  document.querySelector('#size-text').textContent = formatSize(byteSize(text));
  inputLines.scrollTop = input.scrollTop;
}

function setOutput(text, kind = 'json') {
  activeSearchIndex = -1;
  outputKind = text ? kind : 'json';
  showOutputView('code');
  if (text) {
    output.textContent = text;
    output.classList.remove('empty');
  } else {
    output.innerHTML = '<span class="output-placeholder">Formatted JSON will appear here<span class="placeholder-cursor"></span></span>';
    output.classList.add('empty');
  }
  const lines = text ? text.split('\n').length : 0;
  document.querySelector('#output-lines-count').textContent = lines;
  document.querySelector('#output-char-count').textContent = text.length;
  outputLines.textContent = text ? Array.from({ length: lines }, (_, i) => i + 1).join('\n') : '1';
  document.querySelector('#copy-button').disabled = !text;
  document.querySelector('#download-button').disabled = !text;
  document.querySelector('#output-hint').textContent = text ? (kind === 'csv' ? 'CSV output is ready to copy or download.' : kind === 'api-text' ? 'API response is ready to copy or download.' : kind === 'text' || kind === 'diff' || kind === 'report' ? 'Report is ready to copy or download.' : kind === 'typescript' ? 'TypeScript definitions are ready to copy or download.' : 'Output is ready to copy or download.') : 'Ready when you are.';
  document.querySelector('#search-count').textContent = '0 matches';
  if (!text) renderTreeEmpty();
}

function setStatus(type, message, label) {
  statusBar.classList.remove('is-valid', 'is-invalid', 'is-error');
  if (type) statusBar.classList.add(`is-${type}`);
  statusText.textContent = message;
  validityText.textContent = label;
}

function parseInput() {
  if (!input.value.trim()) {
    setOutput('');
    setStatus('', 'Add some JSON to get started', 'AWAITING INPUT');
    return null;
  }
  try {
    const value = JSON.parse(input.value);
    setStatus('valid', 'Valid JSON — looking good', 'VALID JSON');
    document.querySelector('#input-hint').textContent = 'JSON syntax is valid.';
    return value;
  } catch (error) {
    setStatus('invalid', friendlyError(error.message), 'INVALID JSON');
    document.querySelector('#input-hint').textContent = 'Check the error below, then try again.';
    return null;
  }
}

function friendlyError(message) {
  const match = message.match(/position\s+(\d+)/i) || message.match(/(?:line|column)\s+(\d+)/i);
  const position = match ? Number(match[1]) : -1;
  if (/trailing comma/i.test(message)) return 'Unexpected trailing comma in JSON.';
  if (position >= 0) {
    const before = input.value.slice(0, position);
    const line = before.split('\n').length;
    const column = position - before.lastIndexOf('\n');
    return `Invalid JSON near line ${line}, column ${column}. ${message.replace(/\s+at position\s+\d+.*/i, '').trim()}`;
  }
  return `Invalid JSON. ${message}`;
}

function transform(mode) {
  setActiveTool(`${mode}-button`);
  if (!input.value.trim()) {
    setOutput('');
    setStatus('', 'Add some JSON to get started', 'AWAITING INPUT');
    input.focus();
    return;
  }
  let value;
  try {
    value = JSON.parse(input.value);
  } catch (error) {
    setOutput('');
    setStatus('invalid', friendlyError(error.message), 'INVALID JSON');
    document.querySelector('#input-hint').textContent = 'Check the error below, then try again.';
    return;
  }
  const spacing = mode === 'format' ? Number(document.querySelector('#indent-select').value) : 0;
  const result = JSON.stringify(value, null, spacing);
  setOutput(result);
  document.querySelector('#input-hint').textContent = 'JSON syntax is valid.';
  setStatus('valid', mode === 'format' ? 'JSON formatted successfully' : 'JSON minified successfully', 'VALID JSON');
}

function setActiveTool(id) {
  document.querySelectorAll('.action-button').forEach(button => {
    const active = button.id === id;
    button.classList.toggle('is-active', active);
    button.classList.toggle('primary', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const pathActive = id === 'extract-path-button';
  document.querySelector('.path-toolbar').classList.toggle('is-active', pathActive);
  document.querySelector('#extract-path-button').setAttribute('aria-pressed', String(pathActive));
  const schemaActive = id === 'schema-validate-button' || id === 'schema-generate-button';
  document.querySelector('.schema-panel').classList.toggle('is-active', schemaActive);
  document.querySelector('#schema-validate-button').setAttribute('aria-pressed', String(id === 'schema-validate-button'));
  document.querySelector('#schema-generate-button').setAttribute('aria-pressed', String(id === 'schema-generate-button'));
  document.querySelector('#schema-generate-button').classList.toggle('is-active', id === 'schema-generate-button');
  const compareActive = id === 'compare-button';
  document.querySelector('.compare-panel').classList.toggle('is-active', compareActive);
  document.querySelector('#compare-button').setAttribute('aria-pressed', String(compareActive));
  const apiActive = id === 'api-send-button';
  document.querySelector('.api-panel').classList.toggle('is-active', apiActive);
  document.querySelector('#api-send-button').setAttribute('aria-pressed', String(apiActive));
  const mockActive = id === 'mock-generate-button';
  document.querySelector('.mock-panel').classList.toggle('is-active', mockActive);
  document.querySelector('#mock-generate-button').setAttribute('aria-pressed', String(mockActive));
  const qualityActive = id === 'quality-scan-button' || id === 'deduplicate-button';
  document.querySelector('.quality-panel').classList.toggle('is-active', qualityActive);
  document.querySelector('#quality-scan-button').setAttribute('aria-pressed', String(id === 'quality-scan-button'));
  document.querySelector('#deduplicate-button').setAttribute('aria-pressed', String(id === 'deduplicate-button'));
  const validationMode = document.querySelector('#validation-format').value;
  const modeHint = id === 'repair-button' ? 'Repair common syntax mistakes without changing your original input.'
    : id === 'typescript-button' ? 'Generate TypeScript definitions from JSON.'
    : id === 'csv-json-button' || (id === 'validate-button' && validationMode === 'csv')
    ? 'Paste CSV with a header row; quote cells containing commas or line breaks.'
    : id === 'csv-button' ? 'Convert a JSON object or array of objects into CSV.'
      : id === 'jsonl-json-button' || (id === 'validate-button' && validationMode === 'jsonl') ? 'Paste one JSON value per line (JSON Lines / NDJSON).'
        : 'Ctrl + Enter runs the selected tool · data stays local.';
  input.placeholder = id === 'repair-button' ? 'Paste malformed JSON here to repair…'
    : id === 'typescript-button' ? 'Paste JSON to generate TypeScript types…'
    : id === 'csv-json-button' || (id === 'validate-button' && validationMode === 'csv') ? 'Paste CSV here — first row is the header…'
    : id === 'csv-button' ? 'Paste JSON to convert to CSV…'
      : id === 'jsonl-json-button' || (id === 'validate-button' && validationMode === 'jsonl') ? 'Paste JSON Lines here — one JSON value per line…' : 'Paste your JSON here…';
  document.querySelector('#input-hint').textContent = modeHint;
}

function switchToolSection(section) {
  if (section !== 'inspect') showOutputView('code');
  document.querySelectorAll('[data-tool-tab]').forEach(button => {
    const selected = button.dataset.toolTab === section;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  document.querySelector('#tool-toolbar').hidden = section === 'inspect' || section === 'data';
  document.querySelectorAll('[data-tool-section]').forEach(control => {
    control.hidden = control.dataset.toolSection !== section;
  });
  document.querySelectorAll('[data-tool-panel]').forEach(panel => {
    panel.hidden = panel.dataset.toolPanel !== section;
  });
  const divider = document.querySelector('.toolbar-divider');
  if (divider) divider.hidden = section !== 'format';
  const sectionAction = document.querySelector(`.action-button.is-active[data-tool-section="${section}"]`);
  const sectionUtilityActive = section === 'convert'
    ? document.querySelector('.api-panel').classList.contains('is-active')
    : section === 'validate'
      ? document.querySelector('.schema-panel').classList.contains('is-active') || document.querySelector('.mock-panel').classList.contains('is-active')
      : section === 'inspect'
        ? document.querySelector('.path-toolbar').classList.contains('is-active') || document.querySelector('.compare-panel').classList.contains('is-active') || document.querySelector('.quality-panel').classList.contains('is-active')
        : false;
  if (!sectionAction && !sectionUtilityActive) {
    const defaults = { format: 'format-button', convert: 'csv-button', validate: 'validate-button', inspect: 'extract-path-button', repair: 'repair-button' };
    setActiveTool(defaults[section]);
  }
  const placeholder = {
    format: 'Paste your JSON here…',
    convert: 'Choose a conversion or paste JSON, CSV, or JSON Lines…',
    validate: `Paste ${document.querySelector('#validation-format').selectedOptions[0].text} here to validate…`,
    inspect: 'Paste JSON to explore a path or compare documents…',
    repair: 'Paste malformed JSON to repair common syntax errors.',
    data: 'Paste JSON data for the selected data tool…'
  }[section];
  input.placeholder = placeholder;
  const hint = {
    format: 'Format, minify, or sort JSON. Ctrl + Enter runs the selected tool.',
    convert: 'Convert between JSON, CSV, and JSON Lines, or inspect a live API response.',
    validate: 'Choose JSON, CSV, or JSON Lines. JSON Schema and mock data tools are here.',
    inspect: 'Use JSONPath, compare documents, or scan data quality.',
    data: 'Choose a tool above. Add a second document when requested, then run the tool.'
  }[section];
  document.querySelector('#input-hint').textContent = hint;
}


function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort((a, b) => a.localeCompare(b)).map(key => [key, sortDeep(value[key])]));
  }
  return value;
}

function renderTreeEmpty() {
  document.querySelector('#json-tree').innerHTML = '<div class="tree-empty">Format or minify JSON to explore its structure.</div>';
}

function renderTree(value) {
  const tree = document.querySelector('#json-tree');
  tree.replaceChildren();
  const root = document.createElement('div');
  appendTreeNode(root, '$', value, '$', true);
  tree.append(root);
}

function appendTreeNode(parent, key, value, path, isRoot = false) {
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === 'object';
  const entries = isArray ? value.map((item, index) => [String(index), item]) : isObject ? Object.entries(value) : [];
  const row = document.createElement('div');
  row.className = 'tree-row';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'tree-toggle';
  toggle.textContent = isObject && entries.length ? '▾' : '·';
  toggle.setAttribute('aria-label', `${entries.length ? 'Collapse' : 'Empty'} ${key}`);
  row.append(toggle);
  if (!isRoot) {
    const label = document.createElement('span');
    label.className = isArray ? 'tree-index' : 'tree-key';
    label.textContent = isArray ? `[${key}]` : `${JSON.stringify(key)}:`;
    row.append(label);
  } else {
    const label = document.createElement('span');
    label.className = 'tree-key';
    label.textContent = '$';
    row.append(label);
  }
  const valueLabel = document.createElement('span');
  if (isObject) {
    valueLabel.className = 'tree-type';
    valueLabel.textContent = isArray ? `Array(${entries.length})` : `Object(${entries.length})`;
  } else {
    valueLabel.className = `tree-value ${value === null ? 'null' : typeof value}`;
    valueLabel.textContent = typeof value === 'string' ? JSON.stringify(value) : String(value);
  }
  row.append(valueLabel);
  const copyPath = document.createElement('button');
  copyPath.type = 'button';
  copyPath.className = 'tree-copy';
  copyPath.textContent = 'Copy path';
  copyPath.title = `Copy ${path}`;
  copyPath.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(path); showToast(`Copied path ${path}`); }
    catch { showToast(`Path: ${path}`, true); }
  });
  row.append(copyPath);
  parent.append(row);
  if (!isObject || !entries.length) return;
  const children = document.createElement('div');
  children.className = 'tree-node';
  for (const [childKey, childValue] of entries) {
    const childPath = isArray ? `${path}[${childKey}]` : `${path}[${JSON.stringify(childKey)}]`;
    appendTreeNode(children, childKey, childValue, childPath);
  }
  toggle.addEventListener('click', () => {
    children.hidden = !children.hidden;
    toggle.textContent = children.hidden ? '▸' : '▾';
    toggle.setAttribute('aria-label', `${children.hidden ? 'Expand' : 'Collapse'} ${key}`);
  });
  parent.append(children);
}

function showOutputView(view) {
  const code = view === 'code';
  output.hidden = !code;
  outputLines.hidden = !code;
  document.querySelector('#json-tree').hidden = code;
  document.querySelector('#code-view-button').classList.toggle('selected', code);
  document.querySelector('#tree-view-button').classList.toggle('selected', !code);
  document.querySelector('#code-view-button').setAttribute('aria-selected', String(code));
  document.querySelector('#tree-view-button').setAttribute('aria-selected', String(!code));
}

function findInOutput(direction = 1) {
  const query = document.querySelector('#output-search').value;
  const text = output.textContent;
  const matches = [];
  if (query && text && !output.hidden && !output.classList.contains('empty')) {
    const lowerText = text.toLocaleLowerCase();
    const lowerQuery = query.toLocaleLowerCase();
    let from = 0;
    while ((from = lowerText.indexOf(lowerQuery, from)) !== -1) {
      matches.push(from);
      from += Math.max(1, lowerQuery.length);
    }
  }
  document.querySelector('#search-count').textContent = `${matches.length} ${matches.length === 1 ? 'match' : 'matches'}`;
  if (!matches.length) return;
  let index = activeSearchIndex + direction;
  if (index < 0) index = matches.length - 1;
  if (index >= matches.length) index = 0;
  activeSearchIndex = index;
  const start = matches[index];
  const walker = document.createTreeWalker(output, NodeFilter.SHOW_TEXT);
  const selection = window.getSelection();
  let node; let offset = start;
  while ((node = walker.nextNode())) {
    if (offset <= node.textContent.length) {
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, Math.min(node.textContent.length, offset + query.length));
      selection.removeAllRanges();
      selection.addRange(range);
      output.scrollTop = Math.max(0, range.getBoundingClientRect().top - output.getBoundingClientRect().top + output.scrollTop - 80);
      break;
    }
    offset -= node.textContent.length;
  }
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle('error-toast', isError);
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

