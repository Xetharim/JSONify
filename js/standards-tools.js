// Standards-backed parsers and validators. The bundled libraries are in vendor/.
const Standards = window.JSONifyVendor;
const schemaDrafts = {
  'draft-07': {
    id: 'http://json-schema.org/draft-07/schema#',
    Validator: Standards.AjvDraft7
  },
  '2019-09': {
    id: 'https://json-schema.org/draft/2019-09/schema',
    Validator: Standards.Ajv2019
  },
  '2020-12': {
    id: 'https://json-schema.org/draft/2020-12/schema',
    Validator: Standards.Ajv2020
  }
};

function parseSchemaReferenceRegistry() {
  const text = document.querySelector('#schema-references')?.value.trim();
  if (!text) return {};
  const registry = JSON.parse(text);
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('The reference registry must be a JSON object keyed by schema URI.');
  }
  return registry;
}

function schemaDraftFor(schema, selectedDraft = '2020-12') {
  const declared = schema?.$schema;
  if (declared) {
    const match = Object.entries(schemaDrafts).find(([, details]) => declared === details.id || declared === details.id.replace(/#$/, ''));
    if (!match) throw new Error(`Unsupported JSON Schema draft: ${declared}`);
    return match[0];
  }
  if (!schemaDrafts[selectedDraft]) throw new Error(`Unsupported JSON Schema draft: ${selectedDraft}`);
  return selectedDraft;
}

function jsonPointerToPath(pointer) {
  if (!pointer) return '$';
  return '$' + pointer.split('/').slice(1).map(part => {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    return /^(0|[1-9]\d*)$/.test(key) ? `[${key}]` : `[${JSON.stringify(key)}]`;
  }).join('');
}

function schemaErrorPath(error) {
  let pointer = error.instancePath || '';
  const params = error.params || {};
  const property = ['required', 'dependentRequired'].includes(error.keyword)
    ? params.missingProperty
    : ['additionalProperties', 'unevaluatedProperties'].includes(error.keyword)
      ? params.additionalProperty || params.unevaluatedProperty
      : error.keyword === 'propertyNames' ? params.propertyName : undefined;
  if (property !== undefined) pointer += `/${String(property).replace(/~/g, '~0').replace(/\//g, '~1')}`;
  return jsonPointerToPath(pointer);
}

function validateSchemaDetailed(value, schema, selectedDraft = '2020-12', suppliedRegistry) {
  const draft = schemaDraftFor(schema, selectedDraft);
  const { Validator } = schemaDrafts[draft];
  const ajv = new Validator({
    allErrors: true,
    verbose: true,
    strict: false,
    validateFormats: true,
    messages: true,
    coerceTypes: false,
    useDefaults: false,
    removeAdditional: false
  });
  Standards.addFormats(ajv);

  const registry = suppliedRegistry || parseSchemaReferenceRegistry();
  for (const [uri, externalSchema] of Object.entries(registry)) {
    if (!/^https?:\/\//i.test(uri)) throw new Error(`Reference registry keys must be absolute HTTP(S) URIs: ${uri}`);
    if (!externalSchema || typeof externalSchema !== 'object' || Array.isArray(externalSchema)) {
      throw new Error(`Reference ${uri} must contain a JSON Schema object.`);
    }
    if (externalSchema.$id && externalSchema.$id !== uri) {
      throw new Error(`Reference registry key ${uri} must match the schema's $id (${externalSchema.$id}).`);
    }
    ajv.addSchema(externalSchema, uri);
  }

  const valid = ajv.validate(schema, value);
  const errors = (ajv.errors || []).map(error => ({
    path: schemaErrorPath(error),
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message || 'does not match the schema',
    params: error.params
  }));
  return { valid: Boolean(valid), draft, errors };
}

function validateSchema(value, schema, _path = '$', _errors = [], _rootSchema = schema, _refTrail = [], draft = '2020-12') {
  const report = validateSchemaDetailed(value, schema, draft);
  return report.errors.map(error => `${error.path}: ${error.message} (${error.keyword})`);
}

function resolveSchemaReference(rootSchema, reference) {
  const hashIndex = reference.indexOf('#');
  const uri = hashIndex < 0 ? reference : reference.slice(0, hashIndex);
  const fragment = hashIndex < 0 ? '' : reference.slice(hashIndex + 1);
  let target = rootSchema;
  if (uri) {
    const registry = parseSchemaReferenceRegistry();
    target = rootSchema?.$id === uri ? rootSchema : registry[uri];
    if (!target) throw new Error(`Reference ${uri} is not in the offline reference registry.`);
  }
  if (!fragment) return target;
  if (!fragment.startsWith('/')) {
    let found;
    const walk = node => {
      if (!node || typeof node !== 'object' || found) return;
      if (node.$anchor === fragment || node.$dynamicAnchor === fragment) { found = node; return; }
      Object.values(node).forEach(walk);
    };
    walk(target);
    if (!found) throw new Error(`Unresolved JSON Schema anchor: ${reference}`);
    return found;
  }
  const parts = fragment.slice(1).split('/').map(part => decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~'));
  const result = parts.reduce((node, key) => {
    if (!node || !Object.prototype.hasOwnProperty.call(node, key)) throw new Error(`Unresolved JSON Schema reference: ${reference}`);
    return node[key];
  }, target);
  return result;
}

function queryJSONPath(root, expression, limit = 10000) {
  const values = Standards.jsonPathQuery(root, expression);
  const paths = Standards.jsonPathPaths(root, expression);
  if (values.length > limit) throw new RangeError(`This JSONPath matched ${values.length} nodes; narrow the query to ${limit} or fewer.`);
  if (values.length !== paths.length) throw new Error('The JSONPath engine returned mismatched values and paths.');
  return values.map((value, index) => ({ value, path: paths[index] }));
}

function yamlNodeToJSON(node, documentNode, state = { aliases: 0, nodes: 0, ancestors: new Set() }, depth = 0) {
  state.nodes += 1;
  if (state.nodes > 1000000) throw new Error('YAML document is too large to convert safely (over 1,000,000 nodes).');
  if (depth > 512) throw new Error('YAML nesting exceeds the safe conversion depth of 512.');
  if (Standards.YAML.isAlias(node)) {
    state.aliases += 1;
    if (state.aliases > 10000) throw new Error('YAML alias expansion exceeds the safe limit of 10,000 references.');
    const resolved = node.resolve(documentNode);
    if (!resolved) throw new Error(`Unresolved YAML alias *${node.source}.`);
    return yamlNodeToJSON(resolved, documentNode, state, depth + 1);
  }
  if (!Standards.YAML.isNode(node)) return node;
  if (state.ancestors.has(node)) throw new Error('Cyclic YAML aliases cannot be represented as JSON.');
  state.ancestors.add(node);
  let value;
  if (Standards.YAML.isScalar(node)) {
    value = node.value;
    if (typeof value === 'bigint') value = { $yamlTag: node.tag || '!!int', $value: value.toString() };
    else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) value = { $yamlTag: node.tag || '!!binary', $value: value.toString('base64') };
    else if (value instanceof Uint8Array) {
      let binary = '';
      value.forEach(byte => { binary += String.fromCharCode(byte); });
      value = { $yamlTag: node.tag || '!!binary', $value: btoa(binary) };
    }
    else if (value instanceof Date) value = value.toISOString();
  } else if (Standards.YAML.isSeq(node)) {
    value = node.items.map(item => yamlNodeToJSON(item, documentNode, state, depth + 1));
  } else if (Standards.YAML.isMap(node)) {
    const pairs = node.items.map(pair => [yamlNodeToJSON(pair.key, documentNode, state, depth + 1), yamlNodeToJSON(pair.value, documentNode, state, depth + 1)]);
    if (pairs.every(([key]) => typeof key === 'string')) {
      value = Object.create(null);
      pairs.forEach(([key, child]) => { value[key] = child; });
    } else value = { $yamlMap: pairs };
  } else throw new Error('This YAML node type cannot be represented as JSON.');

  if (node.tag && !node.tag.startsWith('tag:yaml.org,2002:')) value = { $yamlTag: node.tag, $value: value };
  state.ancestors.delete(node);
  return value;
}

function parseSimpleYAML(source) {
  const documents = Standards.YAML.parseAllDocuments(source, {
    version: '1.2',
    schema: 'core',
    uniqueKeys: true,
    prettyErrors: true
  });
  const errors = documents.flatMap((doc, index) => doc.errors.map(error => `Document ${index + 1}: ${error.message}`));
  if (errors.length) throw new Error(errors.join('\n'));
  if (!documents.length) throw new Error('YAML input is empty.');
  const values = documents.map(doc => yamlNodeToJSON(doc.contents, doc));
  return values.length === 1 ? values[0] : values;
}

function toSimpleYAML(value) {
  return Standards.YAML.stringify(value, {
    version: '1.2',
    schema: 'core',
    indent: 2,
    lineWidth: 0,
    defaultStringType: 'QUOTE_DOUBLE',
    aliasDuplicateObjects: false
  });
}

function xmlParserOptions() {
  return {
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    cdataPropName: '#cdata',
    commentPropName: '#comment',
    ignoreDeclaration: false,
    ignorePiTags: false,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false,
    processEntities: { enabled: true, maxEntitySize: 10000, maxExpansionDepth: 20, maxTotalExpansions: 10000, maxExpandedLength: 20000000, maxEntityCount: 1000 },
    maxNestedTags: 1000
  };
}

function readDoctype(source) {
  const start = source.indexOf('<!DOCTYPE');
  if (start < 0) return '';
  let quote = '';
  let subsetDepth = 0;
  for (let i = start + 9; i < source.length; i += 1) {
    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i + 4);
      if (end < 0) throw new Error('The XML document type declaration contains an unclosed comment.');
      i = end + 2;
      continue;
    }
    if (quote) { if (source[i] === quote) quote = ''; continue; }
    if (source[i] === '"' || source[i] === "'") { quote = source[i]; continue; }
    if (source[i] === '[') subsetDepth += 1;
    else if (source[i] === ']') subsetDepth -= 1;
    else if (source[i] === '>' && subsetDepth === 0) return source.slice(start, i + 1);
  }
  throw new Error('The XML document type declaration is incomplete.');
}

function restoreProcessingInstructionData(nodes, instructions) {
  let cursor = 0;
  const walk = list => {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      for (const [name, children] of Object.entries(item)) {
        if (name.startsWith('?') && name !== '?xml' && Array.isArray(children) && instructions[cursor]) {
          const target = name.slice(1);
          const instruction = instructions[cursor++];
          if (instruction.target === target && children[0] && typeof children[0] === 'object') children[0]['#text'] = instruction.data;
        }
        if (Array.isArray(children)) walk(children);
      }
    }
  };
  walk(nodes);
}

