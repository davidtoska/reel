// validateReel() and the JSON Schema in reel-schema state the same rules twice. These tests run a
// corpus of documents through both and require the same verdict – except for the rules the schema
// cannot express (the list in the reel-schema README), which only validateReel enforces.
//
// The schema is checked with the small evaluator in json-schema.ts, once for each way validators in
// other languages match `pattern` (see RegexMode), so a Python or Go validator agrees as well.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkMediaSrc, REEL_MEDIA_TYPES, validateReel } from '../src/index.ts';
import { compileSchema, jsonType, pointerSegment, schemaPatterns, type RegexMode, type Schema } from './json-schema.ts';

const schemaJson = JSON.parse(readFileSync(new URL('../../reel-schema/reel-1.schema.json', import.meta.url), 'utf8'));
const MODES: RegexMode[] = ['ecma', 'no-u', 'dollar-newline'];
const schemas = MODES.map(mode => ({ mode, schema: compileSchema(schemaJson, mode) }));
const { schemaAt } = schemas[0].schema;

type Kind = keyof typeof REEL_MEDIA_TYPES;
type Path = (string | number)[];
type Json = any;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A path as validateReel writes it: slides[0].layers[1].src, or "document" for the whole document. */
const pathText = (path: Path) => path.reduce<string>((s, k) => (typeof k === 'number' ? `${s}[${k}]` : s ? `${s}.${k}` : k), '') || 'document';
const pointer = (path: Path) => path.map(k => `/${pointerSegment(k)}`).join('');
const valueAt = (doc: Json, path: Path): Json => path.reduce((v, k) => v?.[k], doc);
/** The place a validateReel error is about: "slides[0].src: required" → ['slides', 0, 'src']. */
const errorPlace = (error: string): Path => {
  const path = error.slice(0, error.indexOf(': '));
  return path === 'document' ? [] : path.replace(/\[(\d+)\]/g, '.$1').split('.').map(k => (/^\d+$/.test(k) ? Number(k) : k));
};
const parsesAsHttps = (src: string) => {
  try { const url = new URL(src); return url.protocol === 'https:' && url.host !== ''; } catch { return false; }
};

/**
 * The rules only validateReel enforces – "Rules the schema cannot express" in the reel-schema README.
 * A document may pass the schema and fail validateReel through these only. `breaks` checks that the
 * value the error is about really breaks the rule, so a real disagreement cannot hide behind one.
 */
const VALIDATE_ONLY: { rule: string; message: RegExp; breaks?: (value: unknown) => boolean }[] = [
  { rule: '1. unique slide ids', message: /^slides\[\d+\]\.id: ".*" is used by an earlier slide$/ },
  { rule: '2. a layer starts within its slide', message: /^slides\[\d+\]\.layers\[\d+\]\.start: must be less than the slide's duration/ },
  { rule: '2. a layer ends after it starts', message: /^slides\[\d+\]\.layers\[\d+\]\.end: must be after start$/ },
  { rule: '2. a layer ends within its slide', message: /^slides\[\d+\]\.layers\[\d+\]\.end: is after the end of the slide/ },
  { rule: '3. an audio clip ends within its slide', message: /^slides\[\d+\]\.audio\[\d+\]: ends after the slide/ },
  { rule: '4. video trimStart < duration', message: /^slides\[\d+\]\.layers\[\d+\]\.trimStart: must be less than duration$/ },
  {
    rule: '5. no percent-encoded dot segments', message: /\.src: must be a clean relative path/,
    breaks: v => typeof v === 'string' && v.split('/').some(p => /%2e/i.test(p) && /^(\.|%2e){1,2}$/i.test(p)),
  },
  { rule: '6. https URLs parse', message: /\.src: must be a valid https:\/\/ URL$/, breaks: v => typeof v === 'string' && !parsesAsHttps(v) },
];
const validateOnlyRule = (doc: Json, error: string) =>
  VALIDATE_ONLY.find(r => r.message.test(error) && (r.breaks?.(valueAt(doc, errorPlace(error))) ?? true));

/** Whether a value is plain JSON: no undefined, NaN, Infinity or holes in lists. */
const isJson = (v: unknown): boolean =>
  v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) ||
  (Array.isArray(v) && Object.keys(v).length === v.length && v.every(isJson)) ||
  (isObj(v) && Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(isJson));

type Verdict = 'valid' | 'invalid' | 'validate-only';

/**
 * Runs a document through validateReel and the schema (with every regex mode) and returns the common
 * verdict. Throws if they disagree, or if both reject it but at unrelated places (then they do not
 * reject it for the same reason).
 */
