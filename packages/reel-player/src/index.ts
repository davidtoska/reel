// reel-player – the Reel player for browsers. Install it together with reel-format.
//
//   import { ReelPlayer } from 'reel-player';
//
//   const player = new ReelPlayer(hostElement, { loop: true });   // an HTMLElement, not a selector
//   await player.load('https://example.com/my-reel/reel.json');
//   player.play();

export { ReelPlayer, ReelLoadError, type ReelPlayerOptions, type ReelPlayerState, type ReelPlayerEvents, type SlidePosition } from './player.ts';
export type { ReelPlayerError, SlideShown } from './engine.ts';
export { visibilityKeyframes, motionKeyframes } from './engine.ts';
export { PLAYER_CSS } from './styles.ts';