function processingInstructionsFromNodes(nodes) {
  const result = [];
  const walk = list => {
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      for (const [name, children] of Object.entries(item)) {
        if (name.startsWith('?') && name !== '?xml' && Array.isArray(children)) {
          const data = children.map(child => child && typeof child === 'object' ? child['#text'] : '').filter(Boolean).join('');
          result.push({ target: name.slice(1), data });
        }
        if (Array.isArray(children)) walk(children);
      }
    }
  };
  walk(nodes);
  return result;
}

function readProcessingInstructions(source) {
  const result = [];
  for (let i = 0; i < source.length; i += 1) {
    if (source.startsWith('<!--', i)) { const end = source.indexOf('-->', i + 4); if (end < 0) break; i = end + 2; continue; }
    if (source.startsWith('<![CDATA[', i)) { const end = source.indexOf(']]>', i + 9); if (end < 0) break; i = end + 2; continue; }
    if (source.startsWith('<?', i)) {
      const end = source.indexOf('?>', i + 2);
      if (end < 0) break;
      const content = source.slice(i + 2, end).trim();
      const match = content.match(/^([^\s]+)(?:\s+([\s\S]*))?$/);
      if (match && match[1].toLowerCase() !== 'xml') result.push({ target: match[1], data: match[2] || '' });
      i = end + 1;
    }
  }
  return result;
}

