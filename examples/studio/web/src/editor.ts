// The visual builder: edit.html?id=<reel id>
//
// Left: slides. Centre: the real player, frozen at a point in the selected slide, with boxes over the
// layers that can be dragged and resized. Right: properties of the reel, the slide, the selected
// layer, audio clips and media. Saving sends the document to the same API scripts and AI agents use.

import { ReelPlayer } from 'reel-player';
import { slideStarts, validateReel, type AudioClip, type Layer, type Reel } from 'reel-format';
import { api, ApiError, type LibraryFile, type MediaInfo } from './api.ts';
import { fields, fmtBytes, fmtTime, h, toast } from './ui.ts';

const id = new URLSearchParams(location.search).get('id') ?? '';
const reelUrl = new URL(`/reels/${id}/reel.json`, location.href);

let doc: Reel;
let media: MediaInfo[] = [];
let library: LibraryFile[] = [];
let madeFrom: string | null = null;
let slideIndex = 0;
let layerIndex = -1;
let frameAt = 2;          // seconds into the selected slide shown in the preview
let playing = false;
let dirty = false;
let edits = 0;            // counts changes, so a save does not drop edits made while it was under way

type Obj = Record<string, unknown>;
const slide = () => doc.slides[slideIndex];
const layer = () => slide()?.layers[layerIndex];
const clampN = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number) => Math.round(v * 2) / 2;

// --- Page structure ----------------------------------------------------------------------------

const titleInput = h('input', { class: 'title-input', 'aria-label': 'Title' });
const saveBtn = h('button', { class: 'btn primary', type: 'button' }, 'Save');
const status = h('span', { class: 'status' });
const problems = h('ul', { class: 'problems' });
const slideList = h('ol', { class: 'slides' });
const stage = h('div', { class: 'editor-stage' });       // the player's host element
const overlay = h('div', { class: 'overlay' });           // boxes over the layers, placed over the canvas
const preview = h('div', { class: 'editor-preview' }, stage, overlay);
const scrub = h('input', { type: 'range', min: 0, step: 0.1, class: 'scrub' });
const timeLabel = h('span', { class: 'time' });
const playBtn = h('button', { class: 'btn', type: 'button' }, '▶ Play from here');
const fullBtn = h('button', { class: 'btn', type: 'button', title: 'Full screen preview (Esc to leave)' }, '⛶');
const inspector = h('div', { class: 'inspector' });

const player = new ReelPlayer(stage);
player.on('ended', () => stopPlaying());
player.on('error', e => toast(`Missing file: ${e.src}`, 'error'));
/** The player's canvas inside the host (its class names are stable for overlays like this one). */
const canvasEl = () => stage.querySelector<HTMLElement>('.reel-canvas');

// --- Changes, validation, saving -------------------------------------------------------------------

const check = (): string[] => {
  const r = validateReel(doc);
  const have = new Set(media.map(m => m.src));
  const refs = [doc.music?.src, ...doc.slides.flatMap(s => [...s.layers.map(l => ('src' in l ? l.src : undefined)), ...(s.audio ?? []).map(a => a.src)])];
  const missing = [...new Set(refs.filter((r): r is string => !!r && r.startsWith('media/') && !have.has(r)))].map(r => `${r}: not in the package`);
  return [...(r.ok ? [] : r.errors), ...missing];
};

const showProblems = (list: string[]) => {
  problems.replaceChildren(...list.slice(0, 30).map(p => h('li', {}, p)));
  status.textContent = list.length ? `${list.length} problem${list.length > 1 ? 's' : ''}` : dirty ? 'Unsaved changes' : 'Saved';
  status.className = ['status', list.length ? 'bad' : dirty ? 'dirty' : 'ok'].join(' ');
};

let previewTimer: ReturnType<typeof setTimeout> | undefined;
/** Called after every edit: re-validate, and redraw the preview shortly after. */
const changed = (redrawPanels = false) => {
  edits++;
  dirty = true;
  showProblems(check());
  if (redrawPanels) render();
  else { drawSlides(); clearTimeout(previewTimer); previewTimer = setTimeout(frame, 120); }
};
const f = fields({ changed: () => changed() });

/** Optional objects the forms create empty: a text style, defaults.text and defaults. */
const PRUNED_WHEN_EMPTY = new Set(['style', 'text', 'defaults']);

