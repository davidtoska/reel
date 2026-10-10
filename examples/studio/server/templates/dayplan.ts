// reel-dayplan/1 – today's programme: a greeting, items with times, notes and a closing slide.
// Items are spread over pages of at most five and appear one by one.

import type { Layer, MediaSrc, Reel, Slide } from 'reel-format';
import { type CommonFields, type Sound, collectErrors, alpha, chunk, clip, flat, r1, reelHead, resolveTheme } from './common.ts';

export const DAYPLAN = 'reel-dayplan/1';

export interface DayPlanDocument extends CommonFields {
  format: typeof DAYPLAN;
  /** The greeting on the first slide, e.g. "Good morning!". */
  greeting: string;
  /** Free text under the greeting, e.g. "Wednesday 7 October". */
  date?: string;
  /** Image behind the greeting. */
  image?: MediaSrc;
  /** Above the items. Default "Today". */
  heading?: string;
  /** 1–30 items, in order. */
  items: DayPlanItem[];
  /** Seconds between items appearing, 1–10. Default 2. */
  secondsPerItem?: number;
  /** Slides after the programme: weather, menu, a message … */
  notes?: DayPlanNote[];
  /** Text on the last slide. */
  closing?: string;
  /** Played at the greeting, at each programme page and at the closing slide. */
  chime?: Sound;
}

export interface DayPlanItem {
  /** E.g. "10:00". */
  time: string;
  /** ≤ 60 characters. */
  text: string;
}

export interface DayPlanNote {
  /** ≤ 40 characters. */
  heading: string;
  /** ≤ 300 characters, \n for line breaks. */
  text: string;
  /** On the right half. */
  image?: MediaSrc;
  /** Default 10. */
  seconds?: number;
}

const PER_PAGE = 5;

export const validateDayPlan = (doc: DayPlanDocument): string[] => {
  const e = collectErrors();
  e.common(doc);
  e.text(doc.greeting, 60, 'greeting', true);
  e.text(doc.date, 80, 'date');
  e.text(doc.heading, 40, 'heading');
  e.text(doc.closing, 80, 'closing');
  e.range(doc.secondsPerItem, 1, 10, 'secondsPerItem');
  e.sound(doc.chime, 'chime');
  if (e.items(doc.items, 1, 30, 'items', 'items')) doc.items.forEach((it, i) => {
    e.text(it?.time, 12, `items[${i}].time`, true);
    e.text(it?.text, 60, `items[${i}].text`, true);
  });
  if (doc.notes != null && e.items(doc.notes, 0, 20, 'notes', 'notes')) doc.notes.forEach((n, i) => {
    e.text(n?.heading, 40, `notes[${i}].heading`, true);
    e.text(n?.text, 300, `notes[${i}].text`, true);
    e.range(n?.seconds, 3, 120, `notes[${i}].seconds`);
  });
  return e.list;
};

export const compileDayPlan = (doc: DayPlanDocument): Reel => {
  const t = resolveTheme(doc.theme, 'warm');
  const step = doc.secondsPerItem ?? 2;
  const chime = (start: number) => (doc.chime ? { audio: [clip(doc.chime, start)] } : {});
  const slides: Slide[] = [];

  // Greeting: on a card over the image, or centred on the background.
  const greeting: Layer[] = doc.image
    ? [
        { type: 'image', src: doc.image, motion: { from: { scale: 1, x: 35, y: 70 }, to: { scale: 1.1, x: 35, y: 70 } } },
        { type: 'shape', shape: 'rect', x: 5, y: 8, w: 52, h: doc.date ? 34 : 24, fill: alpha(t.surface, 'e6'), radius: 3, start: 0.3, fadeIn: 0.8 },
        { type: 'text', text: doc.greeting, x: 8, y: 12, w: 46, start: 0.6, fadeIn: 0.8, style: flat(t.accent, { size: 10, weight: 'bold' }) },
      ]
    : [{ type: 'text', text: doc.greeting, x: 5, y: 32, w: 90, align: 'center', start: 0.6, fadeIn: 0.8, style: flat(t.accent, { size: 12, weight: 'bold' }) }];
  if (doc.date) {
    greeting.push(doc.image
      ? { type: 'text', text: doc.date, x: 8, y: 29, w: 46, start: 1.4, fadeIn: 0.8, style: flat(t.surfaceText, { size: 5 }) }
      : { type: 'text', text: doc.date, x: 5, y: 56, w: 90, align: 'center', start: 1.4, fadeIn: 0.8, style: flat(t.text, { size: 5.5 }) });
  }
  slides.push({ id: 'greeting', duration: 8, background: t.background, layers: greeting, ...chime(0.4) });

  const pages = chunk(doc.items, PER_PAGE);
  pages.forEach((items, p) => {
    const heading = (doc.heading ?? 'Today') + (pages.length > 1 ? `  (${p + 1}/${pages.length})` : '');
    const layers: Layer[] = [
      { type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 18, fill: t.accent },
      { type: 'text', text: heading, x: 5, y: 0, w: 90, h: 18, valign: 'middle', start: 0.2, fadeIn: 0.5, style: flat(t.accentText, { size: 7, weight: 'bold' }) },
    ];
    items.forEach((it, k) => {
      const y = 26 + k * 14;
      const start = r1(0.8 + k * step);
      layers.push(
        { type: 'text', text: it.time, x: 6, y, w: 18, h: 10, valign: 'middle', start, fadeIn: 0.6, style: flat(t.accent, { weight: 'bold' }) },
        { type: 'text', text: it.text, x: 24, y, w: 70, h: 10, valign: 'middle', start, fadeIn: 0.6, style: flat(t.text) },
      );
    });
    const duration = r1(Math.max(10, 0.8 + (items.length - 1) * step + 6));
    slides.push({ id: `programme-${p + 1}`, duration, background: t.background, layers, ...chime(0.8) });
  });

  doc.notes?.forEach((n, i) => {
    const width = n.image ? 44 : 88;
    const layers: Layer[] = [];
    if (n.image) layers.push({ type: 'image', src: n.image, x: 55, y: 0, w: 45, h: 100, motion: { from: { scale: 1 }, to: { scale: 1.08 } } });
    layers.push(
      { type: 'text', text: n.heading, x: 6, y: 18, w: width, start: 0.4, fadeIn: 0.6, style: flat(t.accent, { size: 7, weight: 'bold' }) },
      { type: 'text', text: n.text, x: 6, y: 34, w: width, start: 1, fadeIn: 0.8, style: flat(t.text, { size: 5, lineHeight: 1.5 }) },
    );
    slides.push({ id: `note-${i + 1}`, duration: n.seconds ?? 10, background: t.background, layers });
  });

  if (doc.closing) {
    slides.push({ id: 'closing', duration: 7, background: t.accent, layers: [
      { type: 'text', text: doc.closing, x: 5, y: 0, w: 90, h: 100, align: 'center', valign: 'middle', fadeIn: 1, fadeOut: 1,
        style: flat(t.accentText, { size: 11, weight: 'bold' }) },
    ], ...chime(0.5) });
  }

  return {
    ...reelHead(doc, { text: { style: { font: t.font, size: 5, color: t.text } }, transition: { type: 'fade', duration: 0.8 } }),
    slides,
  };
};
