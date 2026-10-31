// JSON parsing, repair, conversion, schema, diff, quality, and tree logic.
// RFC 9535 JSONPath evaluation is implemented in standards-tools.js.

function convertToCSV(value) {
  if (Array.isArray(value) && !value.length) throw new Error('This JSON array is empty. Add at least one value before converting it to CSV.');
  const records = (Array.isArray(value) ? value : [value]).map(item => item && typeof item === 'object' && !Array.isArray(item) ? item : { value: item });
  const headers = [...new Set(records.flatMap(row => Object.keys(row)))];
  const cell = item => {
    const text = item === null || item === undefined ? '' : typeof item === 'object' ? JSON.stringify(item) : String(item);
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [headers.map(cell).join(','), ...records.map(row => headers.map(header => cell(row[header])).join(','))].join('\n');
}

function sampleCSV() {
  return 'name,age,city\nAlex,18,Manila\nSam,24,"Quezon City, PH"';
}

function parseJSONLines(text) {
  const rows = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try { rows.push(JSON.parse(line)); }
    catch (error) { throw new Error(`JSON Lines error on line ${index + 1}: ${error.message}`); }
  });
  if (!rows.length) throw new Error('Enter at least one JSON value, with one value per line.');
  return rows;
}

function repairJSON(source) {
  const repairs = [];
  const positionLabel = position => {
    const before = source.slice(0, position);
    return `line ${before.split('\n').length}, column ${position - before.lastIndexOf('\n')}`;
  };
  const fix = (description, position) => repairs.push(`${description} (${positionLabel(position)})`);
  const fail = (message, position) => { throw new SyntaxError(`${message} at ${positionLabel(position)}`); };
  const tokens = [];
  let cursor = 0;
  while (cursor < source.length) {
    const char = source[cursor];
    if (/\s/.test(char)) { cursor += 1; continue; }
    if (char === '/' && source[cursor + 1] === '/') {
      const start = cursor; cursor += 2;
      while (cursor < source.length && source[cursor] !== '\n') cursor += 1;
      fix('Removed a line comment', start); continue;
    }
    if (char === '/' && source[cursor + 1] === '*') {
      const start = cursor; const end = source.indexOf('*/', cursor + 2);
      if (end < 0) fail('Unclosed block comment', start);
      cursor = end + 2; fix('Removed a block comment', start); continue;
    }
    if ('{}[]:,'.includes(char)) { tokens.push({ type: char, value: char, position: cursor }); cursor += 1; continue; }
    if (char === '"' || char === "'") {
      const start = cursor; const quote = char; cursor += 1; let escaped = false; let closed = false;
      while (cursor < source.length) {
        const current = source[cursor];
        if (!escaped && current === quote) { cursor += 1; closed = true; break; }
        if (!escaped && (current === '\n' || current === '\r')) fail('Unescaped line break in string', start);
        if (!escaped && current === '\\') escaped = true; else escaped = false;
        cursor += 1;
      }
      if (!closed) fail('Unclosed string', start);
      const raw = source.slice(start, cursor);
      let value;
      if (quote === '"') {
        try { value = JSON.parse(raw); } catch { fail('Malformed quoted string', start); }
      } else {
        let inner = raw.slice(1, -1); value = '';
        for (let i = 0; i < inner.length; i += 1) {
          if (inner[i] !== '\\') { value += inner[i]; continue; }
          const next = inner[++i];
          if (next === undefined) fail('Incomplete string escape', start);
          const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0', '\\': '\\', '/': '/', '"': '"', "'": "'" };
          if (next === 'u' && /^[\da-f]{4}$/i.test(inner.slice(i + 1, i + 5))) { value += String.fromCharCode(parseInt(inner.slice(i + 1, i + 5), 16)); i += 4; }
          else if (Object.prototype.hasOwnProperty.call(escapes, next)) value += escapes[next];
          else value += next;
        }
        fix('Converted single quotes to JSON strings', start);
      }
      tokens.push({ type: 'string', value, position: start }); continue;
    }
    const number = source.slice(cursor).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (number) { tokens.push({ type: 'number', value: Number(number[0]), position: cursor }); cursor += number[0].length; continue; }
    const word = source.slice(cursor).match(/^[A-Za-z_$][\w$-]*/);
    if (word) { tokens.push({ type: 'identifier', value: word[0], position: cursor }); cursor += word[0].length; continue; }
    fail(`Unexpected character ${JSON.stringify(char)}`, cursor);
  }
  let index = 0;
  const peek = () => tokens[index];
  const take = type => {
    const token = peek();
    if (!token || token.type !== type) fail(`Expected ${type === '}' ? '}' : type === ']' ? ']' : JSON.stringify(type)}`, token ? token.position : source.length);
    index += 1; return token;
  };
  const canStartValue = token => token && ['{', '[', 'string', 'number', 'identifier'].includes(token.type);
  const parseValue = () => {
    const token = peek();
    if (!token) fail('Expected a JSON value', source.length);
    if (token.type === '{') return parseObject();
    if (token.type === '[') return parseArray();
    if (token.type === 'string' || token.type === 'number') { index += 1; return token.value; }
    if (token.type === 'identifier') {
      index += 1;
      if (token.value === 'true') return true;
      if (token.value === 'false') return false;
      if (token.value === 'null') return null;
      fix('Quoted an unquoted string value', token.position);
      return token.value;
    }
    fail('Expected a JSON value', token.position);
  };
  const parseObject = () => {
    take('{'); const result = {};
    if (peek()?.type === '}') { index += 1; return result; }
    while (true) {
      const keyToken = peek();
      if (!keyToken || !['string', 'identifier', 'number'].includes(keyToken.type)) fail('Expected an object property name', keyToken ? keyToken.position : source.length);
      index += 1;
      const key = String(keyToken.value);
      if (keyToken.type !== 'string') fix('Quoted an unquoted property name', keyToken.position);
      if (Object.prototype.hasOwnProperty.call(result, key)) fail(`Duplicate property ${JSON.stringify(key)}`, keyToken.position);
      if (peek()?.type !== ':') fail('Expected a colon after the property name', peek() ? peek().position : source.length);
      index += 1;
      const value = parseValue();
      Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
      if (peek()?.type === '}') { index += 1; return result; }
      if (peek()?.type === ',') {
        const comma = tokens[index++];
        if (peek()?.type === '}') { fix('Removed a trailing comma', comma.position); index += 1; return result; }
        continue;
      }
      if (peek() && ['string', 'identifier', 'number'].includes(peek().type)) { fix('Inserted a missing comma', peek().position); continue; }
      fail('Expected a comma or closing brace', peek() ? peek().position : source.length);
    }
  };
  const parseArray = () => {
    take('['); const result = [];
    if (peek()?.type === ']') { index += 1; return result; }
    while (true) {
      result.push(parseValue());
      if (peek()?.type === ']') { index += 1; return result; }
      if (peek()?.type === ',') {
        const comma = tokens[index++];
        if (peek()?.type === ']') { fix('Removed a trailing comma', comma.position); index += 1; return result; }
        continue;
      }
      if (canStartValue(peek())) { fix('Inserted a missing comma', peek().position); continue; }
      fail('Expected a comma or closing bracket', peek() ? peek().position : source.length);
    }
  };
  if (!tokens.length) fail('Input is empty', 0);
  const value = parseValue();
  if (peek()) fail('Unexpected content after the JSON value', peek().position);
  return { json: JSON.stringify(value, null, 2), repairs };
}