/**
 * The document without the empty optional objects the forms leave behind (e.g. `style: {}`).
 * Other empty objects stay: an empty motion.from or motion.to is required and means the defaults.
 */
const cleaned = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(cleaned);
  if (!value || typeof value !== 'object') return value;
  const out: Obj = {};
  for (const [k, v] of Object.entries(value)) {
    const c = cleaned(v);
    if (PRUNED_WHEN_EMPTY.has(k) && c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).length === 0) continue;
    out[k] = c;
  }
  return out;
};

const save = async () => {
  const at = edits;
  try {
    const body = cleaned(doc) as Reel;
    await api.save(id, body);
    madeFrom = null;
    // Swap in the cleaned copy only now, and only if nothing was edited meanwhile: the forms are bound
    // to `doc`, and after a failed save they must stay bound to the document the user is editing.
    if (edits === at) {
      doc = body;
      dirty = false;
      render();
    }
    showProblems(check());
    toast('Saved');
  } catch (err) {
    const e = err as ApiError;
    showProblems(e.errors?.length ? e.errors : [e.message]);
    toast(`Not saved: ${e.message}`, 'error');
  }
};
saveBtn.addEventListener('click', save);
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); void save(); }
});
window.addEventListener('beforeunload', e => { if (dirty) e.preventDefault(); });

// --- Preview -------------------------------------------------------------------------------------

/** Shows the selected slide frozen at `frameAt`, and boxes over its layers. */
const frame = () => {
  if (playing) return;
  const s = slide();
  if (!s) return;
  frameAt = clampN(frameAt, 0, Math.max(0, s.duration - 0.05));
  scrub.max = String(s.duration);
  scrub.value = String(frameAt);
  timeLabel.textContent = `${frameAt.toFixed(1)} / ${s.duration} s`;
  try {
    player.loadReel(doc, reelUrl);
    player.seek(slideStarts(doc.slides)[slideIndex] + frameAt);
  } catch {
    // The player only shows valid reels; while an edit is unfinished the problem list says what is wrong.
  }
  requestAnimationFrame(drawOverlay);
};

const drawOverlay = () => {
  overlay.replaceChildren();
  const s = slide();
  const canvas = canvasEl();
  if (!s || !canvas || playing || !player.reel) return;
  const shown = canvas.querySelectorAll<HTMLElement>('.reel-slide');
  const rendered = shown[shown.length - 1]?.querySelectorAll<HTMLElement>(':scope > .reel-layer') ?? [];
  const c = canvas.getBoundingClientRect();
  const p = preview.getBoundingClientRect();
  if (!c.width) return;
  // The overlay covers exactly the canvas; boxes inside it are in percent, like the layers.
  Object.assign(overlay.style, { left: `${c.left - p.left}px`, top: `${c.top - p.top}px`, width: `${c.width}px`, height: `${c.height}px` });
  s.layers.forEach((l, i) => {
    const r = rendered[i]?.getBoundingClientRect();
    if (!r) return;
    const visible = (l.start ?? 0) <= frameAt && frameAt < (l.end ?? s.duration);
    const box = h('div', {
      class: ['box', i === layerIndex && 'selected', !visible && 'hidden-now'],
      title: `${l.type} ${i + 1}${visible ? '' : ' (not visible at this time)'}`,
      style: { left: `${((r.left - c.left) / c.width) * 100}%`, top: `${((r.top - c.top) / c.height) * 100}%`, width: `${(r.width / c.width) * 100}%`, height: `${(r.height / c.height) * 100}%` },
    }, h('span', { class: 'box-tag' }, `${i + 1}`), h('span', { class: 'handle' }));
    box.addEventListener('pointerdown', e => startDrag(e, i, box, rendered[i], (e.target as HTMLElement).classList.contains('handle')));
    overlay.append(box);
  });
};

