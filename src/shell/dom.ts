type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | EventListener | null | undefined>;

/** Tiny element builder: h('div.card', { onclick }, child, ...) */
export function h<K extends keyof HTMLElementTagNameMap>(
  spec: K | `${K}.${string}`,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.') as [K, ...string[]];
  const el = document.createElement(tag);
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const SVG = 'http://www.w3.org/2000/svg';

/** 30-day sparkline as bars; colour comes from `currentColor`. */
export function sparkline(values: number[], width = 90, height = 18): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('preserveAspectRatio', 'none');
  const max = Math.max(1, ...values);
  const bw = width / values.length;
  values.forEach((v, i) => {
    const r = document.createElementNS(SVG, 'rect');
    const bh = v === 0 ? 1 : Math.max(2, Math.round((v / max) * height));
    r.setAttribute('x', (i * bw + 0.5).toFixed(2));
    r.setAttribute('y', String(height - bh));
    r.setAttribute('width', Math.max(1, bw - 1).toFixed(2));
    r.setAttribute('height', String(bh));
    if (v === 0) r.setAttribute('class', 'zero');
    svg.append(r);
  });
  return svg;
}