function parseXMLToJSON(source) {
  const validation = Standards.XMLValidator.validate(source);
  if (validation !== true) {
    const { line, col } = validation.err;
    throw new Error(`Malformed XML at line ${line}, column ${col}: ${validation.err.msg}`);
  }
  const nodes = new Standards.XMLParser(xmlParserOptions()).parse(source);
  restoreProcessingInstructionData(nodes, readProcessingInstructions(source));
  return { $xml: 'fast-xml-parser-preserve-order-v1', doctype: readDoctype(source), nodes };
}

function buildXMLFromJSON(value, rootName = 'root') {
  const isEnvelope = value && value.$xml === 'fast-xml-parser-preserve-order-v1' && Array.isArray(value.nodes);
  const builder = new Standards.XMLBuilder({ ...xmlParserOptions(), preserveOrder: isEnvelope, format: !isEnvelope, indentBy: '  ', suppressEmptyNode: false });
  let xml;
  if (isEnvelope) {
    xml = builder.build(value.nodes);
  } else {
    const name = String(rootName || 'root').trim();
    const nameChars = [...name];
    const isStart = char => {
      const cp = char.codePointAt(0);
      return cp === 0x3a || cp === 0x5f || cp >= 0x41 && cp <= 0x5a || cp >= 0x61 && cp <= 0x7a || cp >= 0xc0 && cp <= 0xd6 || cp >= 0xd8 && cp <= 0xf6 || cp >= 0xf8 && cp <= 0x2ff || cp >= 0x370 && cp <= 0x37d || cp >= 0x37f && cp <= 0x1fff || cp >= 0x200c && cp <= 0x200d || cp >= 0x2070 && cp <= 0x218f || cp >= 0x2c00 && cp <= 0x2fef || cp >= 0x3001 && cp <= 0xd7ff || cp >= 0xf900 && cp <= 0xfdcf || cp >= 0xfdf0 && cp <= 0xfffd || cp >= 0x10000 && cp <= 0xeffff;
    };
    const isName = char => isStart(char) || char === '-' || char === '.' || char >= '0' && char <= '9' || char.codePointAt(0) === 0xb7 || char.codePointAt(0) >= 0x300 && char.codePointAt(0) <= 0x36f || char.codePointAt(0) >= 0x203f && char.codePointAt(0) <= 0x2040;
    if (!nameChars.length || !isStart(nameChars[0]) || !nameChars.slice(1).every(isName)) {
      throw new Error('Enter a valid XML root element name.');
    }
    xml = builder.build({ [name]: value });
  }
  if (isEnvelope && value.doctype) {
    const declarationEnd = xml.startsWith('<?xml') ? xml.indexOf('?>') + 2 : 0;
    const prefix = declarationEnd > 0 ? `${xml.slice(0, declarationEnd)}\n` : '';
    const body = xml.slice(declarationEnd).replace(/^\s+/, '');
    xml = `${prefix}${value.doctype}\n${body}`;
  }
  if (isEnvelope) {
    let cursor = 0;
    const instructions = processingInstructionsFromNodes(value.nodes);
    xml = xml.replace(/<\?([^?\s]+)\?>/g, (token, target) => {
      if (target.toLowerCase() === 'xml') return token;
      const instruction = instructions[cursor++];
      return instruction?.target === target ? `<?${target}${instruction.data ? ` ${instruction.data}` : ''}?>` : token;
    });
  }
  const validation = Standards.XMLValidator.validate(xml);
  if (validation !== true) throw new Error(`Could not build valid XML: ${validation.err.msg}`);
  return xml;
}
