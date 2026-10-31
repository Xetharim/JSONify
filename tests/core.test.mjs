import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const app = vm.createContext({ console, Math, Object, Set, Map, JSON, Number, String, Array });
vm.runInContext(fs.readFileSync(new URL('../js/json-tools.js', import.meta.url), 'utf8'), app);

test('JSON repair fixes common syntax mistakes without changing string contents', () => {
  const repaired = app.repairJSON("{name:'Ada', note:'a, b', active:true, tags:['x' 'y',],}");
  assert.deepEqual(JSON.parse(repaired.json), { name: 'Ada', note: 'a, b', active: true, tags: ['x', 'y'] });
  assert.ok(repaired.repairs.length >= 5);
  assert.throws(() => app.repairJSON('{name:}'), /Expected a JSON value/);
});

test('CSV parser handles escaped quotes, embedded delimiters, CRLF, and malformed rows', () => {
  const rows = app.parseCSV('name,note\r\nAda,"said ""hello, world"""\r\n');
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ name: 'Ada', note: 'said "hello, world"' }]);
  assert.throws(() => app.parseCSV('name,age\nAda'), /expected 2/);
  assert.throws(() => app.parseCSV('name,name\nAda,Ada'), /unique/);
});

test('JSON to CSV round-trips quoted values and object cells', () => {
  const source = [{ name: 'Ada', note: 'a,"b"', meta: { active: true } }, { name: 'Lin', note: '', meta: null }];
  const csv = app.convertToCSV(source);
  const parsed = app.parseCSV(csv);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), [
    { name: 'Ada', note: 'a,"b"', meta: '{"active":true}' },
    { name: 'Lin', note: '', meta: '' }
  ]);
});

test('JSON Lines preserves line diagnostics and parses independent values', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(app.parseJSONLines('{"id":1}\n[2,3]\ntrue'))), [{ id: 1 }, [2, 3], true]);
  assert.throws(() => app.parseJSONLines('{"id":1}\nnot json'), /line 2/);
});

test('document diff detects id-based array edits and honors ignored paths', () => {
  const changes = app.diffDocuments(
    { users: [{ id: 1, name: 'Ada', updatedAt: 'old' }, { id: 2, name: 'Lin' }] },
    { users: [{ id: 1, name: 'Ada Lovelace', updatedAt: 'new' }, { id: 3, name: 'Sam' }] },
    '$', [], ['updatedAt']
  );
  assert.deepEqual(changes.map(change => change.kind), ['changed', 'removed', 'added']);
  assert.ok(changes.some(change => change.path.includes('"name"') && change.kind === 'changed'));
  assert.ok(!changes.some(change => change.path.includes('updatedAt')));
});

test('canonical JSON sorts object keys and rejects non-finite numbers', () => {
  assert.equal(app.canonicalStringify({ z: 1, a: { y: true, x: null } }), '{"a":{"x":null,"y":true},"z":1}');
  assert.throws(() => app.canonicalStringify(Infinity), /finite numbers/);
});