/** Moves (or resizes, from the corner handle) a layer with the pointer. */
const startDrag = (e: PointerEvent, i: number, box: HTMLElement, el: HTMLElement, resize: boolean) => {
  e.preventDefault();
  if (layerIndex !== i) { layerIndex = i; render(); return; }
  const l = slide().layers[i];
  const c = overlay.getBoundingClientRect();
  const start = { px: e.clientX, py: e.clientY, x: l.x ?? 0, y: l.y ?? 0, w: l.w ?? 100, h: l.h ?? (box.offsetHeight / c.height) * 100 };
  const hasH = l.h != null || l.type !== 'text';
  box.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const dx = ((ev.clientX - start.px) / c.width) * 100;
    const dy = ((ev.clientY - start.py) / c.height) * 100;
    if (resize) {
      l.w = round(clampN(start.w + dx, 1, 100 - (l.x ?? 0)));
      if (hasH) l.h = round(clampN(start.h + dy, 1, 100 - (l.y ?? 0)));
      box.style.width = el.style.width = `${l.w}%`;
      if (hasH) box.style.height = el.style.height = `${l.h}%`;
    } else {
      l.x = round(clampN(start.x + dx, 0, 100 - Math.min(l.w ?? 100, 100)));
      l.y = round(clampN(start.y + dy, 0, 100));
      box.style.left = el.style.left = `${l.x}%`;
      box.style.top = el.style.top = `${l.y}%`;
    }
  };
  const up = () => {
    box.removeEventListener('pointermove', move);
    box.removeEventListener('pointerup', up);
    changed(true);
  };
  box.addEventListener('pointermove', move);
  box.addEventListener('pointerup', up);
};

scrub.addEventListener('input', () => { frameAt = Number(scrub.value); frame(); });
new ResizeObserver(() => requestAnimationFrame(drawOverlay)).observe(stage);

let clock = 0;
const stopPlaying = () => {
  playing = false;
  cancelAnimationFrame(clock);
  player.pause();
  playBtn.textContent = '▶ Play from here';
  preview.classList.remove('playing');
  frame();
};
playBtn.addEventListener('click', () => {
  if (playing) return stopPlaying();
  if (!player.reel) return toast('Fix the problems first – the player only plays valid reels', 'error');
  playing = true;
  overlay.replaceChildren();
  preview.classList.add('playing');
  playBtn.textContent = '■ Stop';
  const starts = slideStarts(doc.slides);
  player.play(); // the frame shown is already at the right place
  // Follow playback in the slide list and the time slider.
  const follow = () => {
    const p = player.currentTime;
    let i = 0;
    while (i + 1 < starts.length && starts[i + 1] <= p) i++;
    if (i !== slideIndex) { slideIndex = i; layerIndex = -1; drawSlides(); drawInspector(); }
    frameAt = p - starts[i];
    scrub.max = String(slide().duration);
    scrub.value = String(frameAt);
    timeLabel.textContent = `${frameAt.toFixed(1)} / ${slide().duration} s`;
    clock = requestAnimationFrame(follow);
  };
  follow();
});
// Clicks and taps anywhere in the editor (e.g. on Play) count as the gesture browsers need for sound:
// a mouse press on pointerdown, a tap on pointerup.
const unlockOnGesture = (e: PointerEvent) => { if ((e.type === 'pointerdown') === (e.pointerType === 'mouse')) player.unlockAudio(); };
document.addEventListener('pointerdown', unlockOnGesture);
document.addEventListener('pointerup', unlockOnGesture);
// Full screen shows only the host element – the overlay stays behind.
fullBtn.addEventListener('click', () => player.toggleFullscreen().catch(err => toast(`Full screen not allowed: ${err.message}`, 'error')));
document.addEventListener('fullscreenchange', () => requestAnimationFrame(drawOverlay));

// --- Slides --------------------------------------------------------------------------------------

const uniqueId = (base: string) => {
  const ids = new Set(doc.slides.map(s => s.id));
  for (let n = 1; ; n++) if (!ids.has(`${base}-${n}`)) return `${base}-${n}`;
};

const selectSlide = (i: number) => {
  if (playing) stopPlaying();
  slideIndex = clampN(i, 0, doc.slides.length - 1);
  layerIndex = -1;
  frameAt = Math.min(2, slide().duration / 2);
  render();
};

