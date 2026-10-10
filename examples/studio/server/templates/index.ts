// The templates the studio understands, and compile(): any accepted document → Reel 1.0.
// A document with `format: "reel/1"` passes through unchanged.

import { REEL_FORMAT, validateReel, type Reel } from 'reel-format';
import { ALBUM, type AlbumDocument, compileAlbum, validateAlbum } from './album.ts';
import { DAYPLAN, type DayPlanDocument, compileDayPlan, validateDayPlan } from './dayplan.ts';
import { QUIZ, type QuizDocument, compileQuiz, validateQuiz } from './quiz.ts';
import { THEMES } from './common.ts';

/** A file to copy from the studio's library into the reel's media folder. */
export interface MediaImport {
  /** Path in the library, e.g. "images/fjord.svg". */
  from: string;
  /** File name in media/. Default: the library file's name. */
  as?: string;
}

interface Template<D> {
  format: string;
  label: string;
  description: string;
  validate: (doc: D) => string[];
  compile: (doc: D) => Reel;
  /** A complete example: the document and the library files it uses. */
  example: { document: D; media: MediaImport[] };
}

const album: Template<AlbumDocument> = {
  format: ALBUM,
  label: 'Photo album',
  description: 'Photos with captions and optional narration. Title slide, slow zoom and timing are automatic.',
  validate: validateAlbum,
  compile: compileAlbum,
  example: {
    document: {
      format: ALBUM, title: 'Shapes and places', subtitle: 'A demo album', theme: 'night',
      music: { src: 'media/music-box.wav', duration: 30, volume: 0.3, duckTo: 0.1 },
      photos: [
        { src: 'media/garden.svg', caption: 'A garden that does not exist', focus: { x: 40, y: 55 },
          narration: { src: 'media/birds.wav', duration: 4, transcript: '(birdsong)' } },
        { src: 'media/shapes-1.svg', caption: 'Circles' },
        { src: 'media/fjord.svg', caption: 'An imaginary fjord', focus: { x: 51, y: 74 } },
        { src: 'media/shapes-2.svg', caption: 'Triangles', credit: 'Generated demo image' },
      ],
      ending: 'The end',
    },
    media: ['images/garden.svg', 'images/shapes-1.svg', 'images/fjord.svg', 'images/shapes-2.svg', 'audio/music-box.wav', 'audio/birds.wav'].map(from => ({ from })),
  },
};

const dayplan: Template<DayPlanDocument> = {
  format: DAYPLAN,
  label: 'Day plan',
  description: 'A greeting, a list of items with times, notes and a closing slide.',
  validate: validateDayPlan,
  compile: compileDayPlan,
  example: {
    document: {
      format: DAYPLAN, title: 'Demo day plan', theme: 'warm', greeting: 'Good morning!', date: 'Any day of the week',
      image: 'media/morning.svg',
      music: { src: 'media/music-pluck.wav', duration: 19.2, volume: 0.3, duckTo: 0.08 },
      chime: { src: 'media/ding-dong.wav', duration: 2.6, volume: 0.8 },
      items: [
        { time: '09:00', text: 'Something in the morning' },
        { time: '11:00', text: 'Something before lunch' },
        { time: '12:30', text: 'Lunch' },
        { time: '15:00', text: 'Coffee and cake' },
        { time: '18:00', text: 'Something in the evening' },
      ],
      notes: [{ heading: 'Weather', text: 'Sunny with a chance of demo data', image: 'media/sunset.svg' }],
      closing: 'Have a nice day!',
    },
    media: ['images/morning.svg', 'images/sunset.svg', 'audio/music-pluck.wav', 'audio/ding-dong.wav'].map(from => ({ from })),
  },
};

const quiz: Template<QuizDocument> = {
  format: QUIZ,
  label: 'Quiz',
  description: 'Questions with 2–4 options. The right answer is highlighted when the thinking time is up.',
  validate: validateQuiz,
  compile: compileQuiz,
  example: {
    document: {
      format: QUIZ, title: 'Shape quiz', intro: 'Three questions about shapes', theme: 'ocean',
      music: { src: 'media/music-calm.wav', duration: 32, volume: 0.25, duckTo: 0.08 },
      revealSound: { src: 'media/chime.wav', duration: 3, volume: 0.7 },
      thinkSeconds: 8, revealSeconds: 5,
      questions: [
        { question: 'How many corners does a triangle have?', options: ['Two', 'Three', 'Four'], answer: 1, image: 'media/shapes-2.svg', fact: 'Tri means three.' },
        { question: 'Which shape has no corners?', options: ['Square', 'Circle', 'Triangle', 'Hexagon'], answer: 1, image: 'media/shapes-1.svg' },
        { question: 'How many sides does a hexagon have?', options: ['Five', 'Six', 'Eight'], answer: 1, fact: 'Bees build hexagons.' },
      ],
    },
    media: ['images/shapes-1.svg', 'images/shapes-2.svg', 'audio/music-calm.wav', 'audio/chime.wav'].map(from => ({ from })),
  },
};

export const TEMPLATES = [album, dayplan, quiz] as unknown as Template<unknown>[];
export { THEMES };

export type CompileResult = { ok: true; format: string; reel: Reel } | { ok: false; format?: string; errors: string[] };

/** Validates a document of any accepted format and compiles it to Reel 1.0. Accepts unknown JSON. */
export const compile = (input: unknown): CompileResult => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['document: must be a JSON object'] };
  const format = (input as { format?: unknown }).format;
  if (format === REEL_FORMAT) {
    const r = validateReel(input);
    return r.ok ? { ok: true, format, reel: r.reel } : { ok: false, format, errors: r.errors };
  }
  const t = TEMPLATES.find(x => x.format === format);
  if (!t) return { ok: false, format: String(format), errors: [`format: unknown – use ${[REEL_FORMAT, ...TEMPLATES.map(x => x.format)].join(', ')}`] };
  try {
    const errors = t.validate(input);
    if (errors.length) return { ok: false, format: t.format, errors };
    const r = validateReel(t.compile(input));
    // The generated reel is checked too (too many layers, audio that is too long …).
    return r.ok ? { ok: true, format: t.format, reel: r.reel } : { ok: false, format: t.format, errors: r.errors.map(e => `generated ${e}`) };
  } catch (err) {
    return { ok: false, format: t.format, errors: [`could not read the document: ${(err as Error).message}`] };
  }
};
