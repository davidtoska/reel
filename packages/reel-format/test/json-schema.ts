// A minimal JSON Schema (draft 2020-12) evaluator for the tests, so reel-1.schema.json can be checked
// against validateReel without a dependency. It supports exactly the keywords the schema uses and
// throws on any other, so the tests notice when the schema starts using a new one.
//
//   const schema = compileSchema(JSON.parse(text));
//   schema.validate(doc)                        // [] or [{ path: '/slides/0/duration', message: … }]
//   schema.validate('media/a.jpg', '#/$defs/imageSrc')

/** A JSON Schema: an object of keywords, or true/false. */
export type Schema = { [keyword: string]: unknown } | boolean;

/** `path` is a JSON Pointer to the place in the document, e.g. `/slides/0/layers/1`. */
export interface SchemaError { path: string; message: string }

/**
 * How `pattern` is matched. JSON Schema says ECMA-262 with the u flag, but validators in other
 * languages differ, and the schema must give the same result in all of them:
 *  - 'ecma': a JavaScript RegExp with the u flag (Ajv and most JavaScript validators)
 *  - 'no-u': without the u flag (older JavaScript validators)
 *  - 'dollar-newline': `$` also matches before a final newline, as in Python, .NET and PCRE
 */
export type RegexMode = 'ecma' | 'no-u' | 'dollar-newline';

const ASSERTIONS = new Set([
  '$ref', 'type', 'properties', 'required', 'additionalProperties', 'enum', 'const', 'minimum', 'maximum',
  'minLength', 'maxLength', 'pattern', 'items', 'minItems', 'maxItems', 'oneOf', 'not',
]);
const ANNOTATIONS = new Set(['$schema', '$id', '$comment', '$defs', 'title', 'description', 'default', 'examples']);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The JSON type of a value: null, boolean, number, string, array or object. */
export const jsonType = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

const hasType = (v: unknown, type: string) =>
  type === 'integer' ? Number.isInteger(v) : jsonType(v) === type;

/** Equality of JSON values, as `const` and `enum` compare them. */
const equal = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => equal(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && equal(a[k], b[k]));
  }
  return a === b;
};

/** A JSON Pointer segment: `~` and `/` escaped. */
export const pointerSegment = (key: string | number) => {
  const k = String(key);
  return k.includes('~') || k.includes('/') ? k.replace(/~/g, '~0').replace(/\//g, '~1') : k;
};

/** The pattern with every `$` outside a character class also matching before a final newline. */
const dollarBeforeNewline = (pattern: string) => {
  let out = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') { out += c + pattern[++i]; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    out += c === '$' && !inClass ? '(?=\\n?$)' : c;
  }
  return out;
};

