import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const browserState = { '#schema-references': '' };
const sandbox = vm.createContext({
  window: {},
  document: { querySelector: selector => ({ value: browserState[selector] ?? '' }) },
  TextEncoder,
  TextDecoder,
  URL,
  btoa,
  atob,
  console
});
vm.runInContext(fs.readFileSync(new URL('../vendor/jsonify-libs.js', import.meta.url), 'utf8'), sandbox);
sandbox.window.JSONifyVendor = sandbox.JSONifyVendor;
vm.runInContext(fs.readFileSync(new URL('../js/standards-tools.js', import.meta.url), 'utf8'), sandbox);

test('Draft 7 validates classic tuple, dependency, and exclusive-bound rules', () => {
  const schema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    properties: { amount: { type: 'number', exclusiveMinimum: 0 }, name: { type: 'string' } },
    required: ['amount'],
    dependencies: { amount: ['name'] },
    additionalProperties: false
  };
  assert.equal(sandbox.validateSchemaDetailed({ amount: 1, name: 'a' }, schema).valid, true);
  assert.equal(sandbox.validateSchemaDetailed({ amount: 0 }, schema).valid, false);
});

test('2019-09 applies unevaluatedProperties across subschemas', () => {
  const schema = {
    $schema: 'https://json-schema.org/draft/2019-09/schema',
    allOf: [{ properties: { name: { type: 'string' } } }],
    unevaluatedProperties: false
  };
  assert.equal(sandbox.validateSchemaDetailed({ name: 'Ada' }, schema).valid, true);
  assert.equal(sandbox.validateSchemaDetailed({ name: 'Ada', extra: true }, schema).valid, false);
});

test('2020-12 handles prefixItems and reports useful instance paths', () => {
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'array',
    prefixItems: [{ type: 'integer' }, { type: 'string' }],
    items: false
  };
  assert.equal(sandbox.validateSchemaDetailed([3, 'three'], schema).valid, true);
  const report = sandbox.validateSchemaDetailed([3, 4, 5], schema);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(error => error.keyword === 'items'));
});

test('combinators and conditional schemas report the exact failing data path', () => {
  const schema = {
    type: 'object',
    properties: { kind: { enum: ['user', 'service'] }, name: { type: 'string' }, token: { type: 'string' } },
    required: ['kind'],
    oneOf: [{ required: ['name'] }, { required: ['token'] }],
    if: { properties: { kind: { const: 'user' } }, required: ['kind'] },
    then: { required: ['name'] },
    not: { required: ['admin'] }
  };
  assert.equal(sandbox.validateSchemaDetailed({ kind: 'user', name: 'Ada' }, schema).valid, true);
  const report = sandbox.validateSchemaDetailed({ kind: 'user', token: 'secret' }, schema);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(error => error.path === '$["name"]' && error.keyword === 'required'));
});

test('external JSON Schema references resolve from the offline URI registry', () => {
  browserState['#schema-references'] = JSON.stringify({
    'https://example.test/common.json': {
      $id: 'https://example.test/common.json',
      $defs: { identifier: { type: 'string', format: 'uuid' } }
    }
  });
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    properties: { id: { $ref: 'https://example.test/common.json#/$defs/identifier' } },
    required: ['id']
  };
  assert.equal(sandbox.validateSchemaDetailed({ id: '550e8400-e29b-41d4-a716-446655440000' }, schema).valid, true);
  const report = sandbox.validateSchemaDetailed({ id: 'not-a-uuid' }, schema);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(error => error.path === '$["id"]' && error.keyword === 'format'));
  browserState['#schema-references'] = '';
});