function diffDocuments(left, right, path = '$', changes = [], ignored = []) {
  const same = (a, b) => JSON.stringify(canonicalJSON(a)) === JSON.stringify(canonicalJSON(b));
  const ignoredPaths = ignored.map(item => item.replace(/\.([A-Za-z_$][\w$]*)/g, '["$1"]'));
  const ignoredPath = (childPath, key) => ignored.includes(key) || ignoredPaths.includes(childPath);
  const add = (kind, childPath, before, after) => changes.push({ kind, path: childPath, before, after });
  if (same(left, right)) return changes;
  const leftArray = Array.isArray(left); const rightArray = Array.isArray(right);
  const leftObject = left !== null && typeof left === 'object';
  const rightObject = right !== null && typeof right === 'object';
  if (leftObject && rightObject && leftArray === rightArray) {
    if (leftArray) {
      const keyed = array => array.every(item => item && typeof item === 'object' && !Array.isArray(item) && Object.hasOwn(item, 'id'))
        && new Set(array.map(item => JSON.stringify(item.id))).size === array.length;
      if (left.length && right.length && keyed(left) && keyed(right)) {
        const leftMap = new Map(left.map(item => [JSON.stringify(item.id), item]));
        const rightMap = new Map(right.map(item => [JSON.stringify(item.id), item]));
        for (const id of new Set([...leftMap.keys(), ...rightMap.keys()])) {
          const childPath = `${path}[id=${id}]`;
          if (!leftMap.has(id)) add('added', childPath, undefined, rightMap.get(id));
          else if (!rightMap.has(id)) add('removed', childPath, leftMap.get(id), undefined);
          else diffDocuments(leftMap.get(id), rightMap.get(id), childPath, changes, ignored);
        }
      } else {
        for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
          const childPath = `${path}[${index}]`;
          if (index >= left.length) add('added', childPath, undefined, right[index]);
          else if (index >= right.length) add('removed', childPath, left[index], undefined);
          else diffDocuments(left[index], right[index], childPath, changes, ignored);
        }
      }
      return changes;
    }
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const childPath = `${path}[${JSON.stringify(key)}]`;
      if (ignoredPath(childPath, key)) continue;
      const inLeft = Object.hasOwn(left, key); const inRight = Object.hasOwn(right, key);
      if (!inLeft) add('added', childPath, undefined, right[key]);
      else if (!inRight) add('removed', childPath, left[key], undefined);
      else diffDocuments(left[key], right[key], childPath, changes, ignored);
    }
    return changes;
  }
  add('changed', path, left, right);
  return changes;
}

