// The start page: all reels, and buttons to create new ones (empty, or from a template example).

import type { Reel } from 'reel-format';
import { api, ApiError } from './api.ts';
import { fmtTime, h, toast } from './ui.ts';

const grid = h('div', { class: 'grid' });
const templates = h('div', { class: 'row' });

const EMPTY: Reel = {
  format: 'reel/1',
  title: 'Untitled reel',
  slides: [{
    id: 'slide-1', duration: 8, background: '#1f2933',
    layers: [{ type: 'text', text: 'Hello', x: 5, y: 40, w: 90, align: 'center', fadeIn: 0.6, style: { size: 9, weight: 'bold' } }],
  }],
};

const fail = (err: unknown) => toast(err instanceof ApiError && err.errors.length ? `${err.message}: ${err.errors[0]}` : String((err as Error).message), 'error');

const open = (id: string) => { location.href = `edit.html?id=${encodeURIComponent(id)}`; };

const draw = async () => {
  const reels = await api.reels();
  grid.replaceChildren(...reels.map(r => h('article', { class: 'card' },
    h('a', { class: 'thumb', href: `play.html?src=/reels/${r.id}/reel.json`, title: 'Play' },
      r.thumbnail ? h('img', { src: r.thumbnail, alt: '', loading: 'lazy' }) : h('span', {}, '▶')),
    h('div', { class: 'card-body' },
      h('strong', {}, r.title),
      h('span', { class: 'muted' }, `${r.source} · ${r.slides} slides · ${fmtTime(r.duration)}`),
      h('div', { class: 'row' },
        h('a', { class: 'btn primary', href: `play.html?src=/reels/${r.id}/reel.json` }, '▶ Play'),
        h('a', { class: 'btn', href: `edit.html?id=${r.id}` }, 'Edit'),
        h('a', { class: 'btn', href: `/api/reels/${r.id}/package.zip`, title: 'reel.json + media/ as a zip' }, 'Package'),
        h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
          if (!confirm(`Delete "${r.title}"?`)) return;
          await api.remove(r.id).catch(fail);
          void draw();
        } }, 'Delete')),
    ))));
  if (!reels.length) grid.append(h('p', { class: 'muted' }, 'No reels yet. Create one, or restore the demo data.'));
};

/** Uploads a package zip (reel.json + media/), e.g. one downloaded with "Package". */
const importButton = () => {
  const input = h('input', { type: 'file', accept: '.zip,application/zip' });
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const r = await api.importPackage(file);
      if (r.warnings.length) toast(r.warnings.join(' · '));
      open(r.id);
    } catch (err) { fail(err); }
  });
  return h('label', { class: 'btn', title: 'A .zip with reel.json and media/' }, 'Import package…', input);
};

const drawTemplates = async () => {
  const list = await api.templates();
  templates.replaceChildren(
    h('button', { class: 'btn primary', type: 'button', onclick: () => api.create(EMPTY).then(r => open(r.id), fail) }, '+ Empty reel'),
    ...list.map(t => h('button', { class: 'btn', type: 'button', title: `${t.description}\nFormat: ${t.format}`,
      onclick: () => api.create(t.example.document, t.example.media).then(r => open(r.id), fail) }, `+ ${t.label}`)),
    importButton(),
    h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
      if (!confirm('Delete every reel and restore the demo data?')) return;
      await api.reset().catch(fail);
      void draw();
    } }, 'Reset demo data'),
  );
};

document.getElementById('app')!.append(
  h('header', { class: 'top' },
    h('h1', {}, 'Reel Studio'),
    h('nav', {},
      h('a', { href: '/api' }, 'API'),
      h('a', { href: '/api/schema' }, 'Schema'),
      h('a', { href: 'https://www.npmjs.com/package/reel-format' }, 'npm'))),
  h('main', { class: 'page' },
    h('p', { class: 'lead' },
      'An example app for ', h('code', {}, 'reel-format'), ' and ', h('code', {}, 'reel-dom'), '. People build reels here with the visual editor; scripts and AI agents use the same open ',
      h('a', { href: '/api' }, 'API'), '. Every reel is a package (', h('code', {}, 'reel.json'), ' + ', h('code', {}, 'media/'),
      ') published at ', h('code', {}, '/reels/<id>/'), '. Everything here is open demo data and may be reset.'),
    h('section', {}, h('h2', {}, 'New reel'), templates),
    h('section', {}, h('h2', {}, 'Reels'), grid)),
);

void draw().catch(fail);
void drawTemplates().catch(fail);