const judge = (doc: Json, name: string): Verdict => {
  assert.ok(isJson(doc), `${name}: the corpus may hold JSON documents only`);
  const reel = validateReel(doc);
  const verdicts = new Set<Verdict>();
  for (const { mode, schema } of schemas) {
    const errors = schema.validate(doc);
    const where = `${name} (${mode} regexes)`;
    const schemaText = errors.map(e => `${e.path || '/'}: ${e.message}`).join('; ');
    if (reel.ok) {
      assert.equal(schemaText, '', `${where}: validateReel accepts it, the schema does not`);
      verdicts.add('valid');
    } else if (!errors.length) {
      for (const e of reel.errors) assert.ok(validateOnlyRule(doc, e), `${where}: the schema accepts it, validateReel does not: ${e}`);
      verdicts.add('validate-only');
    } else {
      // Both reject it. Every problem one reports must be at, inside or around a place the other reports.
      const related = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
      const places = reel.errors.map(e => pointer(errorPlace(e)));
      for (const e of errors) {
        assert.ok(places.some(p => related(p, e.path)), `${where}: only the schema reports ${e.path || '/'}: ${e.message} (validateReel: ${reel.errors.join('; ')})`);
      }
      for (const e of reel.errors) {
        if (validateOnlyRule(doc, e)) continue;
        assert.ok(errors.some(s => related(pointer(errorPlace(e)), s.path)), `${where}: only validateReel reports ${e} (schema: ${schemaText})`);
      }
      verdicts.add('invalid');
    }
  }
  assert.equal(verdicts.size, 1, `${name}: the regex modes give different verdicts: ${[...verdicts].join(', ')}`);
  return [...verdicts][0];
};

/**
 * A corpus entry. `expect`: 'valid' and 'invalid' mean both validators; 'validate-only' means the
 * schema accepts it and validateReel rejects it by one of the rules above; 'schema-valid' means the
 * schema accepts it (used for generated cases at the end of a range, where a time rule may apply).
 * `message` is an error validateReel must report: exactly this text, or a match.
 */
interface Case { name: string; doc: Json; expect: Verdict | 'schema-valid'; message?: string | RegExp }

/** Checks every case and reports all failures at once. */
const checkCorpus = (cases: Case[]) => {
  const failures: string[] = [];
  for (const c of cases) {
    try {
      const verdict = judge(c.doc, c.name);
      const ok = c.expect === 'schema-valid' ? verdict !== 'invalid' : verdict === c.expect;
      assert.ok(ok, `${c.name}: expected ${c.expect}, got ${verdict}`);
      if (c.message !== undefined) {
        const errors: string[] = validateReel(c.doc).errors;
        const found = typeof c.message === 'string' ? errors.includes(c.message) : errors.some(e => (c.message as RegExp).test(e));
        assert.ok(found, `${c.name}: expected the error ${c.message}, got ${errors.join('; ') || 'none'}`);
      }
    } catch (e) {
      failures.push((e as Error).message.split('\n')[0]);
    }
  }
  assert.deepEqual(failures, [], `${failures.length} of ${cases.length} cases failed`);
  assert.ok(cases.length > 0);
};

// --- The documents ----------------------------------------------------------------------------

/** A valid document that sets every field of the format at least once. */
const FULL = {
  $schema: 'https://unpkg.com/reel-schema@1/reel-1.schema.json',
  format: 'reel/1',
  title: 'Every field',
  description: 'A reel that sets every field of the format once.',
  language: 'en',
  tags: ['test', 'parity'],
  music: { src: 'media/music.mp3', duration: 120, volume: 0.25, duckTo: 0.08 },
  defaults: {
    text: {
      style: {
        font: 'serif', size: 5, weight: 'bold', italic: true, color: '#ffffff', background: '#00000099',
        padding: 1, radius: 1, lineHeight: 1.25, shadow: false,
      },
    },
    transition: { type: 'fade', duration: 1 },
  },
  slides: [
    {
      id: 'one', duration: 10, background: '#112233', transition: { type: 'cut' }, credit: 'Photo: A',
      layers: [
        {
          type: 'image', src: 'media/photo.jpg', x: 0, y: 0, w: 100, h: 100, start: 0, end: 10, fadeIn: 0.5, fadeOut: 0.5,
          opacity: 1, fit: 'cover', alt: 'A photo', motion: { from: { scale: 1, x: 50, y: 50 }, to: { scale: 1.2, x: 40, y: 60 } },
        },
        {
          type: 'video', src: 'https://cdn.example.com/clip.mp4', x: 10, y: 10, w: 50, h: 50, start: 1, end: 9, fadeIn: 0, fadeOut: 0,
          opacity: 0.8, duration: 20, fit: 'contain', trimStart: 2, muted: true, volume: 0.5, loop: false,
        },
        {
          type: 'text', text: 'Hello', x: 5, y: 80, w: 90, h: 15, start: 2, end: 8, fadeIn: 1, fadeOut: 1, opacity: 1,
          align: 'center', valign: 'bottom',
          style: {
            font: 'sans', size: 4, weight: 'regular', italic: false, color: '#FFD27A', background: '#00000000',
            padding: 0, radius: 0, lineHeight: 1, shadow: true,
          },
        },
        {
          type: 'shape', shape: 'rect', x: 5, y: 5, w: 20, h: 20, start: 0, end: 5, fadeIn: 0, fadeOut: 0, opacity: 0.5,
          fill: '#ff000080', stroke: '#ffffff', strokeWidth: 0.5, radius: 2,
        },
      ],
      audio: [{ src: 'media/voice.m4a', start: 1, duration: 5, volume: 1, duck: true, transcript: 'Hello there.' }],
    },
    {
      id: 'two', duration: 5, transition: { type: 'fade', duration: 0.5 },
      layers: [{ type: 'video', src: 'media/clip.MP4', duration: 5 }, { type: 'shape', shape: 'ellipse' }],
    },
  ],
};

