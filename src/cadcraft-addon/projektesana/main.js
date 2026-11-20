/* SPDX-License-Identifier: Apache-2.0 */
/**
 * main.js — the Projektēšanas App bridge for CadCraft (add-on API 1.0, app/addons/cadcraft-api.js). CadCraft runs in a frame of
 * the app for DWG; this add-on is the only thing that talks to the app, through one port: window.parent in the app, a
 * MessageChannel port in tests (globalThis.__pjPort). Every message is { pj: 1, type, … }.
 *
 *   app → CadCraft   open { name, bytes }        open a DWG / DXF the app holds, through CadCraft's own open (as a drop)
 *                    marks { spaces }            the changes of a compare, drawn OVER the drawing on a canvas of their own
 *                                                (never into the drawing: nothing to save, nothing to lose): per space
 *                                                { name ("" = model), sets: [{ lines: [x1,y1,x2,y2,…], color, width, dash }] };
 *                                                [] clears
 *                    view { cx, cy, zoom }       move the view there (a linked second drawing follows the first)
 *                    watch { on }                post the view whenever the user moves it
 *                    fly { x, y, zoom? }         centre a place (a picked change), closer in
 *                    fit                         the whole drawing
 *   CadCraft → app   ready                       the bridge is active
 *                    opened { name, objects, layers }
 *                    view { cx, cy, zoom }       the view moved (only while watched)
 *                    error { message }
 * The look: the app's one stylesheet for its frames (compact.css, shared with BimCraft's bridge) and CadCraft's dark theme.
 */

const OPEN_TIMEOUT = 60_000;

function defaultPort() {
  const w = globalThis.window;
  if (!w || w.parent === w) return null;
  return {
    post: (m) => w.parent.postMessage(m, '*'),
    on: (fn) => w.addEventListener('message', (e) => { if (e.source === w.parent && e.data && e.data.pj === 1) fn(e.data); }),
  };
}

/** CadCraft's page objects ("Studio Live" and the console use them: window.cadcraft = { doc, view, engine, host, commands }). */
const cad = () => globalThis.__pjCad || globalThis.cadcraft || null;

/** The space on screen: "" for model space, else the sheet's name (compare spaces carry the same names). */
export function spaceName(doc) {
  if (!doc || doc.inModel) return '';
  return doc.layout?.name ?? '';
}

/** The app's look: its frames' stylesheet next to this file, and CadCraft's dark theme unless the user picked one. */
export function compactLook(doc = globalThis.document, storage = globalThis.localStorage, href = new URL('./compact.css', import.meta.url).href) {
  if (!doc?.head || doc.getElementById('pj-compact')) return false;
  const link = doc.createElement('link');
  link.id = 'pj-compact';
  link.rel = 'stylesheet';
  link.href = href;
  doc.head.appendChild(link);
  let space = null;
  try { space = storage?.getItem('cc-space') ?? null; } catch { /* no storage */ }
  if (!space) doc.documentElement.setAttribute('data-space', 'model');
  return true;
}

/** Valid marks from the app: dropped silently when malformed (a mark is a picture, not data). */
export function cleanMarks(spaces) {
  if (!Array.isArray(spaces)) return [];
  return spaces.filter((s) => s && typeof s.name === 'string' && Array.isArray(s.sets)).map((s) => ({
    name: s.name,
    sets: s.sets.filter((x) => x && Array.isArray(x.lines) && typeof x.color === 'string').map((x) => ({
      lines: x.lines.length % 4 === 0 && x.lines.every((n) => typeof n === 'number' && Number.isFinite(n)) ? x.lines : [],
      color: x.color,
      width: typeof x.width === 'number' ? x.width : 2,
      dash: Array.isArray(x.dash) ? x.dash.filter((n) => typeof n === 'number') : [],
    })),
  }));
}