function renderDiffResults(changes) {
  const container = document.querySelector('#diff-results');
  container.replaceChildren();
  container.hidden = false;
  if (!changes.length) {
    const note = document.createElement('p'); note.className = 'diff-empty'; note.textContent = 'The documents are equivalent after ignored properties are removed.'; container.append(note); return;
  }
  for (const change of changes) {
    const row = document.createElement('article'); row.className = `diff-entry ${change.kind}`;
    const title = document.createElement('div'); title.className = 'diff-entry-title';
    const tag = document.createElement('span'); tag.textContent = change.kind.toUpperCase();
    const path = document.createElement('code'); path.textContent = change.path;
    title.append(tag, path); row.append(title);
    const values = document.createElement('div'); values.className = 'diff-values';
    for (const [label, value] of [['Before', change.before], ['After', change.after]]) {
      const cell = document.createElement('div'); cell.className = 'diff-value';
      const heading = document.createElement('span'); heading.textContent = label;
      const content = document.createElement('pre'); content.textContent = value === undefined ? '—' : JSON.stringify(value, null, 2);
      cell.append(heading, content); values.append(cell);
    }
    row.append(values); container.append(row);
  }
}

function renderQualityResults(profile) {
  const container = document.querySelector('#quality-results');
  container.replaceChildren(); container.hidden = false;
  const addLine = (text, className = '') => { const item = document.createElement('p'); item.textContent = text; if (className) item.className = className; container.append(item); };
  addLine(`${profile.nodes} values · maximum depth ${profile.maxDepth} · ${Object.entries(profile.types).map(([type, count]) => `${type}: ${count}`).join(' · ')}`, 'quality-overview');
  if (profile.largestString.length >= 0) addLine(`Longest string: ${profile.largestString.length} characters at ${profile.largestString.path}`);
  if (!profile.arrays.length) addLine('No arrays found.');
  for (const array of profile.arrays) {
    addLine(`${array.path}: ${array.length} items${array.recordCount ? ` · ${array.recordCount} object records` : ''}`, 'quality-section');
    if (array.duplicateGroups.length) addLine(`${array.duplicateGroups.reduce((count, group) => count + group.length - 1, 0)} duplicate items across ${array.duplicateGroups.length} duplicate groups.`);
    if (array.recordCount && array.fields.length) {
      for (const field of array.fields) {
        const notes = [];
        if (field.missing) notes.push(`missing in ${field.missing} row${field.missing === 1 ? '' : 's'}`);
        if (field.types.length > 1) notes.push(`types vary: ${field.types.join(', ')}`);
        if (notes.length) addLine(`${array.path} · ${field.key}: ${notes.join('; ')}`, 'quality-issue');
      }
    }
  }
}

