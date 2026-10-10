// Små UI-hjelpere uten rammeverk: elementbygger, ikoner, formatering, dialoger og toasts.

export const h = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) node.style.setProperty(prop, v);
        else node.style[prop] = v;
      }
    }
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && typeof value !== 'string') node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  append(node, children);
  return node;
};

const append = (node, children) => {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
};

export const clear = (node, ...children) => {
  node.replaceChildren();
  append(node, children);
  return node;
};

// Linjeikoner (24×24, strek).
const ICONS = {
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  'phone-off': '<path d="M10.7 13.3a16 16 0 0 0 3.4 2.5l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 4.2 2 2 0 0 1 5.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L9 9.8"/><path d="M22 2 2 22"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4M8 22h8"/>',
  'mic-off': '<path d="M2 2l20 20M9 9v2a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.6"/><path d="M17 16.9A7 7 0 0 1 5 11v-1M19 10v1a7 7 0 0 1-.1 1.3M12 18v4M8 22h8"/>',
  video: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4V8z"/>',
  'video-off': '<path d="M2 2l20 20M16 16v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m4 0h4a2 2 0 0 1 2 2v3.3l1 1L22 8v8"/>',
  'camera-switch': '<path d="M3 7h3l2-3h8l2 3h3v13H3z"/><path d="M9 13a3 3 0 0 1 5.2-2M15 13a3 3 0 0 1-5.2 2M14 9v2h-2M10 17v-2h2"/>',
  tv: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="m17 2-5 5-5-5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>',
  receipt: '<path d="M5 2h14v20l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  camera: '<path d="M14.5 4h-5L7.5 6.5H4a2 2 0 0 0-2 2V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8.5a2 2 0 0 0-2-2h-3.5z"/><circle cx="12" cy="13" r="3.5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  crown: '<path d="m2 7 4.5 4L12 4l5.5 7L22 7l-2 12H4z"/>',
  'user-plus': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20M14.1 14.1a3 3 0 1 1-4.2-4.2"/>',
  'incoming': '<path d="M16 2v6h6M22 2l-6 6"/><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  'outgoing': '<path d="M16 8l6-6M16 2h6v6"/><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  'missed': '<path d="M22 2l-6 6M16 2l6 6"/><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  'volume': '<path d="M11 5 6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"/>',
  building: '<path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M15 9h4a2 2 0 0 1 2 2v10M9 7h2M9 11h2M9 15h2"/>',
  'id-card': '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2.5"/><path d="M5 16.5c.6-1.4 1.7-2 3-2s2.4.6 3 2M14 10h5M14 14h4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  wifi: '<path d="M5 12.6a10 10 0 0 1 14 0M8.5 16.1a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 20 0M12 20h.01"/>',
  'wifi-off': '<path d="M2 2l20 20M8.5 16.1a5 5 0 0 1 7 0M5 12.6a10 10 0 0 1 5.2-2.8M16.7 10.4A10 10 0 0 1 19 12.6M2 8.8a15 15 0 0 1 4.2-2.7M10.7 5.1A15 15 0 0 1 22 8.8M12 20h.01"/>',
};