const moveItem = <T>(list: T[], i: number, by: number) => {
  const j = i + by;
  if (j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  return true;
};

const drawSlides = () => {
  const starts = slideStarts(doc.slides);
  slideList.replaceChildren(...doc.slides.map((s, i) => h('li', {
    class: ['slide-item', i === slideIndex && 'selected'],
    onclick: () => selectSlide(i),
  },
  h('span', { class: 'swatch', style: { background: s.background ?? '#000000' } }),
  h('span', { class: 'slide-name' }, s.id || '(no id)'),
  h('span', { class: 'muted' }, `${fmtTime(starts[i])} · ${s.duration ?? '?'} s`))));
};

const slideActions = () => h('div', { class: 'row wrap' },
  h('button', { class: 'btn sm', type: 'button', onclick: () => {
    doc.slides.splice(slideIndex + 1, 0, { id: uniqueId('slide'), duration: 8, background: slide()?.background ?? '#1f2933',
      layers: [{ type: 'text', text: 'New slide', x: 5, y: 40, w: 90, align: 'center', fadeIn: 0.5, style: { size: 7 } }] });
    selectSlide(slideIndex + 1);
    changed(true);
  } }, '+ Slide'),
  h('button', { class: 'btn sm', type: 'button', onclick: () => {
    const copy = structuredClone(slide());
    copy.id = uniqueId(copy.id.replace(/-\d+$/, ''));
    doc.slides.splice(slideIndex + 1, 0, copy);
    selectSlide(slideIndex + 1);
    changed(true);
  } }, 'Duplicate'),
  h('button', { class: 'btn sm', type: 'button', onclick: () => { if (moveItem(doc.slides, slideIndex, -1)) { slideIndex--; changed(true); } } }, '↑'),
  h('button', { class: 'btn sm', type: 'button', onclick: () => { if (moveItem(doc.slides, slideIndex, 1)) { slideIndex++; changed(true); } } }, '↓'),
  h('button', { class: 'btn sm ghost', type: 'button', onclick: () => {
    if (doc.slides.length === 1) return toast('A reel needs at least one slide', 'error');
    doc.slides.splice(slideIndex, 1);
    selectSlide(Math.min(slideIndex, doc.slides.length - 1));
    changed(true);
  } }, 'Delete'));

// --- Inspector -------------------------------------------------------------------------------------

const mediaOptions = (kind: MediaInfo['kind']): [string, string][] => media.filter(m => m.kind === kind).map(m => [m.src, m.name]);

/** A select of the package's files of one kind. Picking audio fills in its duration when known. */
const mediaField = (obj: Obj, key: string, label: string, kind: MediaInfo['kind'], durationKey?: string) => {
  const el = f.select(obj, key, label, mediaOptions(kind), { inherit: obj[key] ? undefined : '— choose —' });
  el.querySelector('select')!.addEventListener('change', () => {
    const m = media.find(x => x.src === obj[key]);
    if (durationKey && m?.duration) { obj[durationKey] = m.duration; changed(true); }
  });
  return el;
};

const section = (title: string, open: boolean, ...content: (Node | false | null | undefined)[]) =>
  h('details', { class: 'section', open }, h('summary', {}, title), ...content.filter(Boolean) as Node[]);

const grid2 = (...items: Node[]) => h('div', { class: 'grid2' }, ...items);

const reelSection = () => {
  doc.defaults ??= {};
  const d = doc.defaults as Obj;
  const textDefaults = ((d.text ??= {}) as Obj).style ??= {};
  const music = doc.music as Obj | undefined;
  return section('Reel', false,
    f.area(doc as unknown as Obj, 'description', 'Description', { rows: 2 }),
    grid2(f.text(doc as unknown as Obj, 'language', 'Language', { placeholder: 'en' }), tagsField()),
    h('h4', {}, 'Music'),
    music
      ? h('div', {},
          grid2(mediaField(music, 'src', 'File', 'audio', 'duration'), f.number(music, 'duration', 'Length (s)', { min: 0.1, required: true })),
          grid2(f.number(music, 'volume', 'Volume', { min: 0, max: 1, step: 0.05, placeholder: '0.25' }), f.number(music, 'duckTo', 'Under speech', { min: 0, max: 1, step: 0.01, placeholder: '0.08' })),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { delete doc.music; changed(true); } }, 'Remove music'))
      : h('button', { class: 'btn sm', type: 'button', onclick: () => {
          const m = media.find(x => x.kind === 'audio');
          if (!m) return toast('Add an audio file under Media first', 'error');
          doc.music = { src: m.src, duration: m.duration ?? 30, volume: 0.25 };
          changed(true);
        } }, '+ Music'),
    h('h4', {}, 'Default text style'),
    textStyleFields(textDefaults as Obj),
    h('h4', {}, 'Default transition'),
    transitionFields(d, 'transition', 'fade 1 s'),
  );
};