test('JSONPath follows RFC 9535 filters, slices, unions, and recursive descent', () => {
  const data = {
    store: { book: [{ title: 'One', price: 5 }, { title: 'Two', price: 12 }, { title: 'Three', price: 8 }] },
    title: 'Root'
  };
  const sameRealmData = vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(data))})`, sandbox);
  assert.deepEqual(Array.from(sandbox.queryJSONPath(sameRealmData, '$.store.book[?@.price < 10].title'), item => item.value), ['One', 'Three']);
  assert.deepEqual(Array.from(sandbox.queryJSONPath(sameRealmData, "$['store']['book'][0:2].title"), item => item.value), ['One', 'Two']);
  assert.deepEqual(Array.from(sandbox.queryJSONPath(sameRealmData, "$['store']['book'][0,2].title"), item => item.value), ['One', 'Three']);
  assert.deepEqual(Array.from(sandbox.queryJSONPath(sameRealmData, '$..title'), item => item.value), ['Root', 'One', 'Two', 'Three']);
  const users = vm.runInContext('JSON.parse(`{"users":[{"name":"Ada"},{"name":"Bo"}]}`)', sandbox);
  assert.deepEqual(Array.from(sandbox.queryJSONPath(users, '$.users[?length(@.name) > 2].name'), item => item.value), ['Ada']);
});

test('YAML 1.2 parses block, flow, aliases, custom tags, map keys, and streams', () => {
  const yaml = [
    'base: &base {enabled: true, retries: 3}',
    'copy: *base',
    'custom: !example/Thing 42',
    '? [a, b]',
    ': value',
    '---',
    'items:',
    '  - "true"',
    '  - null'
  ].join('\n');
  const value = sandbox.parseSimpleYAML(yaml);
  assert.equal(value.length, 2);
  const firstDoc = JSON.parse(JSON.stringify(value[0]));
  const lookup = key => firstDoc.$yamlMap.find(([name]) => name === key)?.[1];
  assert.deepEqual(lookup('base'), { enabled: true, retries: 3 });
  assert.deepEqual(lookup('copy'), { enabled: true, retries: 3 });
  assert.equal(lookup('custom').$yamlTag, '!example/Thing');
  assert.ok(Array.isArray(firstDoc.$yamlMap.find(([name]) => Array.isArray(name))));
  assert.deepEqual(JSON.parse(JSON.stringify(value[1])), { items: ['true', null] });
  const text = sandbox.toSimpleYAML({ enabled: true, values: ['true', 2] });
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.parseSimpleYAML(text))), { enabled: true, values: ['true', 2] });
});

test('XML parsing validates and preserves ordered XML structure for round-trips', () => {
  const xml = '<?xml version="1.0"?><!DOCTYPE root><root xmlns:x="urn:x"><x:item id="1">pre<![CDATA[mid<text]]><!--note--><?ok yes?><empty/>post</x:item></root>';
  const json = sandbox.parseXMLToJSON(xml);
  assert.equal(json.$xml, 'fast-xml-parser-preserve-order-v1');
  const rebuilt = sandbox.buildXMLFromJSON(json);
  assert.equal(sandbox.window.JSONifyVendor.XMLValidator.validate(rebuilt), true);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.parseXMLToJSON(rebuilt).nodes)), JSON.parse(JSON.stringify(json.nodes)));
  assert.match(rebuilt, /xmlns:x="urn:x"/);
  assert.match(rebuilt, /<!\[CDATA\[mid<text\]\]>/);
  assert.match(rebuilt, /<!DOCTYPE root>/);
  assert.match(rebuilt, /<!--note-->/);
  assert.match(rebuilt, /<\?ok yes\?>/);
  assert.throws(() => sandbox.parseXMLToJSON('<root><item></root>'), /Malformed XML/);
});

test('JSON to XML escapes data and validates root element names', () => {
  const xml = sandbox.buildXMLFromJSON({ label: '<script>&"' }, 'record');
  assert.equal(sandbox.window.JSONifyVendor.XMLValidator.validate(xml), true);
  assert.match(xml, /&lt;script&gt;&amp;&quot;/);
  assert.throws(() => sandbox.buildXMLFromJSON({ value: 1 }, 'bad name'), /valid XML root/);
});