/** The smallest valid document. */
const MINIMAL = { format: 'reel/1', title: 'T', slides: [{ id: 'a', duration: 5, layers: [{ type: 'text', text: 'Hi' }] }] };

/** A copy of `doc` with the value at `path` set (or removed, for undefined). */
const withValue = (doc: Json, path: Path, value: unknown): Json => {
  if (!path.length) return value;
  const copy = structuredClone(doc);
  const parent = valueAt(copy, path.slice(0, -1));
  const key = path[path.length - 1];
  if (value === undefined) delete parent[key];
  else parent[key] = value;
  return copy;
};

/** Every place in a JSON value as [path, value], parents first. */
const places = (v: Json, path: Path = []): [Path, Json][] => [
  [path, v],
  ...(Array.isArray(v) ? v.flatMap((x, i) => places(x, [...path, i])) : isObj(v) ? Object.entries(v).flatMap(([k, x]) => places(x, [...path, k])) : []),
];

/** The JSON types a schema allows. */
const allowedTypes = (s: Exclude<Schema, boolean>): string[] => {
  if (s.type !== undefined) return [s.type as string | string[]].flat().map(t => (t === 'integer' ? 'number' : t));
  if (Object.hasOwn(s, 'const')) return [jsonType(s.const)];
  if (Array.isArray(s.enum)) return [...new Set(s.enum.map(jsonType))];
  return ['null', 'boolean', 'number', 'string', 'array', 'object'];
};

/**
 * Cases derived from the schema for every place in a valid document: wrong types, unknown and missing
 * fields, both ends of every range and just outside them, lengths in code points, every enum value,
 * and list lengths. The expected verdict comes from the schema's keywords; validateReel must agree.
 */
const derivedCases = (base: Json, baseName: string): Case[] => {
  const cases: Case[] = [];
  const add = (path: Path, what: string, value: unknown, expect: Case['expect'], message?: Case['message']) => {
    cases.push({ name: `${baseName}: ${pathText(path)} ${what}`, doc: withValue(base, path, value), expect, message });
  };
  for (const [path, value] of places(base)) {
    const s = schemaAt(base, path);
    const at = pathText(path);
    const types = allowedTypes(s);
    for (const wrong of [null, true, 1, 'x', [], {}]) {
      if (!types.includes(jsonType(wrong))) add(path, `= ${JSON.stringify(wrong)}`, wrong, 'invalid');
    }

    if (isObj(value)) {
      add([...path, 'zz'], '(unknown field)', 1, 'invalid', `${at}: unknown field "zz"`);
      const known = Object.keys(value).find(k => k.toUpperCase() !== k);
      if (known) {
        const upper = known.toUpperCase();
        add([...path, upper], '(field in the wrong case)', value[known], 'invalid', `${at}: unknown field "${upper}" – did you mean "${known}"?`);
      }
      const required = (s.required as string[] | undefined) ?? [];
      for (const k of Object.keys(value)) add([...path, k], 'left out', undefined, required.includes(k) ? 'invalid' : 'schema-valid');
    }

    if (typeof value === 'number') {
      const { minimum: min, maximum: max } = s as { minimum?: number; maximum?: number };
      const range = `${at}: must be ${min}–${max}`;
      if (min !== undefined) {
        add(path, `= ${min} (minimum)`, min, 'schema-valid');
        add(path, `= ${min} - 0.001`, min - 0.001, 'invalid', range);
      }
      if (max !== undefined) {
        add(path, `= ${max} (maximum)`, max, 'schema-valid');
        add(path, `= ${max} + 0.001`, max + 0.001, 'invalid', range);
      }
    }

    // Strings with a pattern (colours, media) have their own lists below.
    if (typeof value === 'string' && s.pattern === undefined && !Object.hasOwn(s, 'const') && s.enum === undefined) {
      add(path, '= ""', '', (s.minLength as number) > 0 ? 'invalid' : 'schema-valid');
      const max = s.maxLength as number | undefined;
      if (max !== undefined) {
        // An emoji is one code point but two UTF-16 code units.
        add(path, `= ${max} emoji`, '😀'.repeat(max), 'schema-valid');
        add(path, `= ${max + 1} emoji`, '😀'.repeat(max + 1), 'invalid', `${at}: at most ${max} characters`);
      }
    }
    if (Array.isArray(s.enum)) {
      for (const e of s.enum) add(path, `= ${JSON.stringify(e)}`, e, 'schema-valid');
      add(path, '= "nope"', 'nope', 'invalid');
      const upper = String(value).toUpperCase();
      if (!s.enum.includes(upper)) add(path, `= ${JSON.stringify(upper)}`, upper, 'invalid');
    }
    if (Object.hasOwn(s, 'const')) {
      add(path, '(upper case)', String(value).toUpperCase(), 'invalid');
      add(path, '(with a space)', `${value} `, 'invalid');
    }

    if (Array.isArray(value) && value.length) {
      // Copies of the items; slides get their own ids.
      const fill = (n: number) => Array.from({ length: n }, (_, i) => {
        const item = structuredClone(value[i % value.length]);
        if (isObj(item) && typeof item.id === 'string') item.id = `${item.id}-${i}`;
        return item;
      });
      const min = (s.minItems as number | undefined) ?? 0;
      const max = s.maxItems as number | undefined;
      if (min > 0) add(path, `with ${min - 1} items`, fill(min - 1), 'invalid');
      add(path, `with ${min} items`, fill(min), 'schema-valid');
      if (max !== undefined) {
        add(path, `with ${max} items`, fill(max), 'schema-valid');
        add(path, `with ${max + 1} items`, fill(max + 1), 'invalid');
      }
      add(path, 'with a null item', [...value, null], 'invalid');
    }
  }
  return cases;
};

