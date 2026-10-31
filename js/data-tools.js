// Data workspace utilities, local presets, snapshots, and workspace export.
function runDataUtility(kind, value, secondText, optionText) {
  const needsSecond = ['array', 'patch', 'migration', 'search'].includes(kind);
  const second = needsSecond && secondText.trim() ? JSON.parse(secondText) : null;
  const option = optionText.trim();
  const records = Array.isArray(value) ? value : [value];
  const scalar = item => item === null || typeof item !== 'object' ? String(item) : JSON.stringify(item);
  if (kind === 'table') {
    const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? Object.entries(value).map(([key, val]) => ({ key, value: val })) : [{ value }];
    const columns = [...new Set(rows.flatMap(row => row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : ['value']))];
    return { text: [columns.join('\t'), ...rows.map(row => columns.map(key => scalar(row && typeof row === 'object' && !Array.isArray(row) ? row[key] ?? '' : row)).join('\t'))].join('\n'), kind: 'text', message: `Table view · ${rows.length} rows, ${columns.length} columns` };
  }
  if (kind === 'relations') {
    const occurrences = new Map();
    const scan = (node, path = '$') => {
      if (!node || typeof node !== 'object') return;
      for (const [key, child] of Object.entries(node)) {
        if (/(?:^id$|Id$|_id$|Ref$|_ref$)/i.test(key) && ['string', 'number'].includes(typeof child)) {
          const id = `${key}:${child}`; if (!occurrences.has(id)) occurrences.set(id, []); occurrences.get(id).push(path + '.' + key);
        }
        scan(child, Array.isArray(node) ? `${path}[${key}]` : `${path}.${key}`);
      }
    };
    scan(value);
    return { text: JSON.stringify([...occurrences].filter(([, paths]) => paths.length > 1).map(([id, paths]) => ({ shared: id, paths })), null, 2), kind: 'json', message: 'Relationship scan complete' };
  }
  if (kind === 'dedupe') {
    const seen = new Set(); const result = records.filter(item => { const key = JSON.stringify(canonicalJSON(item)); if (seen.has(key)) return false; seen.add(key); return true; });
    return { text: JSON.stringify(Array.isArray(value) ? result : result[0], null, 2), kind: 'json', message: `Removed ${records.length - result.length} duplicate value(s)` };
  }
  if (kind === 'sample') {
    const count = Math.max(1, Math.min(10000, Number(option) || 10));
    const pool = [...records]; for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const sample = pool.slice(0, count); return { text: JSON.stringify(Array.isArray(value) ? sample : sample[0], null, 2), kind: 'json', message: `Sampled ${sample.length} of ${records.length} records` };
  }
  if (kind === 'sort-records') {
    if (!Array.isArray(value)) throw new Error('Record sorting needs a root array.');
    const rules = option.split(',').map(part => { const [field, direction = 'asc'] = part.split(':').map(text => text.trim()); if (!field) throw new Error('Enter one or more fields, for example age:desc,name:asc.'); return { field, direction: direction.toLowerCase() === 'desc' ? -1 : 1 }; });
    const read = (row, field) => field.split('.').reduce((current, key) => current?.[key], row);
    const sorted = value.map((item, index) => ({ item, index })).sort((a, b) => { for (const rule of rules) { const left = read(a.item, rule.field); const right = read(b.item, rule.field); if (Object.is(left, right)) continue; if (left == null) return -1 * rule.direction; if (right == null) return 1 * rule.direction; const order = typeof left === 'number' && typeof right === 'number' ? left - right : typeof left === 'boolean' && typeof right === 'boolean' ? Number(left) - Number(right) : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' }); if (order) return order * rule.direction; } return a.index - b.index; }).map(row => row.item);
    return { text: JSON.stringify(sorted, null, 2), kind: 'json', message: `Sorted ${sorted.length} records by ${rules.length} key(s)` };
  }
  if (kind === 'coerce') {
    const rules = option.split(',').map(part => { const split = part.lastIndexOf(':'); if (split < 1) throw new Error('Use field:type pairs, such as age:number,active:boolean.'); return [part.slice(0, split).trim(), part.slice(split + 1).trim().toLowerCase()]; });
    const coerce = (node, parts, type) => {
      if (Array.isArray(node)) return node.map(item => coerce(item, parts, type)); if (!node || typeof node !== 'object') return node;
      if (parts.length > 1) { if (Object.hasOwn(node, parts[0])) node[parts[0]] = coerce(node[parts[0]], parts.slice(1), type); return node; }
      if (!Object.hasOwn(node, parts[0]) || node[parts[0]] == null) return node;
      const value = node[parts[0]]; let converted;
      if (type === 'string') converted = String(value);
      else if (type === 'number' || type === 'integer') { converted = Number(value); if (!Number.isFinite(converted) || type === 'integer' && !Number.isInteger(converted)) throw new Error(`${parts[0]} contains a value that cannot become ${type}.`); }
      else if (type === 'boolean') { if (value === true || value === false) converted = value; else if (/^(true|1|yes)$/i.test(String(value))) converted = true; else if (/^(false|0|no)$/i.test(String(value))) converted = false; else throw new Error(`${parts[0]} contains a value that cannot become boolean.`); }
      else if (type === 'date') { const date = new Date(value); if (!Number.isFinite(date.valueOf())) throw new Error(`${parts[0]} contains an invalid date.`); converted = date.toISOString().slice(0, 10); }
      else throw new Error(`Unsupported target type: ${type}.`);
      node[parts[0]] = converted; return node;
    };
    let result = value; for (const [field, type] of rules) result = coerce(result, field.split('.'), type);
    return { text: JSON.stringify(result, null, 2), kind: 'json', message: `Normalized ${rules.length} field type(s)` };
  }
  if (kind === 'aggregate' || kind === 'pivot') {
    const parts = option.split(',').map(s => s.trim()); const [field, operation = 'count'] = parts;
    if (!field) throw new Error('Enter a field name. Aggregate options: field,count or field,sum or field,average. Pivot uses the field to group rows.');
    if (kind === 'pivot' || parts.length === 3) {
      const groupField = field; const measureField = kind === 'pivot' ? parts[1] : parts[1]; const aggregate = kind === 'pivot' ? (parts[2] || 'count') : parts[2];
      if (!['count', 'sum', 'average', 'min', 'max'].includes(aggregate)) throw new Error('Grouped summaries support count, sum, average, min, and max.');
      const grouped = new Map(); for (const row of records) { const key = scalar(row?.[groupField] ?? '(missing)'); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(row); }
      const result = [...grouped].map(([key, rows]) => { const nums = rows.map(row => Number(row?.[measureField])).filter(Number.isFinite); const sum = nums.reduce((a, b) => a + b, 0); const metric = aggregate === 'count' ? rows.length : aggregate === 'sum' ? sum : aggregate === 'average' ? nums.length ? sum / nums.length : null : aggregate === 'min' ? nums.length ? Math.min(...nums) : null : nums.length ? Math.max(...nums) : null; return { [groupField]: key, [aggregate === 'count' ? 'count' : `${aggregate}_${measureField || 'value'}`]: metric }; });
      return { text: JSON.stringify(result, null, 2), kind: 'json', message: `Grouped ${records.length} records into ${result.length} summaries` };
    }
    const groups = new Map(); for (const row of records) { const key = scalar(row?.[field] ?? '(missing)'); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); }
    if (kind === 'pivot' || operation === 'count') return { text: JSON.stringify([...groups].map(([key, rows]) => ({ [field]: key, count: rows.length })), null, 2), kind: 'json', message: `Grouped ${records.length} records into ${groups.size} groups` };
    if (!['sum', 'average', 'min', 'max'].includes(operation)) throw new Error('Supported operations: count, sum, average, min, max. Use field,operation.');
    const nums = records.map(row => Number(row?.[field])).filter(Number.isFinite); const total = nums.reduce((a, b) => a + b, 0);
    const result = operation === 'sum' ? total : operation === 'average' ? nums.length ? total / nums.length : null : operation === 'min' ? Math.min(...nums) : Math.max(...nums);
    return { text: JSON.stringify({ field, operation, count: nums.length, result }, null, 2), kind: 'json', message: `${operation} calculated for ${nums.length} numeric values` };
  }
  if (kind === 'normalize') {
    const norm = node => Array.isArray(node) ? node.map(norm) : node && typeof node === 'object' ? Object.fromEntries(Object.entries(node).map(([key, val]) => [key.trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[\s-]+/g, '_').toLowerCase(), norm(val)])) : node;
    return { text: JSON.stringify(norm(value), null, 2), kind: 'json', message: 'Property names normalized to snake_case' };
  }
  if (kind === 'bulk') {
    const [action, ...parts] = option.split(':');
    const from = parts[0]; const to = parts[1];
    if (!['rename', 'remove', 'set'].includes(action) || !from) throw new Error('Use rename:oldName:newName, remove:propertyName, or set:propertyName:value.');
    const edit = node => Array.isArray(node) ? node.map(edit) : node && typeof node === 'object' ? Object.fromEntries(Object.entries(node).filter(([key]) => !(action === 'remove' && key === from)).map(([key, val]) => [action === 'rename' && key === from ? to : key, action === 'set' && key === from ? to : edit(val)]).concat(action === 'set' && !(from in node) ? [[from, to]] : [])) : node;
    return { text: JSON.stringify(edit(value), null, 2), kind: 'json', message: `Applied ${action} property operation recursively` };
  }
  if (kind === 'array') {
    if (!Array.isArray(value) || !Array.isArray(second)) throw new Error('Set operations need arrays in both the input and second-document box.');
    const [operation = 'union', keyField] = option.split(',').map(s => s.trim());
    const key = item => JSON.stringify(canonicalJSON(keyField && item && typeof item === 'object' ? item[keyField] : item));
    const left = new Map(value.map(item => [key(item), item])); const right = new Map(second.map(item => [key(item), item]));
    const result = operation === 'intersection' ? [...left].filter(([k]) => right.has(k)).map(([, v]) => v) : operation === 'difference' ? [...left].filter(([k]) => !right.has(k)).map(([, v]) => v) : operation === 'symmetric' ? [...left].filter(([k]) => !right.has(k)).concat([...right].filter(([k]) => !left.has(k))).map(([, v]) => v) : [...new Map([...left, ...right]).values()];
    return { text: JSON.stringify(result, null, 2), kind: 'json', message: `${operation} returned ${result.length} entries` };
  }
  if (kind === 'mask') {
    const sensitive = /password|secret|token|authorization|api.?key|email|phone|ssn/i;
    const mask = (node, key = '') => Array.isArray(node) ? node.map(item => mask(item)) : node && typeof node === 'object' ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, mask(v, k)])) : sensitive.test(key) && node != null ? '••••••' : node;
    return { text: JSON.stringify(mask(value), null, 2), kind: 'json', message: 'Sensitive-looking fields masked. Review before sharing.' };
  }
  if (kind === 'flatten' || kind === 'unflatten') {
    if (kind === 'flatten') { const out = {}; const walk = (node, path) => { if (node && typeof node === 'object' && !Array.isArray(node) && Object.keys(node).length) for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k); else out[path || '$'] = node; }; walk(value, ''); return { text: JSON.stringify(out, null, 2), kind: 'json', message: `Flattened into ${Object.keys(out).length} paths` }; }
    const out = {}; for (const [path, val] of Object.entries(value)) { const keys = path.replace(/^\$\.?/, '').split('.').filter(Boolean); let cursor = out; for (const key of keys.slice(0, -1)) cursor = cursor[key] ||= {}; if (keys.length) cursor[keys.at(-1)] = val; }
    return { text: JSON.stringify(out, null, 2), kind: 'json', message: 'Restored nested object from dotted paths' };
  }
  if (kind === 'sql') {
    if (!records.every(row => row && typeof row === 'object' && !Array.isArray(row))) throw new Error('SQL generation requires an object or an array of objects.');
    const table = (option || 'records').replace(/[^\w]/g, '_'); const keys = [...new Set(records.flatMap(Object.keys))];
    const sqlType = key => records.map(r => r[key]).filter(v => v != null).every(v => typeof v === 'number') ? 'DOUBLE PRECISION' : records.map(r => r[key]).filter(v => v != null).every(v => typeof v === 'boolean') ? 'BOOLEAN' : 'TEXT';
    const quote = v => v == null ? 'NULL' : typeof v === 'object' ? `'${JSON.stringify(v).replaceAll("'", "''")}'` : typeof v === 'number' || typeof v === 'boolean' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
    const lines = [`CREATE TABLE ${table} (${keys.map(k => `${k.replace(/[^\w]/g, '_')} ${sqlType(k)}`).join(', ')});`, ...records.map(r => `INSERT INTO ${table} (${keys.map(k => k.replace(/[^\w]/g, '_')).join(', ')}) VALUES (${keys.map(k => quote(r[k])).join(', ')});`)];
    return { text: lines.join('\n'), kind: 'text', message: `Generated SQL for ${records.length} row(s)` };
  }
  if (kind === 'canonical') return { text: canonicalStringify(value), kind: 'json', message: 'RFC 8785 canonical JSON generated' };
  if (kind === 'unicode') {
    const findings = []; const walk = (node, path = '$') => { if (typeof node === 'string') { [...node].forEach((c, i) => { const cp = c.codePointAt(0); if (cp < 32 || cp === 0x200b || cp === 0xfeff || cp === 0x00a0 || cp >= 0xd800 && cp <= 0xdfff) findings.push({ path, index: i, codePoint: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`, character: c }); }); } else if (node && typeof node === 'object') Object.entries(node).forEach(([k, v]) => walk(v, `${path}.${k}`)); };
    walk(value); return { text: JSON.stringify({ findings, count: findings.length }, null, 2), kind: 'json', message: `Found ${findings.length} invisible/control Unicode character(s)` };
  }
  if (kind === 'schema-docs') {
    const schema = JSON.parse(document.querySelector('#json-schema').value); const docs = [];
    const walk = (rule, path = '$') => { if (!rule || typeof rule !== 'object') return; docs.push({ path, type: Array.isArray(rule.type) ? rule.type.join(' | ') : rule.type || 'any', required: rule.required || [], description: rule.description || '', enum: rule.enum || undefined }); for (const [k, v] of Object.entries(rule.properties || {})) walk(v, `${path}.${k}`); };
    walk(schema); return { text: JSON.stringify(docs, null, 2), kind: 'report', message: `Documented ${docs.length} schema node(s)` };
  }
  if (kind === 'schema-tests') {
    const schema = JSON.parse(document.querySelector('#json-schema').value);
    const valid = generateMockValue(schema, schema); const cases = [{ name: 'valid example', valid: true, value: valid, errors: validateSchema(valid, schema, '$', [], schema, [], document.querySelector('#schema-draft').value) }];
    if (schema.type === 'object' && schema.required?.length) { const candidate = JSON.parse(JSON.stringify(valid)); delete candidate[schema.required[0]]; cases.push({ name: `missing required property: ${schema.required[0]}`, valid: false, value: candidate, errors: validateSchema(candidate, schema, '$', [], schema, [], document.querySelector('#schema-draft').value) }); }
    const rootType = Array.isArray(schema.type) ? schema.type[0] : schema.type;
    if (rootType) { const bad = { object: 'not-an-object', array: {}, string: 42, number: 'not-a-number', integer: 'not-an-integer', boolean: 'not-a-boolean', null: false }[rootType]; if (bad !== undefined) cases.push({ name: `wrong root type: ${rootType}`, valid: false, value: bad, errors: validateSchema(bad, schema, '$', [], schema, [], document.querySelector('#schema-draft').value) }); }
    return { text: JSON.stringify(cases, null, 2), kind: 'report', message: `Generated ${cases.length} schema test case(s)` };
  }
  if (kind === 'security' || kind === 'compatibility' || kind === 'performance' || kind === 'heatmap' || kind === 'ast') {
    const findings = []; const ast = []; let nodes = 0; let maxDepth = 0; const hotspots = []; const sensitiveKey = /password|secret|token|authorization|api.?key|private.?key|credential/i;
    const walk = (node, path = '$', depth = 0, key = '') => {
      nodes++; maxDepth = Math.max(maxDepth, depth);
      const type = Array.isArray(node) ? 'array' : node === null ? 'null' : typeof node;
      if (kind === 'performance' || kind === 'heatmap') { let size = 0; try { size = new Blob([JSON.stringify(node)]).size; } catch {} hotspots.push({ path, depth, bytes: size, kind: type }); }
      if (kind === 'ast') ast.push({ path, parent: path === '$' ? null : path.replace(/(?:\[[^\]]+\]|\.[^.]+)$/, '') || '$', type, depth, children: node && typeof node === 'object' ? Object.keys(node).length : 0, ...(node === null || typeof node !== 'object' ? { value: node } : {}) });
      if (kind === 'security' && sensitiveKey.test(key) && node != null) findings.push({ path, finding: 'Sensitive-looking property name', value: '[redacted]' });
      if (kind === 'security' && typeof node === 'string' && [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}/, /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/].some(pattern => pattern.test(node))) findings.push({ path, finding: 'Value resembles a credential or token', value: '[redacted]' });
      if (kind === 'compatibility' && typeof node === 'number' && Number.isInteger(node) && !Number.isSafeInteger(node)) findings.push({ path, finding: 'Integer is outside JavaScript safe integer range' });
      if (kind === 'compatibility' && typeof node === 'string' && [...node].some(ch => { const cp = ch.codePointAt(0); return cp >= 0xD800 && cp <= 0xDFFF; })) findings.push({ path, finding: 'Contains an unpaired UTF-16 surrogate' });
      if (Array.isArray(node)) node.forEach((child, i) => walk(child, `${path}[${i}]`, depth + 1));
      else if (node && typeof node === 'object') Object.entries(node).forEach(([name, child]) => walk(child, `${path}.${name}`, depth + 1, name));
    };
    walk(value);
    const top = hotspots.sort((a, b) => b.bytes - a.bytes).slice(0, 12); const maxBytes = top[0]?.bytes || 1;
    const report = kind === 'performance' ? { nodes, maxDepth, bytes: new Blob([JSON.stringify(value)]).size, largestValues: top, findings: maxDepth > 100 ? ['Deep nesting may stress recursive tools.'] : [] }
      : kind === 'heatmap' ? { nodes, maxDepth, regions: top.map(item => ({ ...item, relativeSize: Math.round(item.bytes / maxBytes * 100), heat: '█'.repeat(Math.max(1, Math.round(item.bytes / maxBytes * 12))) })) }
        : kind === 'ast' ? { nodeCount: ast.length, rootType: ast[0]?.type, nodes: ast }
          : { count: findings.length, findings };
    return { text: JSON.stringify(report, null, 2), kind: 'report', message: kind === 'security' ? `Found ${findings.length} sensitive-looking field(s); values are redacted` : kind === 'compatibility' ? `${findings.length} compatibility concern(s) found` : kind === 'heatmap' ? `Mapped ${top.length} large structures` : kind === 'ast' ? `Inspected ${ast.length} syntax tree nodes` : `Profiled ${nodes} JSON nodes to depth ${maxDepth}` };
  }
  if (kind === 'json-yaml') return { text: toSimpleYAML(value), kind: 'text', message: 'Converted JSON to YAML 1.2' };
  if (kind === 'json-xml') return { text: buildXMLFromJSON(value, option || 'root'), kind: 'text', message: 'Converted JSON to well-formed XML' };
  if (kind === 'xml-json') return { text: JSON.stringify(parseXMLToJSON(input.value), null, 2), kind: 'json', message: 'Converted XML to an order-preserving JSON representation' };
  if (kind === 'yaml-json') return { text: JSON.stringify(parseSimpleYAML(input.value), null, 2), kind: 'json', message: 'Parsed YAML 1.2 into JSON' };
  if (kind === 'jsonc-json') { const repaired = repairJSON(input.value); return { text: repaired.json, kind: 'json', message: `Converted relaxed JSON to strict JSON · ${repaired.repairs.length} repair(s)` }; }
  if (kind === 'graphql-inspect') {
    const errors = Array.isArray(value?.errors) ? value.errors.map(error => ({ message: error.message, path: error.path, locations: error.locations })) : [];
    return { text: JSON.stringify({ hasData: Object.prototype.hasOwnProperty.call(value || {}, 'data'), data: value?.data ?? null, errorCount: errors.length, errors, extensions: value?.extensions }, null, 2), kind: 'report', message: errors.length ? `GraphQL response has ${errors.length} error(s)` : 'GraphQL response inspected' };
  }
  if (kind === 'graphql') {
    const definitions = []; const safe = name => { const result = String(name).replace(/[^_0-9A-Za-z]/g, '_'); return /^[_A-Za-z]/.test(result) ? result : `T_${result}`; };
    const infer = (node, name) => {
      if (node === null) return 'String'; if (Array.isArray(node)) return `[${node.length ? infer(node[0], `${name}Item`) : 'String'}]`;
      if (node && typeof node === 'object') { const type = safe(name || 'Nested'); const fields = Object.entries(node).map(([key, child]) => `  ${safe(key)}: ${infer(child, `${type}${safe(key)}`)}`); definitions.push(`type ${type} {\n${fields.join('\n')}\n}`); return type; }
      return typeof node === 'string' ? 'String' : typeof node === 'boolean' ? 'Boolean' : Number.isInteger(node) ? 'Int' : 'Float';
    };
    const root = Array.isArray(value) ? value[0] : value;
    if (root && typeof root === 'object') infer(root, 'Root'); else definitions.push(`type Root { value: ${infer(root, 'Value')} }`);
    return { text: definitions.join('\n\n'), kind: 'text', message: 'Generated starter GraphQL types; review nullable fields and unions.' };
  }
  if (kind === 'fuzz') {
    const source = input.value; const cases = [
      { name: 'valid input', text: source },
      { name: 'trailing comma', text: source.replace(/([}\]])\s*$/, ',$1') },
      { name: 'single-quoted keys', text: source.replaceAll('"', "'") },
      { name: 'truncated input', text: source.slice(0, Math.max(0, source.length - 1)) },
      { name: 'extra comma', text: source.replace(/([}\]])/, ',$1') }
    ].map(test => { try { JSON.parse(test.text); return { ...test, accepted: true }; } catch (error) { return { ...test, accepted: false, error: error.message }; } });
    return { text: JSON.stringify(cases, null, 2), kind: 'report', message: `Created ${cases.length} parser fuzz cases` };
  }
  if (kind === 'search') {
    const needle = option.toLowerCase(); if (!needle) throw new Error('Enter a search phrase or JSON path fragment.');
    const matches = []; const scan = (node, path, label) => { if (path.toLowerCase().includes(needle) || label.toLowerCase().includes(needle) || typeof node === 'string' && node.toLowerCase().includes(needle)) matches.push({ document: label, path, value: node }); if (Array.isArray(node)) node.forEach((item, index) => scan(item, `${path}[${index}]`, label)); else if (node && typeof node === 'object') Object.entries(node).forEach(([key, child]) => scan(child, `${path}.${key}`, label)); };
    scan(value, '$', 'Input'); if (second !== null) (Array.isArray(second) ? second : [second]).forEach((doc, index) => scan(doc, '$', `Document ${index + 2}`)); return { text: JSON.stringify(matches, null, 2), kind: 'report', message: `Found ${matches.length} match(es)` };
  }
  if (kind === 'schema-evolution') {
    const oldSchema = value; if (!second || typeof second !== 'object') throw new Error('Paste the new JSON Schema in the second-document box.');
    const changes = []; const walk = (before, after, path = '$') => {
      const oldRequired = new Set(before?.required || []); const newRequired = new Set(after?.required || []);
      for (const key of Object.keys(before?.properties || {})) if (!(key in (after?.properties || {}))) changes.push({ path: `${path}.${key}`, impact: 'breaking', change: 'Property removed' });
      for (const key of newRequired) if (!oldRequired.has(key)) changes.push({ path: `${path}.${key}`, impact: 'breaking', change: 'Newly required property' });
      if (before?.type && after?.type) { const a = new Set([].concat(before.type)); const b = new Set([].concat(after.type)); if ([...a].some(type => !b.has(type))) changes.push({ path, impact: 'breaking', change: `Type narrowed from ${[...a].join('|')} to ${[...b].join('|')}` }); }
      for (const key of Object.keys(before?.properties || {})) if (after?.properties?.[key]) walk(before.properties[key], after.properties[key], `${path}.${key}`);
      for (const keyword of ['minimum', 'minLength', 'minItems']) if (after?.[keyword] > before?.[keyword]) changes.push({ path, impact: 'potentially breaking', change: `${keyword} constraint tightened` });
      for (const keyword of ['maximum', 'maxLength', 'maxItems']) if (after?.[keyword] < before?.[keyword]) changes.push({ path, impact: 'potentially breaking', change: `${keyword} constraint tightened` });
    };
    walk(oldSchema, second); return { text: JSON.stringify({ breaking: changes.some(item => item.impact === 'breaking'), changes }, null, 2), kind: 'report', message: `Found ${changes.length} schema evolution change(s)` };
  }
  if (kind === 'impact') {
    if (!option) throw new Error('Enter the property name to trace.'); const found = []; const walk = (node, path = '$') => { if (Array.isArray(node)) node.forEach((item, i) => walk(item, `${path}[${i}]`)); else if (node && typeof node === 'object') Object.entries(node).forEach(([key, child]) => { const childPath = `${path}.${key}`; if (key === option || childPath.includes(option)) found.push({ path: childPath, type: Array.isArray(child) ? 'array' : child === null ? 'null' : typeof child, directChildren: child && typeof child === 'object' ? Object.keys(child).length : 0 }); walk(child, childPath); }); };
    walk(value); return { text: JSON.stringify({ property: option, occurrences: found, count: found.length }, null, 2), kind: 'report', message: `Traced ${found.length} occurrence(s) of ${option}` };
  }
  if (kind === 'jsonpath-opt') {
    if (!option) throw new Error('Enter a JSONPath expression in the options field.'); const matches = queryJSONPath(value, option); const suggestions = [];
    if ((option.match(/\.\./g) || []).length) suggestions.push('Recursive descent scans all descendants; use a direct property path when the structure is known.');
    if ((option.match(/\*/g) || []).length) suggestions.push('Wildcards can return many values; narrow them to the property or array index you need.');
    if (matches.length > 1000) suggestions.push(`This expression matched ${matches.length} values; consider filtering earlier.`);
    if (!suggestions.length) suggestions.push('This expression uses direct lookups and has no obvious broad-scan patterns.');
    return { text: JSON.stringify({ expression: option, matches: matches.length, suggestions }, null, 2), kind: 'report', message: `Analyzed JSONPath · ${matches.length} match(es)` };
  }
  if (kind === 'sql-json') return { text: JSON.stringify(parseCSV(input.value, input.value.includes('\t') ? '\t' : ','), null, 2), kind: 'json', message: 'Converted SQL result CSV/TSV into JSON rows' };
  if (kind === 'openapi-import') {
    const spec = value; const base = spec.servers?.[0]?.url || spec.host && `${spec.schemes?.[0] || 'https'}://${spec.host}${spec.basePath || ''}` || '';
    const saved = readApiStore('jsonify-api-collection', []); let count = 0;
    for (const [path, pathItem] of Object.entries(spec.paths || {})) for (const method of ['get', 'post', 'put', 'patch', 'delete']) if (pathItem[method]) {
      const operation = pathItem[method]; saved.push({ name: operation.operationId || `${method.toUpperCase()} ${path}`, method: method.toUpperCase(), url: `${base}${path}`, query: '{}', headers: '{"Accept":"application/json"}', body: '', authType: 'none', authKey: '', authUser: '' }); count++;
    }
    if (!count) throw new Error('No HTTP operations were found in this OpenAPI document.');
    localStorage.setItem('jsonify-api-collection', JSON.stringify(saved)); refreshApiMenus();
    return { text: JSON.stringify({ imported: count, collectionSize: saved.length, server: base || '(set server URL on each request)' }, null, 2), kind: 'report', message: `Imported ${count} OpenAPI operations into the saved request collection` };
  }
  if (kind === 'openapi-export') {
    const requests = readApiStore('jsonify-api-collection', []); const paths = {};
    for (const request of requests) { let parsed; try { parsed = new URL(request.url); } catch { continue; } const path = parsed.pathname; const method = request.method.toLowerCase(); paths[path] ||= {}; paths[path][method] = { operationId: request.name.replace(/[^\w.-]/g, '_'), responses: { '200': { description: 'Successful response' } } }; }
    if (!Object.keys(paths).length) throw new Error('Save at least one valid API request before exporting OpenAPI.');
    return { text: JSON.stringify({ openapi: '3.1.0', info: { title: 'JSONify API collection', version: '1.0.0' }, paths }, null, 2), kind: 'json', message: `Exported ${requests.length} saved request(s) as OpenAPI 3.1` };
  }
  if (kind === 'pipeline') {
    const steps = option.split(',').map(step => step.trim()).filter(Boolean); if (!steps.length) throw new Error('Enter a comma-separated sequence such as normalize,dedupe,flatten.');
    let current = value; const report = [];
    for (const step of steps) { const result = runDataUtility(step, current, '', ''); if (result.kind !== 'json') throw new Error(`Pipeline step “${step}” does not produce JSON.`); current = JSON.parse(result.text); report.push({ step, result: 'complete' }); }
    return { text: JSON.stringify({ steps: report, result: current }, null, 2), kind: 'json', message: `Ran ${steps.length} transformation steps` };
  }
  if (kind === 'patch' || kind === 'migration') {
    if (second === null) throw new Error('Paste the target document into the second-document box.');
    if (kind === 'migration') { const mappings = option.split(',').map(part => part.split(':').map(s => s.trim())).filter(pair => pair.length === 2); const move = node => Array.isArray(node) ? node.map(move) : node && typeof node === 'object' ? Object.fromEntries(Object.entries(node).map(([k, v]) => [mappings.find(([from]) => from === k)?.[1] || k, move(v)])) : node; return { text: JSON.stringify(move(value), null, 2), kind: 'json', message: 'Applied property mappings recursively' }; }
    const ops = []; const esc = s => s.replaceAll('~', '~0').replaceAll('/', '~1'); const walk = (a, b, path = '') => { if (JSON.stringify(canonicalJSON(a)) === JSON.stringify(canonicalJSON(b))) return; if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) { for (const k of Object.keys(a)) if (!(k in b)) ops.push({ op: 'remove', path: `${path}/${esc(k)}` }); for (const [k, v] of Object.entries(b)) if (!(k in a)) ops.push({ op: 'add', path: `${path}/${esc(k)}`, value: v }); else walk(a[k], v, `${path}/${esc(k)}`); } else ops.push({ op: 'replace', path: path || '', value: b }); }; walk(value, second); return { text: JSON.stringify(ops, null, 2), kind: 'json', message: `Generated ${ops.length} JSON Patch operation(s)` };
  }
  throw new Error('That tool is not available yet.');
}

document.querySelector('#data-tool-select').addEventListener('change', event => {
  const kind = event.target.value;
  const second = ['array', 'patch', 'migration', 'search', 'verify', 'schema-evolution'].includes(kind);
  document.querySelector('#data-second-label').hidden = !second;
  document.querySelector('#data-second-label').firstChild.textContent = kind === 'verify' ? 'HMAC SHA-256 signature (hex) ' : kind === 'schema-evolution' ? 'New JSON Schema ' : 'Second JSON document ';
  const optionLabel = { sample: 'Sample size', 'sort-records': 'Sort fields', coerce: 'Field:type rules', aggregate: 'Field, operation or group/value/operation', pivot: 'Group field, optional value and operation', bulk: 'Operation', array: 'Operation, optional key field', sql: 'SQL table name', sign: 'HMAC secret', verify: 'HMAC secret', search: 'Search text or path', impact: 'Property name', 'jsonpath-opt': 'RFC 9535 JSONPath expression', pipeline: 'Comma-separated steps', 'json-xml': 'XML root element name' }[kind] || 'Options';
  document.querySelector('#data-option-label').firstChild.textContent = `${optionLabel} `;
  const option = document.querySelector('#data-option');
  option.type = ['sign', 'verify'].includes(kind) ? 'password' : 'text';
  option.placeholder = kind === 'sample' ? '10' : kind === 'sort-records' ? 'age:desc,name:asc' : kind === 'coerce' ? 'age:number,active:boolean' : kind === 'aggregate' ? 'amount,sum' : kind === 'pivot' ? 'category,amount,sum' : kind === 'bulk' ? 'rename:old:new' : kind === 'array' ? 'union,id' : kind === 'sql' ? 'records' : kind === 'migration' ? 'oldName:newName' : kind === 'search' ? 'customerId' : kind === 'impact' ? 'customerId' : kind === 'jsonpath-opt' ? '$.users[*].email' : kind === 'sign' || kind === 'verify' ? 'Enter secret locally (not saved)' : kind === 'pipeline' ? 'normalize,dedupe,flatten' : kind === 'json-xml' ? 'root' : 'Optional';
  const help = { table: 'View array records as tab-separated columns.', relations: 'Find repeated ID values that may link records.', dedupe: 'Remove structurally identical values from an array.', sample: 'Choose a random subset of root array records.', aggregate: 'Use field,count or field,sum (also average, min, max).', pivot: 'Group records by a field and count each group.', normalize: 'Convert property names to consistent snake_case.', bulk: 'Rename, remove, or set properties recursively across objects and arrays.', array: 'Compare two arrays: union, intersection, difference, or symmetric.', mask: 'Mask values under names that look sensitive; review manually.', security: 'Flag sensitive-looking property names. Values are never included in the findings.', performance: 'Count nodes, nesting depth, serialized size, and largest subtrees.', compatibility: 'Look for unsafe integers and malformed Unicode sequences.', flatten: 'Convert nested objects into dotted paths.', unflatten: 'Restore an object from dotted path keys.', sql: 'Create SQL DDL and INSERT statements for object records.', 'sql-json': 'Import SQL query results pasted or exported as CSV/TSV.', canonical: 'RFC 8785 canonicalization for stable hashing and signatures.', unicode: 'Find control characters and common invisible Unicode.', 'yaml-json': 'Parse YAML 1.2 including block and flow collections, aliases, directives, and multiple documents. Custom tags and non-string map keys use explicit JSON envelopes.', 'json-yaml': 'Serialize JSON as valid YAML 1.2.', 'xml-json': 'Validate XML and preserve element order, attributes, text, CDATA, comments, processing instructions, and declarations in a JSON envelope.', 'json-xml': 'Build well-formed XML from JSON or rebuild from an XML JSON envelope. Set a root element name for regular JSON.', 'jsonc-json': 'Convert JSONC/relaxed JSON comments, quotes, and trailing commas into strict JSON.', graphql: 'Generate starter GraphQL types. Review nullability, unions, and field names.', 'graphql-inspect': 'Summarize data and errors in a GraphQL response.', 'schema-docs': 'Create a readable report from the schema above.', 'schema-tests': 'Create example valid and invalid cases from the current schema.', 'schema-evolution': 'Compare old and new schemas and flag common breaking changes.', patch: 'Generate RFC 6902 operations from input to target.', migration: 'Rename properties recursively with comma-separated old:new pairs.', fuzz: 'Generate malformed variations to exercise a parser.', search: 'Search the input and a second JSON document (or array of documents).', impact: 'List structures containing a property name.', 'jsonpath-opt': 'Analyze a full RFC 9535 JSONPath expression and count its matches.', sign: 'Creates a local HMAC-SHA-256 signature over RFC 8785 canonical JSON.', verify: 'Verify a hex HMAC-SHA-256 signature from the second-document field.', 'openapi-import': 'Import an OpenAPI JSON document and save its operations as API requests.', 'openapi-export': 'Export saved API requests as a starter OpenAPI 3.1 document.', pipeline: 'Chain JSON-producing transforms, for example normalize,dedupe,flatten.' };
  document.querySelector('#data-tool-help').textContent = kind === 'sort-records' ? 'Sort array records by multiple nested properties. Add :desc for descending order; default is ascending.' : kind === 'coerce' ? 'Convert fields across records to string, number, integer, boolean, or date using field:type rules.' : kind === 'heatmap' ? 'Rank the largest structures by serialized size and depth; the text bars show relative size.' : kind === 'ast' ? 'Inspect a path-based syntax tree with node types, parent paths, depth, and child counts.' : help[kind];
});
document.querySelector('#run-data-tool').addEventListener('click', async () => {
  try {
    const kind = document.querySelector('#data-tool-select').value;
    if (kind === 'sign' || kind === 'verify') {
      const secret = document.querySelector('#data-option').value;
      if (!secret) throw new Error('Enter the HMAC secret. It is used only for this operation.');
      if (!crypto.subtle) throw new Error('Web Crypto is unavailable here. Open JSONify in a secure browser context.');
      const source = canonicalStringify(JSON.parse(input.value));
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [kind === 'sign' ? 'sign' : 'verify']);
      if (kind === 'sign') {
        const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(source)));
        setOutput(JSON.stringify({ algorithm: 'HMAC-SHA-256', canonicalization: 'RFC 8785', signature: [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('') }, null, 2), 'report');
        setStatus('valid', 'HMAC signature generated locally.', 'SIGNATURE READY'); return;
      }
      const signature = document.querySelector('#data-second').value.trim().replace(/^0x/i, '');
      if (!/^(?:[a-f\d]{2})+$/i.test(signature)) throw new Error('Paste a valid even-length hexadecimal signature.');
      const bytes = Uint8Array.from(signature.match(/.{2}/g), pair => parseInt(pair, 16));
      const valid = await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(source));
      setOutput(JSON.stringify({ valid, algorithm: 'HMAC-SHA-256', canonicalization: 'RFC 8785' }, null, 2), 'report');
      setStatus(valid ? 'valid' : 'invalid', valid ? 'Signature verified.' : 'Signature does not match.', valid ? 'SIGNATURE VALID' : 'SIGNATURE INVALID'); return;
    }
    const value = ['xml-json', 'yaml-json', 'sql-json', 'jsonc-json'].includes(kind) ? null : kind === 'openapi-export' ? {} : JSON.parse(input.value);
    const result = runDataUtility(kind, value, document.querySelector('#data-second').value, document.querySelector('#data-option').value);
    setOutput(result.text, result.kind); setStatus('valid', result.message, 'TOOL COMPLETE'); showToast(result.message);
  } catch (error) { setOutput(''); setStatus('error', error instanceof SyntaxError ? 'Input or second document is not valid JSON.' : error.message, 'TOOL ERROR'); showToast(error.message, true); }
});

function refreshLocalWorkspaceMenus() {
  const presets = readApiStore('jsonify-data-presets', []);
  const presetSelect = document.querySelector('#preset-select');
  presetSelect.replaceChildren(new Option(presets.length ? 'Choose a preset…' : 'No presets saved', ''));
  presets.forEach((preset, index) => presetSelect.add(new Option(preset.name, String(index))));
  const versions = readApiStore('jsonify-document-versions', []);
  const versionSelect = document.querySelector('#version-select');
  versionSelect.replaceChildren(new Option(versions.length ? 'Choose a version…' : 'No versions saved', ''));
  versions.forEach((version, index) => versionSelect.add(new Option(`${new Date(version.at).toLocaleString()} · ${version.chars} chars`, String(index))));
}
document.querySelector('#save-preset-button').addEventListener('click', () => {
  const name = document.querySelector('#preset-name').value.trim(); if (!name) { showToast('Enter a name for this preset.', true); return; }
  const presets = readApiStore('jsonify-data-presets', []); const preset = { name, kind: document.querySelector('#data-tool-select').value, option: document.querySelector('#data-option').value };
  const index = presets.findIndex(item => item.name === name); if (index >= 0) presets[index] = preset; else presets.push(preset);
  try { localStorage.setItem('jsonify-data-presets', JSON.stringify(presets)); refreshLocalWorkspaceMenus(); showToast('Transformation preset saved locally.'); } catch { showToast('Could not save the preset in this browser.', true); }
});
document.querySelector('#load-preset-button').addEventListener('click', () => {
  const preset = readApiStore('jsonify-data-presets', [])[Number(document.querySelector('#preset-select').value)]; if (!preset) return;
  document.querySelector('#data-tool-select').value = preset.kind; document.querySelector('#data-tool-select').dispatchEvent(new Event('change')); document.querySelector('#data-option').value = preset.option; showToast(`Loaded preset: ${preset.name}`);
});
document.querySelector('#save-version-button').addEventListener('click', () => {
  const versions = readApiStore('jsonify-document-versions', []); versions.unshift({ at: new Date().toISOString(), chars: input.value.length, input: input.value, schema: document.querySelector('#json-schema').value });
  try { localStorage.setItem('jsonify-document-versions', JSON.stringify(versions.slice(0, 30))); refreshLocalWorkspaceMenus(); showToast('Document version saved in this browser.'); } catch { showToast('Version could not be stored. It may be too large for browser storage.', true); }
});
document.querySelector('#restore-version-button').addEventListener('click', () => {
  const version = readApiStore('jsonify-document-versions', [])[Number(document.querySelector('#version-select').value)]; if (!version) return;
  input.value = version.input; document.querySelector('#json-schema').value = version.schema; updateStats(); parseInput(); showToast('Document version restored.');
});
document.querySelector('#export-workspace-button').addEventListener('click', () => {
  const bundle = { format: 'jsonify-workspace', version: 1, exportedAt: new Date().toISOString(), document: input.value, schema: document.querySelector('#json-schema').value, presets: readApiStore('jsonify-data-presets', []), versions: readApiStore('jsonify-document-versions', []), apiRequests: readApiStore('jsonify-api-collection', []), environments: readApiStore('jsonify-environments', {}), apiHistory: readApiStore('jsonify-api-history', []) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'jsonify-workspace.json'; link.click(); URL.revokeObjectURL(url); showToast('Workspace exported. Check the file before sharing; it may contain private data.');
});
document.querySelector('#import-workspace-button').addEventListener('click', () => document.querySelector('#workspace-file').click());
document.querySelector('#workspace-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    const bundle = JSON.parse(await file.text()); if (bundle.format !== 'jsonify-workspace' || bundle.version !== 1) throw new Error('This is not a supported JSONify workspace bundle.');
    if (!confirm('Importing replaces this document and the saved presets, versions, API requests, environments, and history in this browser. Continue?')) return;
    input.value = String(bundle.document || ''); document.querySelector('#json-schema').value = String(bundle.schema || '');
    const entries = { 'jsonify-data-presets': bundle.presets || [], 'jsonify-document-versions': bundle.versions || [], 'jsonify-api-collection': bundle.apiRequests || [], 'jsonify-environments': bundle.environments || {}, 'jsonify-api-history': bundle.apiHistory || [] };
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
    updateStats(); parseInput(); refreshApiMenus(); refreshLocalWorkspaceMenus(); showToast('Workspace imported into this browser.');
  } catch (error) { showToast(`Could not import workspace: ${error.message}`, true); }
  finally { event.target.value = ''; }
});
document.addEventListener('DOMContentLoaded', refreshLocalWorkspaceMenus, { once: true });