export const icon = (name, cls = '') => {
  const span = document.createElement('span');
  span.className = `icon ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return span;
};

// --- Personer ------------------------------------------------------------------

export const initials = name => String(name || '?').split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join('').toUpperCase();

const PALETTE = ['#0f766e', '#1d4ed8', '#7c3aed', '#be185d', '#b45309', '#15803d', '#0369a1', '#9333ea', '#c2410c', '#4d7c0f'];
export const colorFor = name => {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
};

export const avatar = (name, { size = '', online } = {}) => {
  const node = h('span', { class: ['avatar', size], title: name }, initials(name));
  node.style.setProperty('--c', colorFor(name));
  if (online !== undefined) node.append(h('span', { class: ['presence', online && 'on'] }));
  return node;
};

// --- Formatering -----------------------------------------------------------------

const LOCALE = 'nb-NO';

export const formatClock = seconds => {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(hh ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
};

export const formatDuration = seconds => {
  const s = Math.round(seconds || 0);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  return `${Math.floor(m / 60)} t ${m % 60} min`;
};

const sameDay = (a, b) => a.toDateString() === b.toDateString();

export const formatDateTime = iso => {
  if (!iso) return '–';
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
  if (sameDay(d, now)) return `I dag ${time}`;
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return `I går ${time}`;
  if (now - d < 6 * 86_400_000) return `${capitalize(d.toLocaleDateString(LOCALE, { weekday: 'long' }))} ${time}`;
  return `${d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })} ${time}`;
};

export const formatRelative = iso => {
  if (!iso) return 'aldri';
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 10) return 'akkurat nå';
  if (diff < 60) return `for ${Math.round(diff)} s siden`;
  if (diff < 3600) return `for ${Math.round(diff / 60)} min siden`;
  if (diff < 86_400) return `for ${Math.round(diff / 3600)} t siden`;
  return formatDateTime(iso);
};

// Beløp lagres i øre. formatKr(69900) → «699 kr», formatKr(69900, true) → «699,00 kr».
export const formatKr = (ore, decimals = false) => `${(ore / 100).toLocaleString(LOCALE, {
  minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: decimals ? 2 : 0,
})} kr`;

export const formatDate = (iso, { year = 'auto', month = 'long' } = {}) => {
  if (!iso) return '–';
  const d = new Date(iso);
  const showYear = year === true || (year === 'auto' && d.getFullYear() !== new Date().getFullYear());
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month, year: showYear ? 'numeric' : undefined });
};

export const formatMonth = iso => capitalize(new Date(iso).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' }));

export const daysUntil = iso => Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);

export const capitalize = s => s ? s[0].toUpperCase() + s.slice(1) : s;

// Som Map.groupBy, som mangler i iOS eldre enn 17.4.
export const groupBy = (list, keyFn) => list.reduce((map, item) => {
  const key = keyFn(item);
  if (map.has(key)) map.get(key).push(item);
  else map.set(key, [item]);
  return map;
}, new Map());

// --- Samtalestatus -------------------------------------------------------------------

export const CALL_STATUS = {
  ringing: { label: 'Ringer', tone: 'info', pulse: true },
  active: { label: 'Pågår', tone: 'success', pulse: true },
  completed: { label: 'Fullført', tone: 'success' },
  missed: { label: 'Ikke besvart', tone: 'warning' },
  cancelled: { label: 'Avbrutt', tone: '' },
  declined: { label: 'Avvist', tone: 'warning' },
  dropped: { label: 'Brutt', tone: 'danger' },
  failed: { label: 'Feilet', tone: 'danger' },
  busy: { label: 'Opptatt', tone: '' },
  unreachable: { label: 'TV av', tone: '' },
};

export const statusBadge = status => {
  const s = CALL_STATUS[status] || { label: status, tone: '' };
  return h('span', { class: ['badge', 'dot', s.tone, s.pulse && 'pulse'] }, s.label);
};

export const END_REASON = {
  hangup: 'La på',
  'no-answer': 'Ingen svar',
  'tv-offline': 'TV-en var avslått',
  'tv-busy': 'TV-en var opptatt',
  'tv-lost': 'Mistet kontakt med TV-en',
  'relative-lost': 'Mistet kontakt med pårørende',
  'tv-restarted': 'TV-en startet på nytt',
  'ice-failed': 'Nettverksforbindelsen feilet',
  'media-error': 'Kamera/mikrofon-feil',
  'answer-failed': 'TV-en klarte ikke å svare',
  'page-closed': 'Siden ble lukket',
  'server-restart': 'Serveren startet på nytt',
  admin: 'Avsluttet av en ansatt',
  'tv-deleted': 'TV-boksen ble slettet',
  'relative-deleted': 'Den pårørende ble slettet',
  replaced: 'Erstattet av en ny samtale',
  'lost-state': 'Samtalen gikk tapt ved omstart',
};

export const ENDED_BY = { relative: 'Pårørende', tv: 'TV', staff: 'Ansatt', admin: 'Ansatt', system: 'System' };
export const ROUTE_LABEL = { direct: 'Direkte', stun: 'Via STUN', relay: 'Via TURN' };

// --- Tilbakemeldinger ---------------------------------------------------------------------

let toastHost;
export const toast = (message, type = 'info', ms = 3800) => {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const iconName = type === 'success' ? 'check' : type === 'error' ? 'x' : 'activity';
  const node = h('div', { class: ['toast', type], style: { '--ms': `${ms}ms` } }, icon(iconName), h('span', {}, message));
  toastHost.append(node);
  setTimeout(() => node.remove(), ms);
};

// Modal dialog med <dialog>. content kan være en funksjon som får { close }.
export const openModal = ({ title, content, actions = [], onClose, wide }) => {
  const dialog = h('dialog', { class: 'modal', style: wide ? { width: 'min(680px, calc(100% - 32px))' } : undefined });
  const close = value => { dialog.close(); dialog.remove(); onClose?.(value); };
  const body = typeof content === 'function' ? content({ close }) : content;
  dialog.append(
    h('div', { class: 'modal-head' },
      h('h3', {}, title),
      h('button', { class: 'btn ghost sm icon-only', type: 'button', 'aria-label': 'Lukk', onclick: () => close() }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    ...(actions.length ? [h('div', { class: 'modal-foot' }, actions.map(a => a({ close })))] : []),
  );
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  document.body.append(dialog);
  dialog.showModal();
  return { close, dialog };
};

export const confirmDialog = (message, { title = 'Er du sikker?', confirmText = 'Bekreft', danger = false } = {}) =>
  new Promise(resolve => {
    openModal({
      title,
      content: h('p', { class: 'muted' }, message),
      onClose: value => resolve(value === true),
      actions: [
        ({ close }) => h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, 'Avbryt'),
        ({ close }) => h('button', { class: ['btn', danger ? 'danger' : 'primary'], type: 'button', onclick: () => close(true) }, confirmText),
      ],
    });
  });

export const copyText = async (text, label = 'Kopiert') => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(label, 'success', 2000);
};

// Setter «disabled» på en knapp mens et løfte pågår. Med label vises også en spinner og teksten
// (f.eks. «Prøver igjen …»), og det opprinnelige innholdet settes tilbake etterpå.
export const busy = async (button, fn, label) => {
  const original = button.disabled;
  const content = label ? [...button.childNodes] : null;
  button.disabled = true;
  if (label) button.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), label);
  try { return await fn(); } finally {
    button.disabled = original;
    if (content) button.replaceChildren(...content);
  }
};
