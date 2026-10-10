// reel-format – Reel 1.0 without the DOM: the format's types, validation, resolving and packages.
// Runs in Node and in browsers. The player is in reel-dom; the JSON Schema is in reel-schema.
//
//   import { validateReel, resolveReel, readReelPackage } from 'reel-format';
//
//   const checked = validateReel(JSON.parse(text));
//   if (!checked.ok) console.error(checked.errors);   // ["slides[1].duration: must be 1–600", …]

export * from './format.ts';
export { validateReel, checkMediaSrc, extensionOf, type ValidationResult } from './validate.ts';
export { resolveReel, reelDuration, slideStarts, type ResolveOptions } from './resolve.ts';
export {
  readReelPackage, writeReelPackage, checkPackageFiles, reelMediaRefs, isSystemFile, crc32,
  REEL_PACKAGE_DEFAULTS, type ReelPackageResult,
} from './package.ts';
