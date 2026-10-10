// Full-screen player page: play.html?src=<url of reel.json>[&offset=<s>][&loop=0]
// A ReelPlayer in a <div> that fills the window – the same way any other site or app plays a published reel.
//
// Keys: space play/pause · ← → previous/next slide · Home start · End end · F full screen.

import { ReelLoadError, ReelPlayer } from 'reel-player';
import { h } from './ui.ts';

const params = new URLSearchParams(location.search);
const src = params.get('src');
const offset = Number(params.get('offset')) || 0;

const screen = h('div', { class: 'screen' });       // the host element: its size is the size of the picture
const hint = h('div', { class: 'hint', hidden: true }, 'Click or press a key for sound');
const errors = h('div', { class: 'errors', hidden: true });
const back = h('a', { class: 'back', href: '/' }, '← Studio');
document.body.append(screen, hint, errors, back);

const player = new ReelPlayer(screen, { loop: params.get('loop') !== '0' });
player.on('audioblocked', () => { hint.hidden = false; });
player.on('error', e => console.warn('Missing file', e.src));

const showErrors = (title: string, list: string[]) => {
  errors.hidden = false;
  errors.replaceChildren(h('strong', {}, title), h('ul', {}, list.map(x => h('li', {}, x))));
};

document.addEventListener('pointerdown', () => { hint.hidden = true; });
document.addEventListener('keydown', e => {
  hint.hidden = true;
  const keys: Record<string, () => void> = {
    ' ': () => (player.state === 'playing' ? player.pause() : player.play()),
    ArrowRight: () => player.next(),
    ArrowLeft: () => player.previous(),
    Home: () => player.stop(),
    End: () => player.seekToEnd(),
    f: () => { player.toggleFullscreen().catch(() => {}); },
  };
  const action = keys[e.key];
  if (action) { e.preventDefault(); action(); }
});
screen.addEventListener('dblclick', () => { player.toggleFullscreen().catch(() => {}); });

// Hide the cursor and the back link while the mouse is still.
let idle: ReturnType<typeof setTimeout> | undefined;
const wake = () => {
  document.body.classList.remove('idle');
  clearTimeout(idle);
  idle = setTimeout(() => document.body.classList.add('idle'), 2500);
};
document.addEventListener('pointermove', wake);
wake();

if (!src) showErrors('Nothing to play', ['Add ?src=<url of reel.json>']);
else {
  try {
    await player.load(src);
    if (offset) player.seek(offset);
    player.play();
  } catch (err) {
    if (err instanceof ReelLoadError) showErrors('This reel cannot be played', err.errors);
    else throw err;
  }
}