const tagsField = () => {
  const input = h('input', { type: 'text', value: (doc.tags ?? []).join(', '), placeholder: 'demo, landscape' });
  input.addEventListener('input', () => {
    const tags = input.value.split(',').map(t => t.trim()).filter(Boolean);
    if (tags.length) doc.tags = tags; else delete doc.tags;
    changed();
  });
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Tags'), input);
};

const transitionFields = (obj: Obj, key: string, inherit: string) => {
  const t = obj[key] as Obj | undefined;
  const type = h('select', {},
    h('option', { value: '', selected: !t }, `Default (${inherit})`),
    h('option', { value: 'fade', selected: t?.type === 'fade' }, 'Fade'),
    h('option', { value: 'cut', selected: t?.type === 'cut' }, 'Cut'));
  type.addEventListener('change', () => {
    if (!type.value) delete obj[key];
    else obj[key] = type.value === 'fade' ? { type: 'fade', duration: 1 } : { type: 'cut' };
    changed(true);
  });
  return grid2(h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Transition'), type),
    t?.type === 'fade' ? f.number(t, 'duration', 'Fade (s)', { min: 0, max: 5, placeholder: '1' }) : h('span'));
};

const slideSection = () => {
  const s = slide() as unknown as Obj;
  return section('Slide', true,
    grid2(f.text(s, 'id', 'Id', { required: true }), f.number(s, 'duration', 'Duration (s)', { min: 1, max: 600, step: 0.5, required: true })),
    grid2(f.color(s, 'background', 'Background', { placeholder: '#000000' }), f.text(s, 'credit', 'Credit')),
    transitionFields(s, 'transition', 'reel default'),
  );
};

const textStyleFields = (st: Obj) => h('div', {},
  grid2(
    f.select(st, 'font', 'Font', [['sans', 'Sans'], ['serif', 'Serif']], { inherit: 'default' }),
    f.number(st, 'size', 'Size (% of height)', { min: 1.5, max: 20, step: 0.5, placeholder: '5' })),
  grid2(
    f.select(st, 'weight', 'Weight', [['regular', 'Regular'], ['bold', 'Bold']], { inherit: 'default' }),
    f.bool(st, 'italic', 'Italic')),
  grid2(f.color(st, 'color', 'Colour', { placeholder: '#ffffff' }), f.color(st, 'background', 'Background')),
  grid2(f.number(st, 'padding', 'Padding', { min: 0, max: 10, step: 0.2 }), f.number(st, 'radius', 'Corner radius', { min: 0, max: 50, step: 0.2 })),
  grid2(f.number(st, 'lineHeight', 'Line height', { min: 0.8, max: 3, step: 0.05, placeholder: '1.25' }), f.bool(st, 'shadow', 'Shadow')));

const NEW_LAYER: Record<Layer['type'], () => Layer> = {
  text: () => ({ type: 'text', text: 'Text', x: 10, y: 40, w: 80, fadeIn: 0.5 }),
  image: () => ({ type: 'image', src: media.find(m => m.kind === 'image')?.src ?? 'media/', fit: 'cover' }),
  shape: () => ({ type: 'shape', shape: 'rect', x: 30, y: 30, w: 40, h: 40, fill: '#ffffff33', radius: 2 }),
  video: () => ({ type: 'video', src: media.find(m => m.kind === 'video')?.src ?? 'media/', duration: 10 }),
};

