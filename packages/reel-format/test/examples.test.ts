// The documents people and AI agents copy must stay valid: the files in reel-schema/examples, every
// reel/1 document in the READMEs and the authoring guide, the examples and defaults inside the JSON
// Schema, and the error messages the guide quotes.

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readReelPackage, reelMediaRefs, validateReel, writeReelPackage, type Reel } from '../src/index.ts';
import { compileSchema, pointerSegment } from './json-schema.ts';

const repo = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repo), 'utf8');
const schemaJson = JSON.parse(read('packages/reel-schema/reel-1.schema.json'));
const schemas = (['ecma', 'no-u', 'dollar-newline'] as const).map(mode => ({ mode, schema: compileSchema(schemaJson, mode) }));

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Fails unless validateReel and the schema (with every regex mode) accept the document. */
const assertValid = (doc: unknown, name: string) => {
  assert.deepEqual(validateReel(doc).errors, [], `${name}: validateReel`);
  for (const { mode, schema } of schemas) assert.deepEqual(schema.validate(doc), [], `${name}: schema (${mode} regexes)`);
};

test('the example documents in reel-schema/examples are valid and can be packaged', async () => {
  const dir = 'packages/reel-schema/examples/';
  const files = readdirSync(new URL(dir, repo)).filter(f => f.endsWith('.json'));
  assert.ok(files.length >= 3, files.join());
  for (const file of files) {
    const doc = JSON.parse(read(dir + file));
    assertValid(doc, file);
    assert.equal(doc.$schema, schemaJson.$id, `${file}: $schema should be the schema's $id`);
    // A package with a file for every reference reads back as the same document, without warnings.
    const reel = doc as Reel;
    const media = Object.fromEntries(reelMediaRefs(reel).map(path => [path, new TextEncoder().encode(path)]));
    const r = await readReelPackage(writeReelPackage(reel, media));
    assert.equal(r.ok, true, `${file}: ${r.errors.join('; ')}`);
    if (r.ok) {
      assert.deepEqual(r.reel, doc, file);
      assert.deepEqual(r.warnings, [], file);
    }
  }
});

/** The Markdown files of the repository that are published or shown on GitHub. */
const markdownFiles = () => [
  'README.md',
  'packages/reel-schema/GUIDE.md',
  ...readdirSync(new URL('packages/', repo)).map(p => `packages/${p}/README.md`),
  ...readdirSync(new URL('examples/', repo)).map(p => `examples/${p}/README.md`),
].filter(path => existsSync(new URL(path, repo)));

/** Fenced code blocks of a Markdown text, also indented ones (in lists). */
const codeBlocks = (markdown: string) =>
  [...markdown.matchAll(/^([ \t]*)```(\w*)[^\n]*\n([\s\S]*?)\n\1```/gm)].map(m => ({ lang: m[2], code: m[3], line: markdown.slice(0, m.index).split('\n').length }));

/**
 * The reel/1 documents in a Markdown text: ```json blocks (whole documents, or recipes – one slide,
 * or a fragment with `slides` – which are wrapped into a document) and JSON sent with `curl -d '…'`.
 */
const documentsIn = (markdown: string, file: string) => {
  const docs: { name: string; doc: unknown }[] = [];
  for (const { lang, code, line } of codeBlocks(markdown)) {
    const name = `${file}:${line}`;
    if (lang === 'json') {
      let block: unknown;
      assert.doesNotThrow(() => { block = JSON.parse(code); }, `${name}: a json block that is not JSON`);
      assert.ok(isObj(block), `${name}: a json block that is not an object`);
      if ('format' in block) docs.push({ name, doc: block });
      else if ('id' in block && 'layers' in block) docs.push({ name, doc: { format: 'reel/1', title: 'Recipe', slides: [block] } });
      else if ('slides' in block) docs.push({ name, doc: { format: 'reel/1', title: 'Recipe', ...block } });
      // Editor settings, not a reel. Any other kind of block needs a rule here.
      else assert.ok('json.schemas' in block, `${name}: a json block of an unknown kind – teach examples.test.ts about it`);
    } else if (lang === 'bash' || lang === 'sh') {
      for (const [, payload] of code.matchAll(/-d '([^']*)'/g)) {
        if (!payload.includes('"format": "reel/1"')) continue;
        const body = JSON.parse(payload);
        docs.push({ name, doc: isObj(body) && isObj(body.document) ? body.document : body });
      }
    }
  }
  return docs;
};

test('every reel/1 document in the READMEs and the authoring guide is valid', () => {
  let count = 0;
  for (const file of markdownFiles()) {
    const markdown = read(file);
    const docs = documentsIn(markdown, file);
    if (markdown.includes('"format": "reel/1"')) assert.ok(docs.length > 0, `${file}: has reel/1 documents, but none were found`);
    for (const { name, doc } of docs) assertValid(doc, name);
    count += docs.length;
  }
  // The root README, the schema README, the studio README and the guide (with its 8 recipes).
  assert.ok(count >= 12, `only ${count} documents found`);
});

