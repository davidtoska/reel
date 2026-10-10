// reel-format – Reel 1.0: the format, its validation and the player.
//
//   import { validateReel, resolveReel, createReelPlayer } from 'reel-format';
//
//   const res = await fetch(url);
//   const checked = validateReel(await res.json());
//   if (!checked.ok) throw new Error(checked.errors.join('\n'));
//   const player = createReelPlayer({ element: document.querySelector('#screen')! });
//   player.play(resolveReel(checked.reel, { baseUrl: res.url }));
//
// or, with the custom element: defineReelPlayerElement() and <reel-player src="…/reel.json" autoplay>.

export * from './format.ts';
export { validateReel, checkMediaSrc, extensionOf, type ValidationResult } from './validate.ts';
export { resolveReel, reelDuration, slideStarts, type ResolveOptions } from './resolve.ts';
export { createReelPlayer, visibilityKeyframes, motionKeyframes, type ReelPlayer, type ReelPlayerOptions } from './player.ts';
export { defineReelPlayerElement, type ReelPlayerElement } from './element.ts';