const layerLabel = (l: Layer) =>
  l.type === 'text' ? `“${l.text.slice(0, 28)}${l.text.length > 28 ? '…' : ''}”`
  : l.type === 'shape' ? `${l.shape}${l.fill ? ` ${l.fill}` : ''}`
  : l.src.replace(/^media\//, '');

const layersSection = () => {
  const s = slide();
  const l = layer();
  const list = h('ol', { class: 'layers' }, s.layers.map((x, i) => h('li', {
    class: ['layer-item', i === layerIndex && 'selected'],
    onclick: () => { layerIndex = i; render(); },
  }, h('span', { class: 'tag' }, x.type), h('span', { class: 'layer-name' }, layerLabel(x)),
  h('span', { class: 'muted' }, `${x.start ?? 0}–${x.end ?? s.duration}s`))));
  const add = h('div', { class: 'row wrap' }, (Object.keys(NEW_LAYER) as Layer['type'][]).map(t => h('button', { class: 'btn sm', type: 'button', onclick: () => {
    if (s.layers.length >= 12) return toast('At most 12 layers per slide', 'error');
    s.layers.push(NEW_LAYER[t]());
    layerIndex = s.layers.length - 1;
    changed(true);
  } }, `+ ${t}`)));
  const actions = l && h('div', { class: 'row wrap' },
    h('button', { class: 'btn sm', type: 'button', title: 'Move down (behind)', onclick: () => { if (moveItem(s.layers, layerIndex, -1)) { layerIndex--; changed(true); } } }, '↓ Back'),
    h('button', { class: 'btn sm', type: 'button', title: 'Move up (in front)', onclick: () => { if (moveItem(s.layers, layerIndex, 1)) { layerIndex++; changed(true); } } }, '↑ Front'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => {
      if (s.layers.length >= 12) return toast('At most 12 layers per slide', 'error');
      s.layers.splice(layerIndex + 1, 0, structuredClone(l)); layerIndex++; changed(true);
    } }, 'Duplicate'),
    h('button', { class: 'btn sm ghost', type: 'button', onclick: () => {
      if (s.layers.length === 1) return toast('A slide needs at least one layer', 'error');
      s.layers.splice(layerIndex, 1); layerIndex = -1; changed(true);
    } }, 'Delete'));
  return section('Layers', true, h('p', { class: 'muted small' }, 'Later layers are drawn on top. Drag boxes in the preview to move; drag the corner to resize.'),
    list, add, l && h('div', { class: 'layer-form' }, actions, layerFields(l)));
};

const layerFields = (l: Layer) => {
  const o = l as unknown as Obj;
  const common = h('div', {},
    h('h4', {}, 'Position and time'),
    grid2(f.number(o, 'x', 'x %', { min: 0, max: 100, step: 0.5, placeholder: '0' }), f.number(o, 'y', 'y %', { min: 0, max: 100, step: 0.5, placeholder: '0' })),
    grid2(f.number(o, 'w', 'Width %', { min: 0, max: 100, step: 0.5, placeholder: '100' }), f.number(o, 'h', 'Height %', { min: 0, max: 100, step: 0.5, placeholder: l.type === 'text' ? 'auto' : '100' })),
    grid2(f.number(o, 'start', 'Start (s)', { min: 0, step: 0.1, placeholder: '0' }), f.number(o, 'end', 'End (s)', { min: 0, step: 0.1, placeholder: 'slide end' })),
    grid2(f.number(o, 'fadeIn', 'Fade in (s)', { min: 0, step: 0.1, placeholder: '0' }), f.number(o, 'fadeOut', 'Fade out (s)', { min: 0, step: 0.1, placeholder: '0' })),
    f.number(o, 'opacity', 'Opacity', { min: 0, max: 1, step: 0.05, placeholder: '1' }));

  if (l.type === 'text') {
    return h('div', {},
      f.area(o, 'text', 'Text', { rows: 3 }),
      grid2(f.select(o, 'align', 'Align', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], { inherit: 'default (left)' }),
        f.select(o, 'valign', 'Vertical (needs height)', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], { inherit: 'default (top)' })),
      h('h4', {}, 'Style'), textStyleFields((o.style ??= {}) as Obj), common);
  }
  if (l.type === 'image') {
    const motionOn = h('input', { type: 'checkbox', checked: !!l.motion });
    motionOn.addEventListener('change', () => {
      if (motionOn.checked) l.motion = { from: { scale: 1, x: 50, y: 50 }, to: { scale: 1.15, x: 50, y: 50 } };
      else delete l.motion;
      changed(true);
    });
    return h('div', {},
      mediaField(o, 'src', 'Image', 'image'),
      grid2(f.select(o, 'fit', 'Fit', [['cover', 'Cover (crop)'], ['contain', 'Contain (whole)']], { inherit: 'default (cover)' }), f.text(o, 'alt', 'Alt text')),
      h('label', { class: 'check' }, motionOn, 'Slow zoom / pan'),
      l.motion && h('div', { class: 'grid3' },
        h('span', {}, 'From'), f.number(l.motion.from as Obj, 'scale', 'Scale', { min: 1, max: 2, step: 0.01 }),
        f.number(l.motion.from as Obj, 'x', 'x %', { min: 0, max: 100 }), f.number(l.motion.from as Obj, 'y', 'y %', { min: 0, max: 100 }),
        h('span', {}, 'To'), f.number(l.motion.to as Obj, 'scale', 'Scale', { min: 1, max: 2, step: 0.01 }),
        f.number(l.motion.to as Obj, 'x', 'x %', { min: 0, max: 100 }), f.number(l.motion.to as Obj, 'y', 'y %', { min: 0, max: 100 })),
      common);
  }
  if (l.type === 'video') {
    return h('div', {},
      mediaField(o, 'src', 'Video (MP4)', 'video'),
      grid2(f.number(o, 'duration', 'Clip length (s)', { min: 0.1, required: true }), f.number(o, 'trimStart', 'Start in clip (s)', { min: 0, placeholder: '0' })),
      grid2(f.select(o, 'fit', 'Fit', [['cover', 'Cover'], ['contain', 'Contain']], { inherit: 'default (cover)' }), f.number(o, 'volume', 'Volume', { min: 0, max: 1, step: 0.05, placeholder: '1' })),
      grid2(f.bool(o, 'muted', 'Muted', 'default (when slide has audio)'), f.bool(o, 'loop', 'Loop')),
      common);
  }
  return h('div', {},
    grid2(f.select(o, 'shape', 'Shape', [['rect', 'Rectangle'], ['ellipse', 'Ellipse']]), f.number(o, 'radius', 'Corner radius', { min: 0, max: 50, step: 0.5 })),
    grid2(f.color(o, 'fill', 'Fill'), f.color(o, 'stroke', 'Stroke')),
    f.number(o, 'strokeWidth', 'Stroke width', { min: 0, max: 5, step: 0.1 }),
    common);
};