export function activate() {
  const port = globalThis.__pjPort || defaultPort();
  if (!port) return;   // CadCraft on its own: the bridge has nobody to talk to
  compactLook();
  const post = (type, body = {}) => port.post({ pj: 1, type, ...body });

  // ---- the marks layer: a canvas over CadCraft's, redrawn whenever the view or the space changes ----
  let marks = [];
  let overlay = null;
  let last = '';
  let watching = false;
  let sent = '';
  const stage = () => globalThis.document?.querySelector('[data-stage] .cc-canvases') || globalThis.document?.querySelector('[data-stage]');
  const ensureOverlay = () => {
    const host = stage();
    if (!host) return null;
    if (overlay && overlay.parentNode === host) return overlay;
    overlay = globalThis.document.createElement('canvas');
    overlay.className = 'pj-marks';
    Object.assign(overlay.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 });
    if (globalThis.getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(overlay);
    return overlay;
  };
  const draw = () => {
    const c = cad();
    const v = c?.view;
    if (!v) return;
    const key = `${v.cx}|${v.cy}|${v.zoom}|${v.w}|${v.h}|${v.tw || 0}|${spaceName(c.doc)}|${marks.length}`;
    if (watching && key !== sent) {
      sent = key;
      post('view', { cx: v.cx, cy: v.cy, zoom: v.zoom });
    }
    if (key === last) return;
    last = key;
    const cv = ensureOverlay();
    if (!cv) return;
    const dpr = globalThis.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const here = marks.find((s) => s.name === spaceName(c.doc));
    if (!here) return;
    for (const set of here.sets) {
      if (!set.lines.length) continue;
      g.strokeStyle = set.color;
      g.lineWidth = set.width;
      g.setLineDash(set.dash);
      g.beginPath();
      const p = set.lines;
      for (let i = 0; i + 3 < p.length; i += 4) {
        const a = v.toScreen(p[i], p[i + 1]), b = v.toScreen(p[i + 2], p[i + 3]);
        g.moveTo(a.x, a.y);
        g.lineTo(b.x, b.y);
      }
      g.stroke();
    }
  };
  let raf = 0;
  const loop = () => { try { draw(); } catch { /* a frame without a view */ } raf = globalThis.requestAnimationFrame?.(loop) ?? 0; };
  if (globalThis.requestAnimationFrame) raf = globalThis.requestAnimationFrame(loop);

  /** Opens bytes as CadCraft opens a dropped file (its own open: tab, layers, sheets, fit), then waits for the drawing. */
  const open = async (bytes, name) => {
    const doc = globalThis.document;
    const target = doc?.querySelector('[data-stage]');
    if (!target || typeof DataTransfer !== 'function') throw new Error('CadCraft is not ready to open a file');
    const file = new File([bytes], name);
    const dt = new DataTransfer();
    dt.items.add(file);
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    const t0 = Date.now();
    while (Date.now() - t0 < OPEN_TIMEOUT) {
      const d = cad()?.doc;
      if (d?.meta?.source === name) return d;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`CadCraft did not open ${name}`);
  };

  port.on(async (m) => {
    try {
      const c = cad();
      if (m.type === 'open') {
        marks = [];
        last = '';
        const name = String(m.name || 'drawing.dwg');
        const d = await open(m.bytes instanceof Uint8Array ? m.bytes : new Uint8Array(m.bytes), name);
        post('opened', { name, objects: typeof d.count === 'function' ? d.count() : null, layers: d.layers?.size ?? null });
      } else if (m.type === 'marks') {
        marks = cleanMarks(m.spaces);
        last = '';
      } else if (m.type === 'view' && c?.view) {
        if ([m.cx, m.cy, m.zoom].every((n) => typeof n === 'number' && Number.isFinite(n)) && m.zoom > 0) {
          const v = c.view;
          if (v.cx !== m.cx || v.cy !== m.cy || v.zoom !== m.zoom) {
            v.cx = m.cx; v.cy = m.cy; v.zoom = m.zoom;
            sent = `${v.cx}|${v.cy}|${v.zoom}|${v.w}|${v.h}|${v.tw || 0}|${spaceName(c.doc)}|${marks.length}`;   // not echoed back
            v.invalidate(true);
          }
        }
      } else if (m.type === 'watch') {
        watching = !!m.on;
        sent = '';
      } else if (m.type === 'fly' && c?.view) {
        if (typeof m.x === 'number' && typeof m.y === 'number') {
          const v = c.view;
          v.cx = m.x; v.cy = m.y;
          v.zoom = typeof m.zoom === 'number' && m.zoom > 0 ? m.zoom : v.zoom * 4;
          v.invalidate(true);
        }
      } else if (m.type === 'fit' && c?.view) {
        c.view.fit();
      }
    } catch (e) {
      post('error', { message: e?.message || String(e) });
    }
  });
  post('ready');
  return { stop: () => globalThis.cancelAnimationFrame?.(raf) };
}
