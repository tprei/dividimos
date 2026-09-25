/** Scenes mark the SVG nodes they animate with `data-part` and look them up once per run. */
export function scenePart<T extends Element>(root: Element, name: string): T {
  const node = root.querySelector<T>(`[data-part="${name}"]`);
  if (node === null) throw new Error(`Missing scene part: ${name}`);
  return node;
}

export function sceneParts<T extends Element>(root: Element, name: string): T[] {
  return Array.from(root.querySelectorAll<T>(`[data-part="${name}"]`));
}

export function setOpacity(node: SVGElement, opacity: number): void {
  node.style.opacity = String(opacity);
}

export function setFlag(node: Element, flag: string, on: boolean): void {
  node.toggleAttribute(`data-${flag}`, on);
}
