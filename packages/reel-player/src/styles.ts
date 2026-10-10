// The player's own CSS. It is placed inside the host element, so the player looks the same in any page
// and inside shadow DOM. It never sets the host's size, position or display: the page decides those.
// Class names are stable and may be used for overlays:
//   reel-host (the host element) > reel-stage (fills it) > reel-canvas (16:9) > reel-slide > reel-layer
// Every size is relative to --reel-h, the canvas height in pixels.
// Set --reel-font-sans / --reel-font-serif on the host to use other fonts.

/** The CSS the player puts inside the host element. Exported for tools that draw slides themselves; stable in 1.x. */
export const PLAYER_CSS = `
.reel-stage { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; background: #000; }
:where(.reel-host):fullscreen { width: 100vw; height: 100vh; background: #000; }
.reel-host.reel-idle:fullscreen { cursor: none; }
.reel-canvas { position: relative; flex: none; overflow: hidden; background: #000; font-family: var(--reel-font-sans, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif); }
.reel-slide { position: absolute; top: 0; right: 0; bottom: 0; left: 0; overflow: hidden; }
.reel-layer { position: absolute; display: flex; flex-direction: column; overflow: hidden; }
.reel-layer-text { overflow: visible; }
.reel-layer img, .reel-layer video { width: 100%; height: 100%; display: block; }
.reel-text { max-width: 100%; white-space: pre-line; overflow-wrap: break-word; }
.reel-credit {
  position: absolute; right: calc(var(--reel-h) * 1.2 / 100); bottom: calc(var(--reel-h) * 1 / 100);
  font-size: calc(var(--reel-h) * 1.8 / 100); color: rgba(255, 255, 255, .8); text-shadow: 0 0 4px rgba(0, 0, 0, .9); pointer-events: none;
}
`;