function analyzeDataQuality(value) {
  const types = {};
  const arrays = [];
  let nodes = 0; let maxDepth = 0; let largestString = { path: '$', length: -1 };
  const typeOf = node => node === null ? 'null' : Array.isArray(node) ? 'array' : typeof node === 'number' ? 'number' : typeof node;
  const walk = (node, path, depth) => {
    nodes += 1; maxDepth = Math.max(maxDepth, depth);
    const type = typeOf(node); types[type] = (types[type] || 0) + 1;
    if (typeof node === 'string' && node.length > largestString.length) largestString = { path, length: node.length };
    if (Array.isArray(node)) {
      const records = node.filter(item => item && typeof item === 'object' && !Array.isArray(item));
      const keys = [...new Set(records.flatMap(item => Object.keys(item)))];
      const fields = keys.map(key => {
        const present = records.filter(item => Object.prototype.hasOwnProperty.call(item, key));
        const fieldTypes = [...new Set(present.map(item => typeOf(item[key])))];
        return { key, missing: records.length - present.length, types: fieldTypes };
      });
      const duplicates = new Map();
      node.forEach((item, index) => {
        const canonical = JSON.stringify(canonicalJSON(item));
        if (!duplicates.has(canonical)) duplicates.set(canonical, []);
        duplicates.get(canonical).push(index);
      });
      const duplicateGroups = [...duplicates.values()].filter(indices => indices.length > 1);
      arrays.push({ path, length: node.length, recordCount: records.length, fields, duplicateGroups });
      node.forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
    } else if (node && typeof node === 'object') {
      Object.entries(node).forEach(([key, child]) => walk(child, `${path}[${JSON.stringify(key)}]`, depth + 1));
    }
  };
  walk(value, '$', 0);
  return { nodes, maxDepth, types, largestString, arrays };
}

