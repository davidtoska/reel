// reel-quiz/1 – questions with 2–4 options. When the thinking time is up the right answer is
// highlighted, and a short fact can be shown.

import type { Layer, MediaSrc, Reel, Slide } from 'reel-format';
import { type CommonFields, type Sound, collectErrors, alpha, clip, flat, r1, reelHead, resolveTheme } from './common.ts';

export const QUIZ = 'reel-quiz/1';

export interface QuizDocument extends CommonFields {
  format: typeof QUIZ;
  /** Under the title on the first slide. */
  intro?: string;
  /** 1–50 questions. */
  questions: QuizQuestion[];
  /** Seconds before the answer is shown, 3–60. Default 10. */
  thinkSeconds?: number;
  /** Seconds the answer stays, 3–60. Default 6. */
  revealSeconds?: number;
  /** Played when the answer is shown. */
  revealSound?: Sound;
  /** Last slide. Default "Thanks for playing!". */
  closing?: string;
}

export interface QuizQuestion {
  /** ≤ 160 characters. */
  question: string;
  /** 2–4 options, ≤ 60 characters each. */
  options: string[];
  /** Index of the right option (0 = first). */
  answer: number;
  /** Behind the question, dimmed. */
  image?: MediaSrc;
  /** Shown with the answer, ≤ 160 characters. */
  fact?: string;
  /** The question read aloud; must end before the answer is shown. */
  narration?: Sound;
}

const LETTERS = ['A', 'B', 'C', 'D'];

export const validateQuiz = (doc: QuizDocument): string[] => {
  const e = collectErrors();
  e.common(doc);
  e.text(doc.intro, 160, 'intro');
  e.text(doc.closing, 80, 'closing');
  e.range(doc.thinkSeconds, 3, 60, 'thinkSeconds');
  e.range(doc.revealSeconds, 3, 60, 'revealSeconds');
  e.sound(doc.revealSound, 'revealSound');
  if (e.items(doc.questions, 1, 50, 'questions', 'questions')) doc.questions.forEach((q, i) => {
    const p = `questions[${i}]`;
    e.text(q?.question, 160, `${p}.question`, true);
    if (e.items(q?.options, 2, 4, `${p}.options`, 'options')) q.options.forEach((o, k) => e.text(o, 60, `${p}.options[${k}]`, true));
    e.check(Number.isInteger(q?.answer) && q.answer >= 0 && q.answer < (q.options?.length ?? 0), `${p}.answer`, 'must be the index of one of the options');
    e.text(q?.fact, 160, `${p}.fact`);
    e.sound(q?.narration, `${p}.narration`);
    if (q?.narration) e.check(0.5 + q.narration.duration <= (doc.thinkSeconds ?? 10), `${p}.narration`, 'must end before the answer is shown (thinkSeconds)');
  });
  return e.list;
};

export const compileQuiz = (doc: QuizDocument): Reel => {
  const t = resolveTheme(doc.theme, 'ocean');
  const think = doc.thinkSeconds ?? 10;
  const reveal = doc.revealSeconds ?? 6;
  const slides: Slide[] = [];

  const title: Layer[] = [{ type: 'text', text: doc.title, x: 5, y: doc.intro ? 30 : 38, w: 90, align: 'center', start: 0.4, fadeIn: 0.8,
    style: flat(t.accent, { size: 10, weight: 'bold' }) }];
  if (doc.intro) title.push({ type: 'text', text: doc.intro, x: 10, y: 54, w: 80, align: 'center', start: 1.2, fadeIn: 0.8, style: flat(t.text, { size: 5 }) });
  slides.push({ id: 'title', duration: 6, background: t.background, layers: title });

  doc.questions.forEach((q, i) => {
    const layers: Layer[] = [];
    if (q.image) {
      layers.push(
        { type: 'image', src: q.image, motion: { from: { scale: 1 }, to: { scale: 1.08 } } },
        { type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 100, fill: alpha(t.background, 'cc') },
      );
    }
    layers.push({ type: 'text', text: `${i + 1}. ${q.question}`, x: 6, y: 7, w: 88, h: 22, valign: 'middle', fadeIn: 0.6,
      style: flat(t.text, { size: 6, weight: 'bold' }) });

    // Rows for the options. The highlight of the right answer lies under its text and appears when time is up.
    const rowY = (k: number) => 34 + k * 13;
    layers.push({ type: 'shape', shape: 'rect', x: 6, y: rowY(q.answer) - 1, w: 88, h: 12, fill: t.accent, radius: 2, start: think, fadeIn: 0.5 });
    q.options.forEach((o, k) => {
      layers.push({ type: 'text', text: `${LETTERS[k]}   ${o}`, x: 9, y: rowY(k), w: 82, h: 10, valign: 'middle',
        start: r1(1 + k * 0.6), fadeIn: 0.5, style: flat(t.text, { size: 5.5 }) });
    });
    if (q.fact) {
      layers.push({ type: 'text', text: q.fact, x: 6, y: 87, w: 88, align: 'center', start: r1(think + 0.8), fadeIn: 0.6,
        style: { size: 4, color: t.surfaceText, background: alpha(t.surface, 'ee'), padding: 1, radius: 1, shadow: false } });
    }
    const audio = [
      ...(q.narration ? [clip(q.narration, 0.5)] : []),
      ...(doc.revealSound ? [clip(doc.revealSound, think, { duck: false })] : []),
    ].filter(a => (a.start ?? 0) + a.duration <= think + reveal + 0.05);
    slides.push({ id: `question-${i + 1}`, duration: think + reveal, background: t.background, layers, ...(audio.length > 0 && { audio }) });
  });

  slides.push({ id: 'end', duration: 6, background: t.accent, layers: [
    { type: 'text', text: doc.closing ?? 'Thanks for playing!', x: 5, y: 0, w: 90, h: 100, align: 'center', valign: 'middle',
      fadeIn: 1, fadeOut: 1, style: flat(t.accentText, { size: 9, weight: 'bold' }) },
  ] });

  return {
    ...reelHead(doc, { text: { style: { font: t.font, size: 5, color: t.text } }, transition: { type: 'fade', duration: 0.8 } }),
    slides,
  };
};
