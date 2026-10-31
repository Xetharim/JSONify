// UI event handlers for editor actions, files, output, keyboard, and theme.
let changeTracking = false;
let trackedValue = null;
let hasTrackedValue = false;
let changeHistory = [];
document.querySelector('#format-button').addEventListener('click', () => transform('format'));
document.querySelector('#minify-button').addEventListener('click', () => transform('minify'));
document.querySelectorAll('[data-tool-tab]').forEach(button => button.addEventListener('click', () => switchToolSection(button.dataset.toolTab)));
document.querySelector('#repair-button').addEventListener('click', () => {
  setActiveTool('repair-button');
  const report = document.querySelector('#repair-list');
  report.replaceChildren();
  try {
    const result = repairJSON(input.value);
    setOutput(result.json);
    document.querySelector('#repair-count').textContent = result.repairs.length
      ? `${result.repairs.length} repair${result.repairs.length === 1 ? '' : 's'} applied`
      : 'No repairs needed';
    if (result.repairs.length) result.repairs.forEach(repair => {
      const item = document.createElement('li'); item.textContent = repair; report.append(item);
    });
    else { const item = document.createElement('li'); item.textContent = 'Input was valid. It has been formatted for readability.'; report.append(item); }
    setStatus('valid', result.repairs.length ? `Repaired JSON · ${result.repairs.length} issue${result.repairs.length === 1 ? '' : 's'} fixed` : 'No common JSON mistakes found', result.repairs.length ? 'REPAIRED' : 'VALID JSON');
  } catch (error) {
    setOutput('');
    document.querySelector('#repair-count').textContent = 'Could not repair this input';
    const item = document.createElement('li'); item.textContent = error.message; report.append(item);
    setStatus('invalid', error.message, 'REPAIR FAILED');
  }
});
document.querySelector('#sort-button').addEventListener('click', () => {
  setActiveTool('sort-button');
  if (!input.value.trim()) { showToast('Add JSON before sorting keys.', true); input.focus(); return; }
  try {
    input.value = JSON.stringify(sortDeep(JSON.parse(input.value)), null, Number(document.querySelector('#indent-select').value));
    updateStats();
    transform('format');
    setActiveTool('sort-button');
    showToast('Object keys sorted alphabetically.');
  } catch (error) {
    setOutput('');
    setStatus('invalid', friendlyError(error.message), 'INVALID JSON');
  }
});
document.querySelector('#validate-button').addEventListener('click', () => {
  setActiveTool('validate-button');
  const mode = document.querySelector('#validation-format').value;
  try {
    if (mode === 'csv') {
      const rows = parseCSV(input.value);
      const columns = Object.keys(rows[0] || {}).length;
      setStatus('valid', `Valid CSV · ${rows.length} data rows and ${columns} columns`, 'VALID CSV');
      document.querySelector('#input-hint').textContent = 'CSV structure and column counts are valid.';
      showToast('Your CSV is valid.');
    } else if (mode === 'jsonl') {
      const rows = parseJSONLines(input.value);
      setStatus('valid', `Valid JSON Lines · ${rows.length} records`, 'VALID JSONL');
      document.querySelector('#input-hint').textContent = 'Every non-empty line contains valid JSON.';
      showToast('Your JSON Lines are valid.');
    } else {
      const value = parseInput();
      if (value !== null || input.value.trim() === 'null') showToast('Your JSON is valid.');
      else if (input.value.trim()) showToast('There’s a syntax error to fix.', true);
    }
  } catch (error) {
    setStatus('invalid', error.message, mode === 'csv' ? 'INVALID CSV' : 'INVALID JSONL');
    document.querySelector('#input-hint').textContent = 'Check the validation message, then try again.';
    showToast(error.message, true);
  }
});
document.querySelector('#validation-format').addEventListener('change', () => {
  if (document.querySelector('#validate-button').classList.contains('is-active')) setActiveTool('validate-button');
  if (document.querySelector('[data-tool-tab="validate"]').classList.contains('selected')) switchToolSection('validate');
});
document.querySelector('#csv-button').addEventListener('click', () => {
  setActiveTool('csv-button');
  if (!input.value.trim()) { input.value = sampleJSON; updateStats(); }
  try {
    const csv = convertToCSV(JSON.parse(input.value));
    setOutput(csv, 'csv');
    setStatus('valid', 'Converted JSON array to CSV', 'CSV OUTPUT');
  } catch (error) {
    setOutput('');
    const invalidJson = error instanceof SyntaxError;
    setStatus(invalidJson ? 'invalid' : 'error', invalidJson ? friendlyError(error.message) : error.message, invalidJson ? 'INVALID JSON' : 'CONVERSION ERROR');
  }
});
document.querySelector('#csv-json-button').addEventListener('click', () => {
  setActiveTool('csv-json-button');
  if (!input.value.trim()) { input.value = sampleCSV(); updateStats(); }
  try {
    const data = parseCSV(input.value);
    const result = JSON.stringify(data, null, Number(document.querySelector('#indent-select').value));
    setOutput(result);
    setStatus('valid', `Converted ${data.length} CSV row${data.length === 1 ? '' : 's'} to JSON`, 'VALID JSON');
    document.querySelector('#input-hint').textContent = 'CSV parsed successfully.';
  } catch (error) {
    setOutput('');
    setStatus('error', error.message, 'CSV ERROR');
  }
});
document.querySelector('#jsonl-json-button').addEventListener('click', () => {
  setActiveTool('jsonl-json-button');
  if (!input.value.trim()) { input.value = '{"event":"login","ok":true}\n{"event":"logout","ok":true}'; updateStats(); }
  try {
    const rows = parseJSONLines(input.value);
    setOutput(JSON.stringify(rows, null, Number(document.querySelector('#indent-select').value)));
    setStatus('valid', `Converted ${rows.length} JSON Lines to an array`, 'VALID JSON');
  } catch (error) {
    setOutput('');
    setStatus('invalid', error.message, 'INVALID JSONL');
  }
});