const audioSection = () => {
  const s = slide();
  const clips = (s.audio ??= []);
  const clipForm = (a: AudioClip, i: number) => {
    const o = a as unknown as Obj;
    return h('div', { class: 'clip' },
      h('div', { class: 'row between' }, h('strong', {}, `Clip ${i + 1}`),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { clips.splice(i, 1); if (!clips.length) delete s.audio; changed(true); } }, 'Remove')),
      grid2(mediaField(o, 'src', 'File', 'audio', 'duration'), f.number(o, 'duration', 'Length (s)', { min: 0.1, required: true })),
      grid2(f.number(o, 'start', 'Start (s)', { min: 0, placeholder: '0' }), f.number(o, 'volume', 'Volume', { min: 0, max: 1, step: 0.05, placeholder: '1' })),
      f.bool(o, 'duck', 'Lower music while playing', 'default (yes)'),
      f.area(o, 'transcript', 'Transcript (not shown)', { rows: 2 }));
  };
  const node = section(`Audio clips (${clips.length}/4)`, clips.length > 0,
    ...clips.map(clipForm),
    h('button', { class: 'btn sm', type: 'button', onclick: () => {
      const m = media.find(x => x.kind === 'audio');
      if (!m) return toast('Add an audio file under Media first', 'error');
      if (clips.length >= 4) return toast('At most 4 audio clips per slide', 'error');
      s.audio = clips;
      clips.push({ src: m.src, start: 0, duration: Math.min(m.duration ?? 3, slide().duration) });
      changed(true);
    } }, '+ Audio clip'));
  if (!clips.length) delete s.audio;
  return node;
};