/**
 * Colours to try at every colour field. Without the schema's newline guard, `#ffffff\n` would pass
 * `^…$` in Python, .NET and PCRE (the dollar-newline regex mode).
 */
const COLORS: [unknown, Verdict, string?][] = [
  ['#ffffff', 'valid'], ['#FFFFFF', 'valid'], ['#AbCdEf', 'valid'], ['#00000099', 'valid'], ['#FFFFFF00', 'valid'],
  ['#fff', 'invalid', 'must be #rrggbb or #rrggbbaa – use "#ffffff"'], ['#ABcd', 'invalid', 'must be #rrggbb or #rrggbbaa – use "#AABBccdd"'],
  ['#fffff', 'invalid'], ['#fffffff', 'invalid'], ['#fffffffff', 'invalid'], ['ffffff', 'invalid'], ['##ffffff', 'invalid'],
  ['#', 'invalid'], ['', 'invalid'], ['white', 'invalid'], ['rgb(0, 0, 0)', 'invalid'], ['#gggggg', 'invalid'],
  ['#ffffff\n', 'invalid'], ['#ffffff\r\n', 'invalid'], ['\n#ffffff', 'invalid'], ['#ffffff ', 'invalid'], [' #ffffff', 'invalid'],
  ['#ffffff\u0000', 'invalid'], ['#ＦＦＦＦＦＦ', 'invalid'], [0xffffff, 'invalid'],
];

type SrcCase = [string, Verdict, (string | RegExp)?];
const each = (verdict: Verdict, srcs: string[], message?: RegExp): SrcCase[] => srcs.map(src => [src, verdict, message]);

/** Media sources that depend on the extension, for each extension of each use. */
const extensionCases = (ext: string): SrcCase[] => {
  const mixed = [...ext].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join('');
  const long = (n: number) => `media/${'😀'.repeat(n - 7 - ext.length)}.${ext}`;
  return [
    ...each('valid', [`media/a.${ext}`, `media/A.${ext.toUpperCase()}`, `media/a.${mixed}`, `media/sub/dir/a.${ext}`, long(2000)]),
    ...each('invalid', [`media/a.${ext}?v=1`, `media/a.${ext}#t`, `media/a.${ext}.`, `media/a.${ext} `, `media/a ${ext}`, `media/a${ext}`, `media/a.${ext}\n`, long(2001)]),
  ];
};

/** Media sources for a use, with `ext` as the use's extension where one is needed. */
const srcCases = (kind: Kind, ext: string): SrcCase[] => {
  const others = Object.values(REEL_MEDIA_TYPES).flatMap(t => Object.keys(t)).filter(e => !Object.hasOwn(REEL_MEDIA_TYPES[kind], e));
  const notMedia = new RegExp(`put the file under media/ \\(e\\.g\\. media/\\w+\\.${kind === 'image' ? 'jpg' : kind === 'audio' ? 'mp3' : 'mp4'}\\)$`);
  return [
    // Relative paths (decision 3).
    ...each('valid', [
      `media/a%20b.${ext}`, `media/100%.${ext}`, `media/%zz.${ext}`, `media/my photo.${ext}`, `media/blåbær.${ext}`, `media/😀.${ext}`,
      `media/.hidden.${ext}`, `media/.a/b.${ext}`, `media/..a/b.${ext}`, `media/.../b.${ext}`, `media/a..${ext}`, `media/.${ext}`,
      `media/%2e%2ex.${ext}`, `media/%2e%2e%2e/x.${ext}`, `media/x%2e/a.${ext}`, `media/\u0080.${ext}`, `media/a\u2028b.${ext}`, `media/C:/a.${ext}`,
    ]),
    ...each('invalid', [
      '', 'media/', 'media', `Media/a.${ext}`, `MEDIA/a.${ext}`, `/media/a.${ext}`, `./media/a.${ext}`, `media/./a.${ext}`, `media/../a.${ext}`,
      `media/a/../../b.${ext}`, 'media/a/..', `media//a.${ext}`, `media/a//b.${ext}`, `media/a.${ext}/`, `media/a?b.${ext}`, `media/a#b.${ext}`,
      `media\\a.${ext}`, `media/a\\b.${ext}`, `media/a\u0000.${ext}`, `media/a\u001f.${ext}`, `media/a\u007f.${ext}`, `media/a\tb.${ext}`,
      `media/a\nb.${ext}`, `media/a.${ext}\r`, 'media/a', 'media/a.', `C:\\a.${ext}`, `file:///a.${ext}`, 'data:image/png;base64,AAAA',
      `//cdn.example.com/a.${ext}`,
    ]),
    ...each('invalid', [`images/a.${ext}`, `a.${ext}`, `../a.${ext}`], notMedia),
    ...[...others, 'bmp', 'txt', 'constructor', '__proto__', 'toString', 'hasOwnProperty'].map(e =>
      [`media/a.${e}`, 'invalid', new RegExp(`\\.src: \\.${e} is not ${kind === 'image' ? 'an' : 'a'} ${kind} type`, 'i')] as SrcCase),
    // Percent-encoded dot segments: only validateReel can see them (README rule 5).
    ...each('validate-only', [
      `media/%2e%2e/a.${ext}`, `media/%2E%2E/a.${ext}`, `media/%2e/a.${ext}`, `media/.%2e/a.${ext}`, `media/%2e./a.${ext}`, `media/x/%2e%2e/%2e%2e/a.${ext}`,
    ]),
    // https URLs (decision 4): any path, no extension check.
    ...each('valid', [
      `https://example.com/a.${ext}`, 'https://cdn.example.com', 'https://example.com', 'https://example.com/', 'https://example.com/render.php?id=3',
      'https://example.com/a.bmp', 'https://example.com/a', `https://example.com/a.${ext.toUpperCase()}#x`, 'https://example.com/a%20b',
      'https://user:pw@example.com/a', 'https://[::1]/a', 'https://127.0.0.1:8443/a', 'https://bücher.example/a', 'https://example.com?x',
      'https://example.com#x', `https://example.com/${'a'.repeat(1980)}`,
      // Only ASCII spaces and controls are refused; other characters (also U+00A0) are percent-encoded by URL parsers.
      'https://example.com/a\u00a0',
    ]),
    ...each('invalid', [
      'https://', 'https:///a', 'https://?x', 'https://#x', 'https://exa mple.com/a', 'https://example.com/a b', 'https://example.com/a\n',
      'https://example.com/\ta', `https://example.com/${'a'.repeat(1981)}`, 'https:/example.com/a',
      'https:example.com/a', 'ftp://example.com/a', 'wss://example.com/a', ' https://example.com/a',
    ]),
    ...each('invalid', ['http://example.com/a', 'HTTPS://example.com/a', 'Https://example.com/a', 'http:/example.com/a'], /– use https:\/\/$/),
    // URLs with the right shape that do not parse: only validateReel can see them (README rule 6).
    ...each('validate-only', ['https://example.com:99999/a', 'https://exa[mple.com/a', 'https://[::1/a', 'https://%/a', 'https://exa%00mple.com/a', 'https://a:b:c/']),
  ];
};