export const compileSchema = (root: Schema, mode: RegexMode = 'ecma') => {
  const regexes = new Map<string, RegExp>();
  const regex = (pattern: string) => {
    let r = regexes.get(pattern);
    if (!r) {
      r = mode === 'dollar-newline' ? new RegExp(dollarBeforeNewline(pattern), 'u') : new RegExp(pattern, mode === 'no-u' ? '' : 'u');
      regexes.set(pattern, r);
    }
    return r;
  };

  /** The schema a local `$ref` such as `#/$defs/slide` points to. */
  const resolved = new Map<string, Schema>();
  const resolve = (ref: string): Schema => {
    const known = resolved.get(ref);
    if (known !== undefined) return known;
    if (ref === '#') return root;
    if (!ref.startsWith('#/')) throw new Error(`json-schema: only local $refs are supported, got ${ref}`);
    let node: unknown = root;
    for (const part of ref.slice(2).split('/').map(p => decodeURIComponent(p).replace(/~1/g, '/').replace(/~0/g, '~'))) {
      if (!isObject(node) || !Object.hasOwn(node, part)) throw new Error(`json-schema: $ref ${ref} does not resolve`);
      node = node[part];
    }
    if (typeof node !== 'boolean' && !isObject(node)) throw new Error(`json-schema: $ref ${ref} is not a schema`);
    resolved.set(ref, node);
    return node;
  };

  const supported = new WeakSet<object>();
  const check = (schema: Schema, v: unknown, path: string, errors: SchemaError[]): void => {
    if (schema === true) return;
    const fail = (message: string, at = path) => { errors.push({ path: at, message }); };
    if (schema === false) return fail('not allowed');
    if (!supported.has(schema)) {
      for (const k of Object.keys(schema)) {
        if (!ASSERTIONS.has(k) && !ANNOTATIONS.has(k)) throw new Error(`json-schema: unsupported keyword "${k}"`);
      }
      supported.add(schema);
    }
    const s = schema as {
      $ref?: string; type?: string | string[]; properties?: Record<string, Schema>; required?: string[];
      additionalProperties?: Schema; enum?: unknown[]; const?: unknown; minimum?: number; maximum?: number;
      minLength?: number; maxLength?: number; pattern?: string; items?: Schema; minItems?: number; maxItems?: number;
      oneOf?: Schema[]; not?: Schema;
    };

    if (s.$ref !== undefined) check(resolve(s.$ref), v, path, errors);
    if (s.type !== undefined) {
      const types = [s.type].flat();
      if (!types.some(t => hasType(v, t))) fail(`must be of type ${types.join(' or ')}`);
    }
    if (Object.hasOwn(s, 'const') && !equal(v, s.const)) fail(`must be ${JSON.stringify(s.const)}`);
    if (s.enum !== undefined && !s.enum.some(e => equal(v, e))) fail(`must be one of ${JSON.stringify(s.enum)}`);

    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < s.minimum) fail(`must be ≥ ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) fail(`must be ≤ ${s.maximum}`);
    }
    if (typeof v === 'string') {
      // Lengths count code points, not UTF-16 code units.
      const length = [...v].length;
      if (s.minLength !== undefined && length < s.minLength) fail(`must have at least ${s.minLength} characters`);
      if (s.maxLength !== undefined && length > s.maxLength) fail(`must have at most ${s.maxLength} characters`);
      if (s.pattern !== undefined && !regex(s.pattern).test(v)) fail(`must match ${s.pattern}`);
    }
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) fail(`must have at least ${s.minItems} items`);
      if (s.maxItems !== undefined && v.length > s.maxItems) fail(`must have at most ${s.maxItems} items`);
      if (s.items !== undefined) for (let i = 0; i < v.length; i++) check(s.items, v[i], `${path}/${i}`, errors);
    }
    if (isObject(v)) {
      // A missing field is reported at its own place, an unknown one at the object (as validateReel does).
      for (const k of s.required ?? []) if (!Object.hasOwn(v, k)) fail('required', `${path}/${pointerSegment(k)}`);
      for (const k of Object.keys(v)) {
        const at = `${path}/${pointerSegment(k)}`;
        if (s.properties && Object.hasOwn(s.properties, k)) check(s.properties[k], v[k], at, errors);
        else if (s.additionalProperties === false) fail(`unknown field ${JSON.stringify(k)}`);
        else if (s.additionalProperties !== undefined) check(s.additionalProperties, v[k], at, errors);
      }
    }

    if (s.oneOf !== undefined) {
      const matches = s.oneOf.filter(branch => { const e: SchemaError[] = []; check(branch, v, path, e); return !e.length; }).length;
      if (matches !== 1) fail(`must match exactly one of ${s.oneOf.length} schemas, matches ${matches}`);
    }
    if (s.not !== undefined) {
      const e: SchemaError[] = [];
      check(s.not, v, path, e);
      if (!e.length) fail('must not match the "not" schema');
    }
  };

  /** Every problem with `value`, checked against the schema at `ref` (default: the whole schema). */
  const validate = (value: unknown, ref = '#'): SchemaError[] => {
    const errors: SchemaError[] = [];
    check(resolve(ref), value, '', errors);
    return errors;
  };

  /** Follows `$ref`s and picks the one `oneOf` branch `value` matches, down to plain keywords. */
  const settle = (schema: Schema, value: unknown): Schema => {
    for (;;) {
      if (typeof schema === 'boolean') return schema;
      if (typeof schema.$ref === 'string') {
        if (Object.keys(schema).some(k => k !== '$ref' && ASSERTIONS.has(k))) throw new Error('json-schema: $ref next to other assertions');
        schema = resolve(schema.$ref);
        continue;
      }
      if (Array.isArray(schema.oneOf)) {
        const branches = (schema.oneOf as Schema[]).filter(b => { const e: SchemaError[] = []; check(b, value, '', e); return !e.length; });
        if (branches.length !== 1) throw new Error(`json-schema: the value matches ${branches.length} oneOf branches`);
        schema = branches[0];
        continue;
      }
      return schema;
    }
  };

  /**
   * The schema that applies to the value at `path` in `doc` – `$ref`s followed and `oneOf` branches
   * chosen by the document, which must be valid. Used to derive test cases from the schema.
   */
  const schemaAt = (doc: unknown, path: (string | number)[]): Exclude<Schema, boolean> => {
    let schema = settle(root, doc);
    let value = doc;
    for (const key of path) {
      if (typeof schema === 'boolean') break;
      const next = typeof key === 'number' ? schema.items : (schema.properties as Record<string, Schema> | undefined)?.[key];
      if (next === undefined || !(isObject(value) || Array.isArray(value))) throw new Error(`json-schema: no schema at ${path.join('/')}`);
      value = (value as Record<string | number, unknown>)[key];
      schema = settle(next as Schema, value);
    }
    if (typeof schema === 'boolean') throw new Error(`json-schema: boolean schema at ${path.join('/')}`);
    return schema;
  };

  return { validate, schemaAt, resolve };
};

/** Every `pattern` in a schema, with the JSON Pointer of the schema object that has it. */
export const schemaPatterns = (schema: unknown, at = ''): { at: string; pattern: string }[] => {
  if (Array.isArray(schema)) return schema.flatMap((s, i) => schemaPatterns(s, `${at}/${i}`));
  if (!isObject(schema)) return [];
  return Object.entries(schema).flatMap(([k, v]) => {
    // Values of these keywords are data, not schemas.
    if (k === 'const' || k === 'enum' || k === 'examples' || k === 'default') return [];
    const own = k === 'pattern' && typeof v === 'string' ? [{ at, pattern: v }] : [];
    return [...own, ...schemaPatterns(v, `${at}/${pointerSegment(k)}`)];
  });
};
