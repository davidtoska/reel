// Full-screen player page: play.html?src=<url of reel.json>[&offset=<s>][&loop=0]
// Uses the <reel-player> element from reel-format – the same way any other site can play a published reel.

import { defineReelPlayerElement, type ReelPlayerElement } from 'reel-format';
import { h } from './ui.ts';

defineReelPlayerElement();

const params = new URLSearchParams(location.search);
const src = params.get('src');
const player = h('reel-player', { class: 'fullscreen', autoplay: true, ...(params.get('loop') !== '0' && { loop: true }), offset: params.get('offset') ?? '0' }) as ReelPlayerElement;
const hint = h('div', { class: 'hint', hidden: true }, 'Click or press a key for sound');
const errors = h('div', { class: 'errors', hidden: true });
const back = h('a', { class: 'back', href: '/' }, '← Studio');

player.addEventListener('reel-audio-blocked', () => { hint.hidden = false; });
document.addEventListener('pointerdown', () => { hint.hidden = true; });
document.addEventListener('keydown', e => {
  hint.hidden = true;
  if (e.key === 'f') void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
});
player.addEventListener('reel-invalid', e => {
  errors.hidden = false;
  errors.replaceChildren(h('strong', {}, 'This reel cannot be played'), h('ul', {}, (e as CustomEvent<{ errors: string[] }>).detail.errors.map(x => h('li', {}, x))));
});
player.addEventListener('reel-error', e => console.warn('reel-error', (e as CustomEvent).detail));

// Hide the cursor and the back link while the mouse is still.
let idle: ReturnType<typeof setTimeout> | undefined;
const wake = () => {
  document.body.classList.remove('idle');
  clearTimeout(idle);
  idle = setTimeout(() => document.body.classList.add('idle'), 2500);
};
document.addEventListener('pointermove', wake);
wake();

document.body.append(player, hint, errors, back);
if (src) player.src = src;
else {
  errors.hidden = false;
  errors.textContent = 'Nothing to play: add ?src=<url of reel.json>';
}
