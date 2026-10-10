// The web APIs reel-format uses, declared by hand. They exist in Node 20.12+ and in browsers.
// The package is compiled without the DOM and Node type libraries ("types": [] in tsconfig.json), so
// anything not declared here – Buffer, process, node: modules, document, window – fails to compile
// instead of slipping into a package that must run in both. Only what the code calls is declared.
// This file is not part of the published types: nothing in dist/*.d.ts refers to it, and consumers
// get these types from their own DOM or Node type definitions.

interface URL {
  readonly href: string;
  readonly protocol: string;
  readonly host: string;
  toString(): string;
}
declare var URL: { new (url: string | URL, base?: string | URL): URL };

interface TextEncoder { encode(input?: string): Uint8Array<ArrayBuffer> }
declare var TextEncoder: { new (): TextEncoder };

interface TextDecoder { decode(input?: Uint8Array): string }
declare var TextDecoder: { new (label?: string, options?: { fatal?: boolean }): TextDecoder };

interface ReadableStreamDefaultReader<R> {
  read(): Promise<{ done: true; value?: undefined } | { done: false; value: R }>;
  cancel(reason?: unknown): Promise<void>;
}
interface ReadableStream<R> {
  pipeThrough<T>(transform: { writable: WritableStream<R>; readable: ReadableStream<T> }): ReadableStream<T>;
  getReader(): ReadableStreamDefaultReader<R>;
}
// Only handed from DecompressionStream to pipeThrough, never used directly.
interface WritableStream<W> { readonly locked: boolean }

interface Blob { stream(): ReadableStream<Uint8Array> }
declare var Blob: { new (parts: Uint8Array<ArrayBuffer>[]): Blob };

declare var DecompressionStream: {
  new (format: 'deflate-raw'): { readonly writable: WritableStream<Uint8Array>; readonly readable: ReadableStream<Uint8Array> };
};