/** The cases of a list applied at every place in `base` whose schema is `def`. */
const casesAt = (base: Json, baseName: string, def: Schema, list: (SrcCase | [unknown, Verdict, string?])[]): Case[] =>
  places(base).filter(([path]) => schemaAt(base, path) === def).flatMap(([path]) => list.map(([value, expect, message]) => ({
    name: `${baseName}: ${pathText(path)} = ${JSON.stringify(value)}`,
    doc: withValue(base, path, value),
    expect,
    message: typeof message === 'string' ? `${pathText(path)}: ${message}` : message,
  })));

/** A case changing a copy of FULL. */
const change = (name: string, expect: Verdict, edit: (d: Json) => void, message?: string | RegExp): Case => {
  const doc = structuredClone(FULL) as Json;
  edit(doc);
  return { name, doc, expect, message };
};

// --- The tests --------------------------------------------------------------------------------

test('the test documents are valid', () => {
  assert.deepEqual(validateReel(FULL).errors, []);
  assert.deepEqual(validateReel(MINIMAL).errors, []);
  for (const { mode, schema } of schemas) {
    assert.deepEqual(schema.validate(FULL), [], mode);
    assert.deepEqual(schema.validate(MINIMAL), [], mode);
  }
});

test('parity: cases derived from the schema at every place of a document', () => {
  checkCorpus([...derivedCases(FULL, 'full'), ...derivedCases(MINIMAL, 'minimal')]);
});

test('parity: colours', () => {
  checkCorpus(casesAt(FULL, 'full', schemaJson.$defs.color, COLORS));
});

test('parity: media sources', () => {
  for (const kind of ['image', 'audio', 'video'] as const) {
    const exts = Object.keys(REEL_MEDIA_TYPES[kind]);
    checkCorpus(casesAt(FULL, 'full', schemaJson.$defs[`${kind}Src`], [...srcCases(kind, exts[0]), ...exts.flatMap(extensionCases)]));
  }
});