function toTypeScript(value, rootName = 'Root') {
  const definitions = [];
  const usedNames = new Set();
  const cleanName = text => {
    const words = String(text).replace(/[^A-Za-z0-9_$]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    let name = words.map(word => word[0].toUpperCase() + word.slice(1)).join('') || 'Value';
    if (/^\d/.test(name)) name = `Type${name}`;
    return name;
  };
  const reserveName = requested => {
    const base = cleanName(requested);
    let name = base; let suffix = 2;
    while (usedNames.has(name)) { name = `${base}${suffix}`; suffix += 1; }
    usedNames.add(name);
    return name;
  };
  const propertyName = key => /^[$A-Z_a-z][$\w]*$/.test(key) ? key : JSON.stringify(key);
  function infer(node, suggestedName) {
    if (node === null) return 'null';
    if (typeof node === 'string') return 'string';
    if (typeof node === 'number') return 'number';
    if (typeof node === 'boolean') return 'boolean';
    if (Array.isArray(node)) {
      if (!node.length) return 'unknown[]';
      const members = [...new Set(node.map((item, index) => infer(item, `${suggestedName}Item${index ? index + 1 : ''}`)))];
      const union = members.join(' | ');
      return `${members.length > 1 ? `(${union})` : union}[]`;
    }
    if (node && typeof node === 'object') {
      const name = reserveName(suggestedName);
      const fields = Object.entries(node).map(([key, child]) => `  ${propertyName(key)}: ${infer(child, `${name}${cleanName(key)}`)};`);
      definitions.push(`export interface ${name} {\n${fields.join('\n')}\n}`);
      return name;
    }
    return 'unknown';
  }
  const rootType = infer(value, rootName);
  const rootIsDefinition = value !== null && typeof value === 'object' && !Array.isArray(value);
  const rootAlias = rootIsDefinition ? '' : `export type ${cleanName(rootName)} = ${rootType};`;
  return [...definitions, rootAlias].filter(Boolean).join('\n\n');
}

function canonicalJSON(value) {
  if (Array.isArray(value)) return value.map(canonicalJSON);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalJSON(value[key])]));
  return value;
}
function canonicalStringify(value) {
  if (typeof value === 'string') {
    if ([...value].some(char => { const cp = char.codePointAt(0); return cp >= 0xD800 && cp <= 0xDFFF; })) throw new Error('Canonical JSON cannot contain unpaired Unicode surrogates.');
    return JSON.stringify(value);
  }
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Canonical JSON requires finite numbers.'); return JSON.stringify(Object.is(value, -0) ? 0 : value); }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${canonicalStringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

// YAML and XML standards-based parsers live in standards-tools.js.

function parseCSV(text, delimiter = ',') {
  const source = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      row.push(cell); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
      if (char === '\r' && source[i + 1] === '\n') i += 1;
    } else cell += char;
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(cell);
  if (row.some(value => value !== '') || rows.length === 0) rows.push(row);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one data row.');
  const headers = rows[0].map((name, index) => name.trim() || `column_${index + 1}`);
  if (new Set(headers).size !== headers.length) throw new Error('CSV header names must be unique.');
  return rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${values.length} columns; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header, column) => [header, values[column]]));
  });
}

// Draft-aware JSON Schema validation is implemented in standards-tools.js.

function generateSchema(value) {
  const schemaFor = node => {
    if (node === null) return { type: 'null' };
    if (typeof node === 'string') return { type: 'string' };
    if (typeof node === 'boolean') return { type: 'boolean' };
    if (typeof node === 'number') return { type: Number.isInteger(node) ? 'integer' : 'number' };
    if (Array.isArray(node)) {
      const variants = [...new Map(node.map(item => {
        const schema = schemaFor(item);
        return [JSON.stringify(canonicalJSON(schema)), schema];
      })).values()];
      return { type: 'array', items: variants.length > 1 ? { anyOf: variants } : variants[0] || {} };
    }
    if (node && typeof node === 'object') {
      const properties = Object.fromEntries(Object.entries(node).map(([key, child]) => [key, schemaFor(child)]));
      return { type: 'object', properties, required: Object.keys(node) };
    }
    return {};
  };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...schemaFor(value)
  };
}

