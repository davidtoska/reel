// Tiny element builder used by the player. No framework.

export type Child = Node | string | number | null | undefined | false | Child[];
export type Attrs = Record<string, unknown> | null;

/** Creates an element. Properties are set when the element has them, attributes otherwise. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K];
export function h(tag: string, attrs: Attrs = {}, ...children: Child[]): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
    else if (key in node && typeof value !== 'string') (node as unknown as Record<string, unknown>)[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of (children as unknown[]).flat(Infinity) as Child[]) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}