test('parity: unknown fields, $schema and the fields of other layer types (decision 1)', () => {
  const layer = (i: number, field: string, value: unknown) =>
    change(`layer ${i} with ${field}`, 'invalid', d => { d.slides[0].layers[i][field] = value; }, `slides[0].layers[${i}]: unknown field "${field}"`);
  checkCorpus([
    change('$schema as text', 'valid', d => { d.$schema = 'anything'; }),
    change('$schema empty', 'valid', d => { d.$schema = ''; }),
    change('$schema left out', 'valid', d => { delete d.$schema; }),
    change('$schema not text', 'invalid', d => { d.$schema = 1; }, '$schema: must be text'),
    change('$schema on a slide', 'invalid', d => { d.slides[0].$schema = 'x'; }, 'slides[0]: unknown field "$schema"'),
    change('$schema in music', 'invalid', d => { d.music.$schema = 'x'; }, 'music: unknown field "$schema"'),
    change('misspelled slide field', 'invalid', d => { d.slides[0].durration = 5; }, 'slides[0]: unknown field "durration" – did you mean "duration"?'),
    change('misspelled style field', 'invalid', d => { d.defaults.text.style.colour = '#ffffff'; }, 'defaults.text.style: unknown field "colour" – did you mean "color"?'),
    change('title in the wrong case', 'invalid', d => { d.Title = 'x'; }, 'document: unknown field "Title" – did you mean "title"?'),
    change('fields of another layer type', 'invalid', d => { d.slides[0].layers[2].src = 'media/a.jpg'; }, 'slides[0].layers[2]: unknown field "src"'),
    layer(0, 'text', 'x'), layer(0, 'duration', 5), layer(1, 'motion', { from: {}, to: {} }), layer(1, 'alt', 'x'),
    layer(2, 'fit', 'cover'), layer(3, 'style', {}), layer(3, 'id', 'x'), layer(0, 'fontSize', 5), layer(0, 'zIndex', 1),
    // Keys that are names of Object.prototype members.
    ...['__proto__', 'constructor', 'toString', 'hasOwnProperty'].flatMap(key => [
      { name: `document with ${key}`, doc: JSON.parse(JSON.stringify(FULL).replace('{', `{"${key}": {"x": 1},`)), expect: 'invalid' as const, message: `document: unknown field "${key}"` },
      { name: `layer with ${key}`, doc: JSON.parse(JSON.stringify(FULL).replace('{"type":"image"', `{"${key}": 1, "type":"image"`)), expect: 'invalid' as const },
    ]),
  ]);
});

test('parity: transitions (decision 2)', () => {
  const cases: Case[] = [];
  for (const at of ['defaults', 'slides.0', 'slides.1'] as const) {
    const set = (value: unknown, expect: Verdict, message?: string | RegExp) => {
      const path = [...at.split('.').map(k => (/^\d+$/.test(k) ? Number(k) : k)), 'transition'];
      cases.push({ name: `${pathText(path)} = ${JSON.stringify(value)}`, doc: withValue(FULL, path, value), expect, message: typeof message === 'string' ? `${pathText(path)}${message}` : message });
    };
    for (const t of [{ type: 'fade' }, { type: 'fade', duration: 0 }, { type: 'fade', duration: 5 }, { type: 'fade', duration: 2.5 }, { type: 'cut' }]) set(t, 'valid');
    set({}, 'invalid', '.type: required – fade or cut');
    set({ duration: 1 }, 'invalid', '.type: required – fade or cut');
    set({ type: 'cut', duration: 1 }, 'invalid', ': unknown field "duration"');
    set({ type: 'cut', duration: undefined }, 'valid');
    set({ type: 'fade', duration: 5.001 }, 'invalid', '.duration: must be 0–5');
    set({ type: 'fade', duration: -0.001 }, 'invalid');
    set({ type: 'fade', duration: '1' }, 'invalid');
    set({ type: 'fade', ease: 'in' }, 'invalid', ': unknown field "ease"');
    for (const type of ['wipe', 'Fade', 'CUT', '', null, 1]) set({ type }, 'invalid');
    for (const t of ['fade', 'cut', null, [], true, 1]) set(t, 'invalid', ': must be an object like { "type": "fade", "duration": 1 } or { "type": "cut" }');
  }
  // JSON drops a field set to undefined; the case above checks the JSON form.
  for (const c of cases) c.doc = JSON.parse(JSON.stringify(c.doc));
  checkCorpus(cases);
});

test('parity: lengths in code points (decision 5)', () => {
  checkCorpus([
    change('title of 120 emoji', 'valid', d => { d.title = '😀'.repeat(120); }),
    change('title of 121 emoji', 'invalid', d => { d.title = '😀'.repeat(121); }, 'title: at most 120 characters'),
    change('title of 60 letters with combining accents (120 code points)', 'valid', d => { d.title = 'e\u0301'.repeat(60); }),
    change('title of 61 letters with combining accents (122 code points)', 'invalid', d => { d.title = 'e\u0301'.repeat(61); }),
    change('title of 120 lone surrogates', 'valid', d => { d.title = '\ud800'.repeat(120); }),
    change('title of 121 lone surrogates', 'invalid', d => { d.title = '\ud800'.repeat(121); }),
    change('tag of 40 emoji', 'valid', d => { d.tags = ['🦊'.repeat(40)]; }),
    change('tag of 41 emoji', 'invalid', d => { d.tags = ['🦊'.repeat(41)]; }, 'tags[0]: at most 40 characters'),
  ]);
});

