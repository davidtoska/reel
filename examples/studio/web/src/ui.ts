// UI helpers for the studio pages: an element builder and form fields bound to object properties.

export type Child = Node | string | number | null | undefined | false | Child[];

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, unknown> | null, ...children: Child[]): HTMLElementTagNameMap[K];
export function h(tag: string, attrs: Record<string, unknown> | null = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    else if (key in node && typeof value !== 'string') (node as unknown as Record<string, unknown>)[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of (children as unknown[]).flat(Infinity) as Child[]) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const fmtBytes = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} kB`);

let toastHost: HTMLElement | undefined;
export const toast = (message: string, kind: 'ok' | 'error' = 'ok') => {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status' }));
  const node = h('div', { class: ['toast', kind] }, message);
  toastHost.append(node);
  setTimeout(() => node.remove(), kind === 'error' ? 6000 : 2500);
};

// --- Fields bound to an object property ------------------------------------------------------------
// Each field reads obj[key] and writes it back on input; an empty value deletes the key, so the
// format's default applies. `changed` is called after every write.

type Obj = Record<string, unknown>;

export interface FieldContext { changed: () => void }

const assign = (obj: Obj, key: string, value: unknown) => {
  if (value === undefined || value === '') delete obj[key];
  else obj[key] = value;
};

const label = (text: string, input: HTMLElement, hint?: string) =>
  h('label', { class: 'field' }, h('span', { class: 'field-label', title: hint ?? '' }, text), input);

export const fields = ({ changed }: FieldContext) => ({
  text(obj: Obj, key: string, text: string, opts: { placeholder?: string; hint?: string; required?: boolean } = {}) {
    const input = h('input', { type: 'text', value: (obj[key] as string) ?? '', placeholder: opts.placeholder ?? '' });
    input.addEventListener('input', () => { if (opts.required) obj[key] = input.value; else assign(obj, key, input.value); changed(); });
    return label(text, input, opts.hint);
  },
  area(obj: Obj, key: string, text: string, opts: { rows?: number } = {}) {
    const input = h('textarea', { rows: opts.rows ?? 3 });
    input.value = (obj[key] as string) ?? ''; // a textarea's value is its content, not an attribute
    input.addEventListener('input', () => { obj[key] = input.value; changed(); });
    return label(text, input);
  },
  number(obj: Obj, key: string, text: string, opts: { min?: number; max?: number; step?: number; placeholder?: string; required?: boolean; hint?: string } = {}) {
    const input = h('input', { type: 'number', step: opts.step ?? 0.1, min: opts.min, max: opts.max, value: obj[key] ?? '', placeholder: opts.placeholder ?? '' });
    input.addEventListener('input', () => {
      const v = input.value === '' ? undefined : Number(input.value);
      if (opts.required && v === undefined) return;
      assign(obj, key, v);
      changed();
    });
    return label(text, input, opts.hint);
  },
  select(obj: Obj, key: string, text: string, options: [string, string][], opts: { inherit?: string } = {}) {
    const all: [string, string][] = opts.inherit != null ? [['', opts.inherit], ...options] : options;
    const current = obj[key] == null ? '' : String(obj[key]);
    if (current && !all.some(([v]) => v === current)) all.push([current, current]);
    const input = h('select', {}, all.map(([v, l]) => h('option', { value: v, selected: v === current }, l)));
    input.addEventListener('change', () => {
      const v = input.value;
      assign(obj, key, v === 'true' ? true : v === 'false' ? false : v);
      changed();
    });
    return label(text, input);
  },
  /** true / false / default (key removed). */
  bool(obj: Obj, key: string, text: string, defaultLabel = 'default') {
    return this.select(obj, key, text, [['true', 'yes'], ['false', 'no']], { inherit: defaultLabel });
  },
  /** #rrggbb or #rrggbbaa: a text box with a colour picker. The picker keeps the alpha part. */
  color(obj: Obj, key: string, text: string, opts: { placeholder?: string } = {}) {
    const value = (obj[key] as string) ?? '';
    const input = h('input', { type: 'text', value, placeholder: opts.placeholder ?? 'none', class: 'color-text', spellcheck: false });
    const picker = h('input', { type: 'color', value: value.slice(0, 7) || '#000000' });
    input.addEventListener('input', () => {
      assign(obj, key, input.value.trim());
      if (/^#[0-9a-f]{6}/i.test(input.value)) picker.value = input.value.slice(0, 7);
      changed();
    });
    picker.addEventListener('input', () => {
      const alpha = /^#[0-9a-f]{8}$/i.test(input.value) ? input.value.slice(7) : '';
      input.value = picker.value + alpha;
      assign(obj, key, input.value);
      changed();
    });
    return label(text, h('span', { class: 'color' }, picker, input));
  },
});