function generateMockValue(schema, rootSchema, key = '', depth = 0) {
  if (depth > 12) return null;
  if (!schema || typeof schema !== 'object') return null;
  if (schema.$ref) return generateMockValue(resolveSchemaReference(rootSchema, schema.$ref), rootSchema, key, depth + 1);
  if (Array.isArray(schema.allOf)) {
    const merged = { ...schema };
    const mergedProperties = { ...(schema.properties || {}) };
    const mergedRequired = new Set(schema.required || []);
    for (const part of schema.allOf) {
      const rule = part.$ref ? resolveSchemaReference(rootSchema, part.$ref) : part;
      Object.assign(merged, rule);
      Object.assign(mergedProperties, rule.properties || {});
      (rule.required || []).forEach(property => mergedRequired.add(property));
    }
    merged.properties = mergedProperties;
    merged.required = [...mergedRequired];
    schema = merged;
  }
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
    const variants = schema.oneOf || schema.anyOf;
    return generateMockValue(variants[Math.floor(Math.random() * variants.length)], rootSchema, key, depth + 1);
  }
  let type = Array.isArray(schema.type) ? schema.type[Math.floor(Math.random() * schema.type.length)] : schema.type;
  if (!type) type = schema.properties ? 'object' : schema.items ? 'array' : schema.enum ? undefined : 'string';
  if (Array.isArray(schema.enum) && schema.enum.length) return structuredClone(schema.enum[Math.floor(Math.random() * schema.enum.length)]);
  if (Object.prototype.hasOwnProperty.call(schema, 'const')) return structuredClone(schema.const);
  if (type === 'null') return null;
  if (type === 'boolean') return Math.random() >= .5;
  if (type === 'integer' || type === 'number') {
    const minimum = typeof schema.minimum === 'number' ? schema.minimum : type === 'integer' ? 1 : 0;
    const maximum = typeof schema.maximum === 'number' ? schema.maximum : minimum + 100;
    const value = minimum + Math.random() * Math.max(0, maximum - minimum);
    return type === 'integer' ? Math.round(value) : Math.round(value * 100) / 100;
  }
  if (type === 'array') {
    const min = Math.max(0, schema.minItems || 0);
    const max = Math.min(100, schema.maxItems || Math.max(min, 3));
    const count = max <= min ? min : min + Math.floor(Math.random() * (max - min + 1));
    return Array.from({ length: count }, (_, index) => {
      const itemSchema = Array.isArray(schema.prefixItems) ? schema.prefixItems[index] || schema.items || {} : schema.items || {};
      return generateMockValue(itemSchema, rootSchema, `${key}Item`, depth + 1);
    });
  }
  if (type === 'object') {
    const result = {};
    const required = new Set(schema.required || []);
    for (const [property, rule] of Object.entries(schema.properties || {})) {
      if (!required.has(property) && Math.random() < .35) continue;
      result[property] = generateMockValue(rule, rootSchema, property, depth + 1);
    }
    return result;
  }
  const firstNames = ['Alex', 'Jordan', 'Taylor', 'Morgan', 'Riley', 'Casey'];
  const lastNames = ['Reed', 'Cruz', 'Kim', 'Patel', 'Rivera', 'Brooks'];
  const first = firstNames[Math.floor(Math.random() * firstNames.length)];
  const last = lastNames[Math.floor(Math.random() * lastNames.length)];
  const field = key.toLowerCase();
  let text = schema.format === 'email' || field.includes('email') ? `${first.toLowerCase()}.${last.toLowerCase()}@example.test`
    : schema.format === 'date' || field.endsWith('date') ? `202${Math.floor(Math.random() * 7)}-0${1 + Math.floor(Math.random() * 9)}-${String(1 + Math.floor(Math.random() * 27)).padStart(2, '0')}`
      : schema.format === 'uuid' ? '00000000-0000-4000-8000-000000000001'
        : field.includes('first') ? first : field.includes('last') ? last
          : field.includes('name') ? `${first} ${last}` : field.includes('city') ? ['Portland', 'Cebu City', 'Austin', 'Davao City'][Math.floor(Math.random() * 4)]
            : field.includes('address') || field.includes('street') ? `${10 + Math.floor(Math.random() * 900)} Maple Street`
              : field.includes('phone') ? '+1-555-0100' : `sample-${Math.floor(1000 + Math.random() * 9000)}`;
  const minLength = Math.max(0, schema.minLength || 0);
  const maxLength = Math.min(256, schema.maxLength || 256);
  if (text.length < minLength) text = text.padEnd(minLength, 'x');
  return text.slice(0, maxLength);
}