test('parity: lists, values and documents of the wrong kind (decisions 6–8)', () => {
  checkCorpus([
    ...[null, [], 'reel', 1, true].map(doc => ({ name: `document = ${JSON.stringify(doc)}`, doc, expect: 'invalid' as const, message: 'document: must be a JSON object' })),
    { name: 'empty document', doc: {}, expect: 'invalid' },
    change('tags not a list', 'invalid', d => { d.tags = 'travel'; }, 'tags: must be a list of texts'),
    change('21 tags', 'invalid', d => { d.tags = Array(21).fill('t'); }, 'tags: at most 20 tags'),
    change('the same tag twice', 'valid', d => { d.tags = ['a', 'a']; }),
    change('an empty tag', 'invalid', d => { d.tags = ['a', '']; }, 'tags[1]: required'),
    change('no audio clips', 'valid', d => { d.slides[0].audio = []; }),
    change('a null slide', 'invalid', d => { d.slides.push(null); }, 'slides[2]: must be an object'),
    change('empty motion points', 'valid', d => { d.slides[0].layers[0].motion = { from: {}, to: {} }; }),
    change('motion without to', 'invalid', d => { delete d.slides[0].layers[0].motion.to; }, 'slides[0].layers[0].motion: needs both from and to'),
    change('empty motion', 'invalid', d => { d.slides[0].layers[0].motion = {}; }),
    change('a shape without shape', 'invalid', d => { delete d.slides[0].layers[3].shape; }, 'slides[0].layers[3].shape: required'),
    change('a video without duration', 'invalid', d => { delete d.slides[0].layers[1].duration; }, 'slides[0].layers[1].duration: required'),
    change('an unknown layer type', 'invalid', d => { d.slides[0].layers[0].type = 'audio'; }, 'slides[0].layers[0].type: must be image, video, text, shape'),
    change('a layer without type', 'invalid', d => { delete d.slides[0].layers[2].type; }),
    change('format reel/2', 'invalid', d => { d.format = 'reel/2'; }, 'format: must be "reel/1"'),
    change('a very large number', 'invalid', d => { d.slides[0].duration = 1e300; }, 'slides[0].duration: must be 1–600'),
    change('a very small number', 'invalid', d => { d.slides[0].layers[0].opacity = -1e-300; }),
    change('a tiny positive number', 'valid', d => { d.slides[0].layers[0].opacity = 1e-300; }),
  ]);
});

test('validate-only: the rules the schema cannot express', () => {
  const only = (name: string, edit: (d: Json) => void, message: string | RegExp) => change(name, 'validate-only', edit, message);
  checkCorpus([
    only('two slides with one id', d => { d.slides[1].id = 'one'; }, 'slides[1].id: "one" is used by an earlier slide'),
    only('a layer starting at the end of the slide', d => { d.slides[0].layers[2].start = 10; }, "slides[0].layers[2].start: must be less than the slide's duration (10 s)"),
    only('a layer ending where it starts', d => { d.slides[0].layers[2].end = 2; }, 'slides[0].layers[2].end: must be after start'),
    only('a layer ending after the slide', d => { d.slides[0].layers[2].end = 10.06; }, 'slides[0].layers[2].end: is after the end of the slide (10 s)'),
    change('a layer ending within the 0.05 s tolerance', 'valid', d => { d.slides[0].layers[2].end = 10.05; }),
    change('a layer starting at 0 with end 0', 'validate-only', d => { d.slides[0].layers[3].end = 0; }, 'slides[0].layers[3].end: must be after start'),
    only('an audio clip ending after the slide', d => { d.slides[0].audio[0].duration = 9.1; }, /^slides\[0\]\.audio\[0\]: ends after the slide: start \+ duration = 10\.1 s/),
    change('an audio clip ending within the tolerance', 'valid', d => { d.slides[0].audio[0].duration = 9.05; }),
    only('trimStart at the end of the video', d => { d.slides[0].layers[1].trimStart = 20; }, 'slides[0].layers[1].trimStart: must be less than duration'),
    only('a %2e%2e segment', d => { d.music.src = 'media/%2e%2e/music.mp3'; }, /^music\.src: must be a clean relative path/),
    only('an https URL with a bad port', d => { d.slides[0].layers[1].src = 'https://cdn.example.com:70000/clip.mp4'; }, 'slides[0].layers[1].src: must be a valid https:// URL'),
  ]);
});

test('JavaScript arrays with holes are errors (decision 6); JSON turns them into null', () => {
  for (const [path, value] of places(FULL)) {
    if (!Array.isArray(value)) continue;
    const doc = withValue(FULL, path, [...value]);
    valueAt(doc, path).length = value.length + 1;
    const errors: string[] = validateReel(doc).errors;
    assert.ok(errors.includes(`${pathText(path)}[${value.length}]: missing`), pathText(path));
    assert.equal(judge(JSON.parse(JSON.stringify(doc)), `${pathText(path)} with null`), 'invalid');
  }
});

test('media sources: checkMediaSrc and the schema agree on random strings', () => {
  // A seeded generator (mulberry32), so a failure can be reproduced.
  let seed = 0x5eed;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const starts = ['media/', 'media/', 'media/', 'https://', 'https://', 'http://', 'HTTPS://', 'media', '/', '', 'https:/'];
  const parts = [
    'a', 'Z', '0', '-', '_', '/', '//', '.', '..', '...', '%2e', '%2E', '%', '%20', '%00', '?', '#', '\\', ' ', '\n', '\t', '\r',
    '\u0000', '\u001f', '\u007f', '\u0080', '\u00a0', '\u2028', 'é', 'e\u0301', '😀', 'example.com', 'x.y', ':', ':99999', ':443',
    '@', '[', ']', '[::1]', '&', '=', '+', '~', '!', "'", '"', '<', '>',
  ];
  const ends = [
    '.jpg', '.JPG', '.Jpeg', '.png', '.webp', '.svg', '.gif', '.mp3', '.M4a', '.aac', '.wav', '.mp4', '.MP4', '.mov', '.txt',
    '.constructor', '.', '', '', '/',
  ];
  const differences = new Map<string, string>();
  for (let i = 0; i < 20_000; i++) {
    let src = pick(starts);
    for (let n = Math.floor(random() * 6); n > 0; n--) src += pick(parts);
    src += pick(ends);
    for (const kind of ['image', 'audio', 'video'] as const) {
      const problem = checkMediaSrc(src, kind);
      for (const { mode, schema } of schemas) {
        const schemaOk = schema.validate(src, `#/$defs/${kind}Src`).length === 0;
        if (problem === null && !schemaOk) differences.set(`${JSON.stringify(src)} ${kind} ${mode}`, 'only the schema rejects it');
        if (problem !== null && schemaOk && !validateOnlyRule({ x: { src } }, `x.src: ${problem}`)) {
          differences.set(`${JSON.stringify(src)} ${kind} ${mode}`, `only checkMediaSrc rejects it: ${problem}`);
        }
      }
    }
  }
  assert.deepEqual(Object.fromEntries([...differences].slice(0, 20)), {});
});