document.querySelector('#typescript-button').addEventListener('click', () => {
  setActiveTool('typescript-button');
  if (!input.value.trim()) { input.value = sampleJSON; updateStats(); }
  try {
    const value = JSON.parse(input.value);
    setOutput(toTypeScript(value), 'typescript');
    setStatus('valid', 'Generated TypeScript definitions', 'TYPESCRIPT READY');
  } catch (error) {
    setOutput('');
    setStatus('invalid', friendlyError(error.message), 'INVALID JSON');
  }
});
document.querySelector('#extract-path-button').addEventListener('click', () => {
  setActiveTool('extract-path-button');
  try {
    const value = JSON.parse(input.value);
    const matches = queryJSONPath(value, document.querySelector('#json-path').value);
    const selected = matches.length === 1 ? matches[0].value : matches.map(item => ({ path: item.path, value: item.value }));
    setOutput(JSON.stringify(selected, null, Number(document.querySelector('#indent-select').value)));
    setStatus('valid', 'JSONPath value extracted', 'PATH RESULT');
  } catch (error) {
    setOutput('');
    const invalidJson = error instanceof SyntaxError;
    setStatus(invalidJson ? 'invalid' : 'error', invalidJson ? friendlyError(error.message) : error.message, invalidJson ? 'INVALID JSON' : 'PATH ERROR');
  }
});
document.querySelector('#json-path').addEventListener('keydown', event => {
  if (event.key === 'Enter') document.querySelector('#extract-path-button').click();
});
function addDesignerRow(property = '', rule = {}, required = false) {
  const row = document.createElement('div'); row.className = 'designer-property-row';
  const name = document.createElement('input'); name.placeholder = 'Property name'; name.value = property; name.setAttribute('aria-label', 'Property name'); row.append(name);
  const type = document.createElement('select'); type.setAttribute('aria-label', 'Property type');
  for (const option of ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']) type.add(new Option(option, option));
  type.value = Array.isArray(rule.type) ? rule.type[0] : rule.type || 'string'; row.append(type);
  const description = document.createElement('input'); description.placeholder = 'Description'; description.value = rule.description || ''; description.setAttribute('aria-label', 'Property description'); row.append(description);
  const requiredLabel = document.createElement('label'); const requiredInput = document.createElement('input'); requiredInput.type = 'checkbox'; requiredInput.checked = required; requiredLabel.append(requiredInput, document.createTextNode('Required')); row.append(requiredLabel);
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.addEventListener('click', () => row.remove()); row.append(remove);
  document.querySelector('#designer-rows').append(row);
}
function loadDesignerRows() {
  const container = document.querySelector('#designer-rows'); container.replaceChildren();
  try { const schema = JSON.parse(document.querySelector('#json-schema').value || '{"type":"object","properties":{}}'); const required = new Set(schema.required || []); for (const [name, rule] of Object.entries(schema.properties || {})) addDesignerRow(name, rule, required.has(name)); }
  catch (error) { showToast(`Could not load schema fields: ${error.message}`, true); }
}
document.querySelector('.schema-designer').addEventListener('toggle', event => { if (event.target.open) loadDesignerRows(); });
document.querySelector('#designer-add').addEventListener('click', () => addDesignerRow());
document.querySelector('#designer-apply').addEventListener('click', () => {
  try {
    const original = JSON.parse(document.querySelector('#json-schema').value || '{"type":"object","properties":{}}'); const properties = {}; const required = [];
    for (const row of document.querySelectorAll('.designer-property-row')) {
      const [name, type, description] = row.querySelectorAll('input,select'); const key = name.value.trim(); if (!key) throw new Error('Every field needs a property name.'); if (Object.hasOwn(properties, key)) throw new Error(`Property “${key}” is repeated.`);
      properties[key] = { ...(original.properties?.[key] || {}), type: type.value, ...(description.value.trim() ? { description: description.value.trim() } : {}) };
      if (row.querySelector('input[type="checkbox"]').checked) required.push(key);
    }
    original.type = 'object'; original.properties = properties; original.required = required; document.querySelector('#json-schema').value = JSON.stringify(original, null, 2); showToast('Visual schema applied to the editor.');
  } catch (error) { showToast(error.message, true); }
});
document.querySelector('#schema-example-button').addEventListener('click', () => {
  document.querySelector('#json-schema').value = JSON.stringify({
    type: 'object', required: ['email'], additionalProperties: false,
    properties: {
      email: { type: 'string', pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
      age: { type: 'integer', minimum: 13, maximum: 130 }
    }
  }, null, 2);
  document.querySelector('.schema-panel').open = true;
  document.querySelector('#json-schema').focus();
});
document.querySelector('#schema-generate-button').addEventListener('click', () => {
  setActiveTool('schema-generate-button');
  try {
    const value = JSON.parse(input.value);
    const schemaText = JSON.stringify(generateSchema(value), null, 2);
    document.querySelector('#json-schema').value = schemaText;
    document.querySelector('.schema-panel').open = true;
    setOutput(schemaText);
    setStatus('valid', 'Generated a JSON Schema from the input', 'SCHEMA GENERATED');
    document.querySelector('#input-hint').textContent = 'Schema added above and placed in the output for copying.';
  } catch (error) {
    setOutput('');
    setStatus('invalid', friendlyError(error.message), 'INVALID JSON');
  }
});
document.querySelector('#schema-validate-button').addEventListener('click', () => {
  setActiveTool('schema-validate-button');
  let value;
  try {
    value = JSON.parse(input.value);
  } catch (error) {
    setStatus('invalid', friendlyError(error.message), 'INVALID JSON');
    return;
  }
  let schema;
  try {
    const schemaText = document.querySelector('#json-schema').value.trim();
    if (!schemaText) throw new Error('Add a JSON Schema or use the example first.');
    schema = JSON.parse(schemaText);
  } catch (error) {
    setStatus('error', error instanceof SyntaxError ? 'Schema is not valid JSON.' : error.message, 'SCHEMA ERROR');
    return;
  }
  try {
    const draft = document.querySelector('#schema-draft').value;
    const report = validateSchemaDetailed(value, schema, draft);
    setOutput(JSON.stringify(report, null, 2));
    if (!report.valid) {
      const preview = report.errors.slice(0, 3).map(error => `${error.path}: ${error.message}`).join('  ');
      const remaining = report.errors.length > 3 ? `  +${report.errors.length - 3} more` : '';
      setStatus('invalid', `${preview}${remaining}`, `${report.errors.length} SCHEMA ${report.errors.length === 1 ? 'ERROR' : 'ERRORS'}`);
      document.querySelector('#input-hint').textContent = `${report.errors.length} schema rule${report.errors.length === 1 ? '' : 's'} need attention. The full report is in Output.`;
    } else {
      setStatus('valid', 'JSON matches the schema', 'SCHEMA VALID');
      document.querySelector('#input-hint').textContent = 'JSON syntax and schema are valid.';
    }
  } catch (error) {
    setStatus('error', error.message, 'SCHEMA ERROR');
  }
});
document.querySelector('#mock-generate-button').addEventListener('click', () => {
  setActiveTool('mock-generate-button');
  const templateText = document.querySelector('#mock-template').value.trim();
  let schema;
  try {
    if (templateText) schema = generateSchema(JSON.parse(templateText));
    else {
      const schemaText = document.querySelector('#json-schema').value.trim();
      if (!schemaText) throw new Error('Add a JSON Schema above or provide a sample template.');
      schema = JSON.parse(schemaText);
    }
    const count = Number(document.querySelector('#mock-count').value);
    const records = schema.type === 'array'
      ? generateMockValue({ ...schema, minItems: count, maxItems: count }, schema)
      : Array.from({ length: count }, () => generateMockValue(schema, schema));
    const result = JSON.stringify(records, null, Number(document.querySelector('#indent-select').value));
    setOutput(result);
    setStatus('valid', `Generated ${count} mock record${count === 1 ? '' : 's'}`, 'MOCK DATA READY');
  } catch (error) {
    setOutput('');
    const invalidJson = error instanceof SyntaxError;
    setStatus(invalidJson ? 'invalid' : 'error', invalidJson ? 'Schema or template is not valid JSON.' : error.message, invalidJson ? 'INVALID JSON' : 'GENERATION ERROR');
  }
});
document.querySelector('#compare-button').addEventListener('click', () => {
  setActiveTool('compare-button');
  document.querySelector('#diff-results').hidden = true;
  try {
    const left = JSON.parse(input.value);
    const right = JSON.parse(document.querySelector('#compare-json').value);
    const ignored = document.querySelector('#compare-ignore').value.split(',').map(item => item.trim()).filter(Boolean);
    const changes = diffDocuments(left, right, '$', [], ignored);
    renderDiffResults(changes);
    const report = changes.length ? `${changes.length} difference${changes.length === 1 ? '' : 's'} found\n\n${changes.map(change => `${change.kind.toUpperCase()} ${change.path}\n  before: ${JSON.stringify(change.before)}\n  after:  ${JSON.stringify(change.after)}`).join('\n\n')}` : 'No differences found. The JSON documents are equivalent.';
    setOutput(report, 'diff');
    setStatus('valid', changes.length ? `Found ${changes.length} JSON difference${changes.length === 1 ? '' : 's'}` : 'JSON documents are equivalent', changes.length ? 'DIFFERENCES' : 'NO DIFFERENCES');
  } catch (error) {
    setOutput('');
    setStatus('invalid', 'Both documents must contain valid JSON.', 'INVALID JSON');
  }
});
document.querySelector('#quality-scan-button').addEventListener('click', () => {
  setActiveTool('quality-scan-button');
  try {
    const value = JSON.parse(input.value);
    const profile = analyzeDataQuality(value);
    renderQualityResults(profile);
    const rootArray = Array.isArray(value) ? profile.arrays[0] : null;
    document.querySelector('#deduplicate-button').disabled = !rootArray || !rootArray.duplicateGroups.length;
    const duplicateCount = profile.arrays.reduce((sum, item) => sum + item.duplicateGroups.reduce((subtotal, group) => subtotal + group.length - 1, 0), 0);
    const issueCount = profile.arrays.reduce((sum, item) => sum + item.fields.filter(field => field.missing || field.types.length > 1).length, 0);
    const summary = `${profile.arrays.length} arrays · ${duplicateCount} duplicate entries · ${issueCount} field issues · depth ${profile.maxDepth}`;
    document.querySelector('#quality-summary').textContent = summary;
    const report = { profile, duplicateEntries: duplicateCount, inconsistentOrMissingFields: issueCount };
    setOutput(JSON.stringify(report, null, 2));
    setStatus(duplicateCount || issueCount ? 'error' : 'valid', summary, duplicateCount || issueCount ? 'QUALITY ISSUES' : 'QUALITY CHECKED');
  } catch (error) {
    document.querySelector('#quality-results').hidden = true;
    document.querySelector('#deduplicate-button').disabled = true;
    setOutput('');
    setStatus('invalid', friendlyError(error.message), 'INVALID JSON');
  }
});
document.querySelector('#deduplicate-button').addEventListener('click', () => {
  setActiveTool('deduplicate-button');
  try {
    const value = JSON.parse(input.value);
    if (!Array.isArray(value)) throw new Error('Duplicate removal is available for a root JSON array.');
    const seen = new Set();
    const unique = value.filter(item => {
      const key = JSON.stringify(canonicalJSON(item));
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    const removed = value.length - unique.length;
    setOutput(JSON.stringify(unique, null, Number(document.querySelector('#indent-select').value)));
    setStatus('valid', `Removed ${removed} duplicate item${removed === 1 ? '' : 's'}; original input is unchanged`, 'DEDUPLICATED');
  } catch (error) { setStatus('error', error.message, 'DEDUPLICATION FAILED'); }
});
document.querySelector('#clear-button').addEventListener('click', () => {
  input.value = '';
  setOutput('');
  updateStats();
  document.querySelector('#input-hint').textContent = 'Your data never leaves this browser.';
  setStatus('', 'Ready to work with your JSON', 'AWAITING INPUT');
  input.focus();
});
document.querySelector('#sample-button').addEventListener('click', () => {
  input.value = sampleJSON;
  updateStats();
  transform('format');
});
document.querySelector('#code-view-button').addEventListener('click', () => showOutputView('code'));
document.querySelector('#tree-view-button').addEventListener('click', () => {
  if (outputKind !== 'json') { showToast('Tree view is available for JSON output.', true); return; }
  if (!output.textContent || output.classList.contains('empty')) { showToast('Format JSON first to explore its structure.', true); return; }
  try { renderTree(JSON.parse(output.textContent)); showOutputView('tree'); }
  catch { showToast('Create valid JSON output before opening the tree.', true); }
});
document.querySelector('#open-file-button').addEventListener('click', () => document.querySelector('#file-input').click());
document.querySelector('#file-input').addEventListener('change', async event => {
  const files = [...event.target.files];
  if (!files.length) return;
  try {
    if (files.length > 1) {
      const results = await Promise.all(files.map(async file => {
        try {
          const text = await file.text(); const ext = file.name.split('.').pop().toLowerCase();
          const value = ['jsonl', 'ndjson'].includes(ext) ? parseJSONLines(text) : ext === 'csv' ? parseCSV(text) : ext === 'tsv' ? parseCSV(text, '\t') : ext === 'yaml' || ext === 'yml' ? parseSimpleYAML(text) : ext === 'xml' ? parseXMLToJSON(text) : JSON.parse(text);
          return { file: file.name, valid: true, records: Array.isArray(value) ? value.length : 1, data: value };
        } catch (error) { return { file: file.name, valid: false, error: error.message }; }
      }));
      setOutput(JSON.stringify(results, null, 2));
      const failed = results.filter(result => !result.valid).length;
      setStatus(failed ? 'invalid' : 'valid', `Processed ${results.length} files · ${failed} failed`, failed ? 'BATCH ISSUES' : 'BATCH COMPLETE');
      showToast(`Processed ${results.length} files.`);
      event.target.value = '';
      return;
    }
    const file = files[0];
    input.value = await file.text();
    updateStats();
    const extension = file.name.split('.').pop().toLowerCase();
    const target = extension === 'csv' ? '#csv-json-button'
      : ['jsonl', 'ndjson'].includes(extension) ? '#jsonl-json-button'
        : extension === 'tsv' ? null
          : ['xml', 'yaml', 'yml'].includes(extension) ? null
        : extension === 'json' ? '#csv-button'
          : input.value.trimStart().startsWith('{') || input.value.trimStart().startsWith('[') ? '#csv-button' : '#csv-json-button';
    if (extension === 'tsv') { setOutput(JSON.stringify(parseCSV(input.value, '\t'), null, 2)); setStatus('valid', 'Imported TSV data as JSON.', 'TSV IMPORT'); }
    else if (['xml', 'yaml', 'yml'].includes(extension)) { switchToolSection('data'); document.querySelector('#data-tool-select').value = extension === 'xml' ? 'xml-json' : 'yaml-json'; document.querySelector('#data-tool-select').dispatchEvent(new Event('change')); document.querySelector('#run-data-tool').click(); }
    else document.querySelector(target).click();
    showToast(`Loaded ${file.name}`);
  } catch { showToast('Could not read that file.', true); }
  event.target.value = '';
});
document.querySelector('#search-next').addEventListener('click', () => findInOutput(1));
document.querySelector('#search-prev').addEventListener('click', () => findInOutput(-1));
document.querySelector('#output-search').addEventListener('input', () => { activeSearchIndex = -1; findInOutput(1); });
document.querySelector('#copy-button').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(output.textContent);
    showToast('Output copied to clipboard.');
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(output);
    selection.removeAllRanges();
    selection.addRange(range);
    showToast('Clipboard access unavailable. Select and copy the output.', true);
  }
});
document.querySelector('#download-button').addEventListener('click', () => {
  const isCSV = outputKind === 'csv';
  const isText = ['text', 'diff', 'report', 'api-text'].includes(outputKind);
  const isTypeScript = outputKind === 'typescript';
  const blob = new Blob([output.textContent], { type: isCSV ? 'text/csv;charset=utf-8' : isText || isTypeScript ? 'text/plain;charset=utf-8' : 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = isCSV ? 'formatted.csv' : isTypeScript ? 'types.ts' : outputKind === 'diff' ? 'json-diff.txt' : outputKind === 'report' ? 'validation-report.json' : outputKind === 'api-text' ? 'api-response.txt' : isText ? 'report.txt' : 'formatted.json';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('JSON file downloaded.');
});
document.querySelector('#theme-toggle').addEventListener('click', event => {
  const dark = document.body.classList.toggle('theme-dark');
  event.currentTarget.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  try { localStorage.setItem('jsonify-theme', dark ? 'dark' : 'light'); } catch { /* Theme still works for this visit. */ }
});

function renderChangeHistory() {
  const container = document.querySelector('#change-log'); container.replaceChildren();
  if (!changeHistory.length) { const note = document.createElement('p'); note.textContent = changeTracking ? 'Tracking changes. Edit valid JSON to see changed paths.' : 'No changes recorded.'; container.append(note); return; }
  for (const entry of changeHistory.slice(0, 20)) {
    const row = document.createElement('section'); row.className = 'change-event'; const heading = document.createElement('strong'); heading.textContent = `${new Date(entry.at).toLocaleTimeString()} · ${entry.changes.length} change(s)`; row.append(heading);
    const list = document.createElement('ul'); for (const change of entry.changes.slice(0, 30)) { const item = document.createElement('li'); item.textContent = `${change.kind.toUpperCase()} ${change.path}`; list.append(item); } row.append(list); container.append(row);
  }
}
function recordDocumentChange() {
  if (!changeTracking || !input.value.trim()) return;
  try {
    const next = JSON.parse(input.value);
    if (hasTrackedValue) { const changes = diffDocuments(trackedValue, next); if (changes.length) { changeHistory.unshift({ at: Date.now(), changes }); changeHistory = changeHistory.slice(0, 100); document.querySelector('#change-track-status').textContent = `${changeHistory.reduce((sum, entry) => sum + entry.changes.length, 0)} change(s) captured`; renderChangeHistory(); } }
    trackedValue = next;
    hasTrackedValue = true;
  } catch { /* Ignore incomplete JSON while the user is typing. */ }
}
document.querySelector('#change-track-button').addEventListener('click', event => {
  if (changeTracking) { changeTracking = false; trackedValue = null; hasTrackedValue = false; event.currentTarget.textContent = 'Start tracking changes'; document.querySelector('#change-track-status').textContent = 'Paused'; }
  else { try { if (!input.value.trim()) throw new Error('Add valid JSON before starting change tracking.'); trackedValue = JSON.parse(input.value); hasTrackedValue = true; changeTracking = true; event.currentTarget.textContent = 'Stop tracking'; document.querySelector('#change-track-status').textContent = 'Tracking edits in this session'; }
    catch (error) { showToast(error.message, true); } }
  renderChangeHistory();
});

input.addEventListener('input', () => {
  updateStats();
  setOutput('');
  document.querySelector('#input-hint').textContent = 'Your data never leaves this browser.';
  if (input.value.trim()) parseInput();
  else {
    setOutput('');
    setStatus('', 'Ready to work with your JSON', 'AWAITING INPUT');
  }
  if (document.querySelector('#watch-path').checked && input.value.trim()) {
    try { const matches = queryJSONPath(JSON.parse(input.value), document.querySelector('#json-path').value); const result = matches.length === 1 ? matches[0].value : matches.map(item => ({ path: item.path, value: item.value })); setOutput(JSON.stringify(result, null, Number(document.querySelector('#indent-select').value))); setStatus('valid', `Watched JSONPath found ${matches.length} match(es)`, 'PATH WATCH'); }
    catch { /* Keep the live editor syntax status while a path is temporarily unavailable. */ }
  }
  recordDocumentChange();
});
document.querySelector('#watch-path').addEventListener('change', event => { if (event.target.checked && input.value.trim()) input.dispatchEvent(new Event('input')); });
document.querySelector('#json-path').addEventListener('input', () => { if (document.querySelector('#watch-path').checked) input.dispatchEvent(new Event('input')); });
input.addEventListener('scroll', () => { inputLines.scrollTop = input.scrollTop; });
output.addEventListener('scroll', () => { outputLines.scrollTop = output.scrollTop; });
input.addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const spaces = ' '.repeat(Number(document.querySelector('#indent-select').value));
    input.setRangeText(spaces, start, end, 'end');
    updateStats();
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    if (document.querySelector('[data-tool-tab="data"].selected')) { document.querySelector('#run-data-tool').click(); return; }
    const active = document.querySelector('.action-button.is-active') || document.querySelector('.path-toolbar.is-active #extract-path-button') || document.querySelector('.schema-panel.is-active #schema-generate-button.is-active, .schema-panel.is-active #schema-validate-button[aria-pressed="true"]') || document.querySelector('.compare-panel.is-active #compare-button') || document.querySelector('.api-panel.is-active #api-send-button') || document.querySelector('.mock-panel.is-active #mock-generate-button') || document.querySelector('.quality-panel.is-active #quality-scan-button[aria-pressed="true"], .quality-panel.is-active #deduplicate-button[aria-pressed="true"]');
    if (active) active.click();
    else transform('format');
  }
});

const inputCard = document.querySelector('.editor-card');
inputCard.addEventListener('dragover', event => { event.preventDefault(); inputCard.classList.add('drag-over'); });
inputCard.addEventListener('dragleave', event => { if (!inputCard.contains(event.relatedTarget)) inputCard.classList.remove('drag-over'); });
inputCard.addEventListener('drop', async event => {
  event.preventDefault();
  inputCard.classList.remove('drag-over');
  const file = event.dataTransfer.files[0];
  if (!file) { input.value = event.dataTransfer.getData('text'); updateStats(); parseInput(); return; }
  try { input.value = await file.text(); updateStats(); transform('format'); showToast(`Loaded ${file.name}`); }
  catch { showToast('Could not read that file.', true); }
});

try {
  if (localStorage.getItem('jsonify-theme') === 'dark') {
    document.body.classList.add('theme-dark');
    document.querySelector('#theme-toggle').setAttribute('aria-label', 'Switch to light theme');
  }
} catch { /* Theme preference storage is optional. */ }
updateStats();
switchToolSection('format');