const mediaSection = () => {
  const upload = h('input', { type: 'file', multiple: true, accept: '.jpg,.jpeg,.png,.webp,.svg,.gif,.mp3,.m4a,.aac,.wav,.mp4' });
  upload.addEventListener('change', async () => {
    for (const file of upload.files ?? []) {
      try { media.push(await api.upload(id, file)); toast(`Uploaded ${file.name}`); } catch (err) { toast(`${file.name}: ${(err as Error).message}`, 'error'); }
    }
    media = (await api.reel(id)).media;
    render();
  });
  const libraryList = h('div', { class: 'library', hidden: true });
  const showLibrary = async () => {
    library = library.length ? library : await api.library();
    libraryList.hidden = !libraryList.hidden;
    libraryList.replaceChildren(...library.map(file => h('button', { class: 'lib-item', type: 'button', title: `Add ${file.path} to this reel`, onclick: async () => {
      try { await api.importMedia(id, file.path); media = (await api.reel(id)).media; toast(`Added ${file.path}`); render(); } catch (err) { toast((err as Error).message, 'error'); }
    } }, file.kind === 'image' ? h('img', { src: file.url, alt: '' }) : h('span', { class: 'icon' }, file.kind === 'audio' ? '♪' : '▶'),
    h('span', {}, file.path.split('/')[1]))));
  };
  return section(`Media (${media.length})`, false,
    h('p', { class: 'muted small' }, 'Files in this reel’s package (media/). Upload your own, or add generated demo files.'),
    h('ul', { class: 'media' }, media.map(m => h('li', {},
      m.kind === 'image' ? h('img', { src: `/reels/${id}/${m.src}`, alt: '' }) : h('span', { class: 'icon' }, m.kind === 'audio' ? '♪' : '▶'),
      h('span', { class: 'media-name' }, m.name),
      h('span', { class: 'muted' }, [fmtBytes(m.bytes), m.duration ? ` · ${m.duration} s` : ''].join('')),
      h('button', { class: 'btn sm ghost', type: 'button', title: 'Delete file', onclick: async () => {
        if (!confirm(`Delete ${m.name}?`)) return;
        try { await api.deleteMedia(id, m.name); media = media.filter(x => x !== m); changed(true); } catch (err) { toast((err as Error).message, 'error'); }
      } }, '×')))),
    h('div', { class: 'row wrap' }, h('label', { class: 'btn sm' }, 'Upload…', upload),
      h('button', { class: 'btn sm', type: 'button', onclick: showLibrary }, 'Demo library…')),
    libraryList);
};

const drawInspector = () => {
  const open = new Set([...inspector.querySelectorAll('details')].filter(d => d.open).map(d => d.querySelector('summary')?.textContent?.split(' (')[0]));
  inspector.replaceChildren(
    madeFrom ? h('p', { class: 'note' }, `Made from the ${madeFrom} template. Saving here stores it as plain reel/1.`) : '',
    reelSection(), slideSection(), layersSection(), audioSection(), mediaSection());
  // Keep sections the user opened or closed as they were.
  if (open.size) for (const d of inspector.querySelectorAll('details')) {
    const name = d.querySelector('summary')?.textContent?.split(' (')[0];
    d.open = open.has(name) || (name === 'Layers' && layerIndex >= 0);
  }
};

const render = () => {
  drawSlides();
  drawInspector();
  frame();
};

// --- Start -----------------------------------------------------------------------------------------

titleInput.addEventListener('input', () => { doc.title = titleInput.value; changed(); });

document.getElementById('app')!.append(
  h('header', { class: 'top editor-top' },
    h('a', { class: 'home', href: '/' }, '←'),
    titleInput,
    status,
    h('div', { class: 'row' },
      h('a', { class: 'btn', href: `play.html?src=/reels/${id}/reel.json`, target: '_blank', title: 'Plays the saved version' }, 'Open player ↗'),
      h('a', { class: 'btn', href: `/api/reels/${id}/package.zip` }, 'Package'),
      saveBtn)),
  h('div', { class: 'editor' },
    h('aside', { class: 'left' }, h('h3', {}, 'Slides'), slideList, slideActions()),
    h('main', { class: 'centre' }, preview, h('div', { class: 'row' }, playBtn, fullBtn, scrub, timeLabel), problems),
    h('aside', { class: 'right' }, inspector)),
);

try {
  const details = await api.reel(id);
  doc = details.reel;
  media = details.media;
  madeFrom = details.source?.format ?? null;
  titleInput.value = doc.title;
  document.title = `${doc.title} – Reel Studio`;
  showProblems(check());
  selectSlide(0);
} catch (err) {
  document.getElementById('app')!.replaceChildren(h('main', { class: 'page' }, h('h1', {}, 'Could not open the reel'), h('p', {}, (err as Error).message), h('a', { href: '/' }, '← Back')));
}