test('the rules only validateReel enforces are the ones the reel-schema README lists', () => {
  const readme = readFileSync(new URL('../../reel-schema/README.md', import.meta.url), 'utf8');
  const section = /^## Rules the schema cannot express\n([\s\S]*?)^## /m.exec(readme);
  assert.ok(section, 'the section was not found');
  const listed = [...section[1].matchAll(/^(\d+)\. /gm)].map(m => m[1]);
  assert.deepEqual([...new Set(VALIDATE_ONLY.map(r => r.rule.split('.')[0]))], listed);
});

test('schema patterns compile in RE2 (Go) and are anchored', () => {
  const patterns = schemaPatterns(schemaJson);
  assert.ok(patterns.length >= 4);
  for (const { at, pattern } of patterns) {
    // RE2 has no lookaround and no backreferences.
    assert.doesNotMatch(pattern, /\(\?<?[=!]/, `${at}: lookaround`);
    assert.doesNotMatch(pattern, /\\[1-9]|\\k</, `${at}: backreference`);
    // Shorthands such as \s and \w mean different things in ECMA, RE2, Java and Python – spell classes out.
    assert.doesNotMatch(pattern, /\\[sSdDwWbB]/, `${at}: engine-dependent shorthand`);
    for (const flags of ['', 'u']) assert.doesNotThrow(() => new RegExp(pattern, flags), `${at} /${flags}`);
    // JSON Schema patterns are not anchored by themselves. The newline guards are the exception.
    if (!at.endsWith('/not')) assert.ok(pattern.startsWith('^') && pattern.endsWith('$'), `${at}: not anchored`);
  }
});

test('the src patterns allow exactly the extensions in REEL_MEDIA_TYPES', () => {
  for (const kind of ['image', 'audio', 'video'] as const) {
    const pattern: string = schemaJson.$defs[`${kind}Src`].pattern;
    // The last group: \.([jJ][pP][gG]|…) – one alternative per extension, each letter in both cases.
    const group = /\\\.\(([^()]*)\)\)\$$/.exec(pattern);
    assert.ok(group, `${kind}: the extension group was not found`);
    const exts = group[1].split('|').map(alt => {
      assert.match(alt, /^(\[[a-z][A-Z]\]|[0-9])+$/, `${kind}: ${alt}`);
      return alt.replace(/\[([a-z])[A-Z]\]/g, '$1');
    });
    assert.deepEqual(exts.sort(), Object.keys(REEL_MEDIA_TYPES[kind]).sort(), kind);
    for (const alt of group[1].split('|')) for (const [, lower, upper] of alt.matchAll(/\[([a-z])([A-Z])\]/g)) assert.equal(lower.toUpperCase(), upper, alt);
  }
});

test('the test evaluator implements the keywords it claims', () => {
  const { validate } = compileSchema({
    type: 'object', additionalProperties: false, required: ['a'],
    properties: {
      a: { type: 'string', minLength: 2, maxLength: 3, pattern: '^x' },
      b: { type: 'array', minItems: 1, maxItems: 2, items: { $ref: '#/$defs/n' } },
      c: { oneOf: [{ const: 1 }, { enum: [1, 2] }] },
      d: { not: { type: 'string' } },
    },
    $defs: { n: { type: 'number', minimum: 0, maximum: 1 } },
  });
  assert.deepEqual(validate({ a: 'x😀😀', b: [0, 1] }), []);
  assert.deepEqual(validate({ a: 'x😀😀😀' }).map(e => e.message), ['must have at most 3 characters']);
  assert.deepEqual(validate({ a: 'yy', b: [2], c: 1, d: 's', e: 0, constructor: 0 }).map(e => `${e.path} ${e.message}`), [
    '/a must match ^x', '/b/0 must be ≤ 1', '/c must match exactly one of 2 schemas, matches 2',
    '/d must not match the "not" schema', ' unknown field "e"', ' unknown field "constructor"',
  ]);
  assert.deepEqual(validate([]).map(e => e.message), ['must be of type object']);
  assert.deepEqual(validate({}).map(e => `${e.path} ${e.message}`), ['/a required']);
  assert.throws(() => compileSchema({ uniqueItems: true }).validate([]), /unsupported keyword "uniqueItems"/);
  assert.throws(() => compileSchema({ $ref: 'https://example.com/s.json' }).validate(1), /only local \$refs/);
});