/** Every schema object with `examples` or `default`, with its JSON Pointer. */
const annotated = (schema: unknown, at = ''): { at: string; values: unknown[]; keyword: string }[] => {
  if (Array.isArray(schema)) return schema.flatMap((s, i) => annotated(s, `${at}/${i}`));
  if (!isObj(schema)) return [];
  const own = [
    ...(Array.isArray(schema.examples) ? [{ at, values: schema.examples, keyword: 'examples' }] : []),
    ...(Object.hasOwn(schema, 'default') ? [{ at, values: [schema.default], keyword: 'default' }] : []),
  ];
  return [...own, ...Object.entries(schema).flatMap(([k, v]) =>
    (k === 'examples' || k === 'default' || k === 'const' || k === 'enum' ? [] : annotated(v, `${at}/${pointerSegment(k)}`)))];
};

test('the examples and defaults in the schema are valid for their own field', () => {
  const found = annotated(schemaJson);
  assert.ok(found.length >= 10);
  for (const { at, values, keyword } of found) {
    for (const value of values) {
      for (const { mode, schema } of schemas) {
        assert.deepEqual(schema.validate(value, `#${at}`), [], `${at || '/'} ${keyword} ${JSON.stringify(value).slice(0, 60)} (${mode} regexes)`);
      }
      if (at === '') assert.deepEqual(validateReel(value).errors, [], 'the example reel');
    }
  }
});

test('the error messages the authoring guide quotes are real', () => {
  // A document with five slides of four layers each, to break in the ways the guide's table shows.
  const base = () => ({
    format: 'reel/1', title: 'Errors', music: { src: 'media/music.mp3', duration: 60 },
    slides: Array.from({ length: 5 }, (_, i) => ({
      id: `page-${i}`, duration: 12,
      layers: [
        { type: 'image', src: 'media/a.jpg' }, { type: 'text', text: 'A', style: { size: 5 } },
        { type: 'shape', shape: 'rect' }, { type: 'text', text: 'B' },
      ],
      audio: [{ src: 'media/a.mp3', start: 1, duration: 3 }],
    })),
  }) as any;
  /** How to make each quoted message happen. */
  const edits: Record<string, (d: any) => void> = {
    'slides[0].layers[1]: unknown field "fontSize"': d => { d.slides[0].layers[1].fontSize = 6; },
    'unknown field "fadein" – did you mean "fadeIn"?': d => { d.slides[0].layers[1].fadein = 1; },
    'slides[0].layers[1].style.color: must be #rrggbb or #rrggbbaa – use "#ffffff"': d => { d.slides[0].layers[1].style.color = '#fff'; },
    'music.src: must start with media/ or https:// – use https://': d => { d.music.src = 'http://example.com/music.mp3'; },
    'slides[0].layers[0].src: must start with media/ or https:// – put the file under media/ (e.g. media/photo.jpg)': d => { d.slides[0].layers[0].src = 'photo.jpg'; },
    'slides[2].layers[0].src: .mov is not a video type – use mp4': d => { d.slides[2].layers[0] = { type: 'video', src: 'media/a.mov', duration: 5 }; },
    'slides[0].layers[0].src: must be a clean relative path (…)': d => { d.slides[0].layers[0].src = 'media/../a.jpg'; },
    'slides[0].transition: must be an object like { "type": "fade", "duration": 1 } or { "type": "cut" }': d => { d.slides[0].transition = 'fade'; },
    'slides[1].audio[0]: ends after the slide: start + duration = 13.4 s, but the slide lasts 12 s – …': d => { d.slides[1].audio[0].duration = 12.4; },
    "slides[2].layers[3].start: must be less than the slide's duration (8 s)": d => { d.slides[2].duration = 8; d.slides[2].layers[3].start = 8; },
    'slides[2].layers[3].end: is after the end of the slide (8 s)': d => { d.slides[2].duration = 8; d.slides[2].layers[3].end = 9; },
    'slides[4].id: "page-1" is used by an earlier slide': d => { d.slides[4].id = 'page-1'; },
    'slides[0].layers: must be a list of 1–12 layers': d => { d.slides[0].layers = Array(13).fill({ type: 'text', text: 'x' }); },
    'slides[0].layers[2].shape: required': d => { delete d.slides[0].layers[2].shape; },
    'slides[0].layers[0].duration: required': d => { d.slides[0].layers[0] = { type: 'video', src: 'media/a.mp4' }; },
  };
  assert.deepEqual(validateReel(base()).errors, []);
  const guide = read('packages/reel-schema/GUIDE.md');
  // The table rows: | `message` | fix |, and the near miss quoted in a fix.
  const quoted = [...guide.matchAll(/^\| `([^`]+)` \|.*$/gm)].map(m => m[1]).filter(m => m !== 'Error');
  quoted.push(...[...guide.matchAll(/`(unknown field "[^`]+)`/g)].map(m => m[1]));
  assert.ok(quoted.length >= 10, `${quoted.length} messages found`);
  for (const message of quoted) {
    const edit = edits[message];
    assert.ok(edit, `the guide quotes ${JSON.stringify(message)} – add a way to make it happen here`);
    const doc = base();
    edit(doc);
    // "…" stands for the rest of a long message.
    const pattern = new RegExp(`${message.split('…').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
    const errors = validateReel(doc).errors;
    assert.ok(errors.some(e => pattern.test(e)), `${message}\n  validateReel says: ${errors.join('; ')}`);
  }
});
