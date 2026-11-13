/* SPDX-License-Identifier: Apache-2.0 */
/**
 * main.js — the Projektēšanas App bridge, an add-on on BimCraft's add-on API 1.1 (app/addons/bimcraft-api.js).
 * BimCraft runs in a frame of Projektēšanas App; this add-on is the only thing that talks to the app, through one port:
 * window.parent in the app, a MessageChannel port in the tests (globalThis.__pjPort). Every message is { pj: 1, type, … }.
 *
 *   app → BimCraft   open { name, bytes }        open an IFC the app holds (through this add-on's importer: ".pjifc")
 *                    select { ids }             select by express id
 *                    highlight { guids }        select by GlobalId (the agent's highlight tool)
 *                    sketch                     answer with the current markup (the selection with its places)
 *                    markers { markers }        draw the app's pins as numbered dots on their elements (replaces; [] clears)
 *                    fly { camera | guid }      move the camera to a pin's saved view, or frame the element
 *                    capture                    answer with the selection, the camera and the BCF viewpoint (a new pin's place)
 *                    props { id | guid }        answer with the element's attributes and property sets (the viewer's Properties window)
 *                    tree                       answer with the spatial structure: project, site, building, storeys, their elements
 *                    meta                       answer with the model's schema, project and the file header
 *                    watch { on }               post the camera whenever the user moves it (a linked second view follows)
 *   BimCraft → app   ready { api }              the bridge is active
 *                    opened { name }            a model is open
 *                    selection { items }        what the user selected: [{ id, guid, cls, name }] (≤ 50)
 *                    sketch { items }           the sketch as an instruction (never written to the model)
 *                    captured { items, camera, viewpoint }   selection + camera (viewer space) + BCF camera (IFC space, metres)
 *                    properties { item }        answer to props
 *                    tree { nodes }             answer to tree
 *                    meta { info }              answer to meta
 *                    camera { camera }          the camera moved (only while watched)
 *                    marker { id }              the user clicked a pin's dot
 *                    markers { drawn, asked }   how many pins found their element
 *                    error { message }
 */

const PJ_EXT = '.pjifc';
const MAX_ITEMS = 50;

function defaultPort() {
  const w = globalThis.window;
  if (!w || w.parent === w) return null;
  return {
    post: (m) => w.parent.postMessage(m, '*'),
    on: (fn) => w.addEventListener('message', (e) => { if (e.source === w.parent && e.data && e.data.pj === 1) fn(e.data); }),
  };
}

/** The 3D viewer BimCraft exposes on its canvas ("for tests and the console", bimcraft.js). A test hands in its own. */
const viewerOf = () => globalThis.__pjViewer || globalThis.document?.querySelector?.('[data-canvas]')?.viewer || null;

const num3 = (a) => Array.isArray(a) && a.length === 3 && a.every((n) => typeof n === 'number' && Number.isFinite(n));
const DOT = { open: '#d9482b', resolved: '#c58a00', closed: '#7a7a7a' };

/** The camera in viewer space (three.js, Y up): enough to fly back to the same view. */
export function cameraOf(v) {
  if (!v || !v.camera || !v.controls) return null;
  const position = v.camera.position.toArray(), target = v.controls.target.toArray(), fov = v.camera.fov;
  return num3(position) && num3(target) && Number.isFinite(fov) ? { position, target, fov } : null;
}

/** BimCraft's own BCF capture (IFC coordinates) reduced to the camera; the snapshot bytes are left behind. */
export function viewpointOf(vp) {
  const c = vp && vp.camera;
  if (!c || c.kind !== 'perspective' || !num3(c.viewPoint) || !num3(c.direction) || !num3(c.up)) return null;
  return { kind: 'perspective', viewPoint: [...c.viewPoint], direction: [...c.direction], up: [...c.up], fov: Number.isFinite(c.fov) ? c.fov : 60 };
}

export function flyCamera(v, c) {
  if (!v || !num3(c && c.position) || !num3(c && c.target)) return false;
  v.onUserMove?.();
  v.camera.position.set(...c.position);
  v.controls.target.set(...c.target);
  if (Number.isFinite(c.fov)) v.camera.fov = Math.max(10, Math.min(120, c.fov));
  v.camera.updateProjectionMatrix?.();
  v.controls.update?.();
  v.render?.();
  return true;
}

// ---- what the viewer's side panels read (9.3): BimCraft's IFC engine through the read-only model writer, no parsing here ----

const sv = (v) => (v === null || v === undefined ? null : typeof v === 'object' && 'value' in v ? (v.value === '' ? null : v.value) : v);
const idsOf = (w, name) => {
  const code = w.W && w.W[name];
  if (code === undefined) return [];
  const v = w.api.GetLineIDsWithType(w.mid, code);
  const out = [];
  for (let i = 0; i < v.size(); i++) out.push(v.get(i));
  return out;
};
const clsOf = (w, id) => {
  try {
    const line = w.api.GetLine(w.mid, id, false);
    if (line && line.constructor && /^Ifc/.test(line.constructor.name)) return line.constructor.name;
  } catch (e) { /* fall through */ }
  try { return String(w.api.GetNameFromTypeCode(w.api.GetLineType(w.mid, id))).replace(/^IFC/, 'Ifc'); } catch (e) { return 'Unknown'; }
};
const lineOf = (w, id) => { try { return w.api.GetLine(w.mid, id, false) || {}; } catch (e) { return {}; } };
const MAX_ELEMENTS = 300;

/** An element's properties reduced to what a panel shows: every value as text. */
export function slimProps(p) {
  return {
    id: Number(p.id), guid: p.guid ?? null, cls: p.cls ?? null, name: p.name ?? null, objectType: p.objectType ?? null, tag: p.tag ?? null,
    description: p.description ?? null, typeName: p.typeName ?? null,
    sets: (p.sets || []).map((s) => ({ name: String(s.name), ...(s.fromType ? { fromType: true } : {}), rows: (s.rows || []).map((r) => ({ name: String(r.name), value: r.value === null || r.value === undefined ? '' : String(r.value) })) })),
  };
}

/** The spatial structure: IfcProject → site → building → storey (IfcRelAggregates), the elements each holds (IfcRelContainedInSpatialStructure). */
export function treeOf(w) {
  const kids = new Map();
  for (const rid of idsOf(w, 'IFCRELAGGREGATES')) {
    const r = lineOf(w, rid);
    const parent = r.RelatingObject && r.RelatingObject.value;
    if (parent === undefined) continue;
    kids.set(parent, [...(kids.get(parent) || []), ...(r.RelatedObjects || []).map((h) => h.value)]);
  }
  const held = new Map();
  for (const rid of idsOf(w, 'IFCRELCONTAINEDINSPATIALSTRUCTURE')) {
    const r = lineOf(w, rid);
    const parent = r.RelatingStructure && r.RelatingStructure.value;
    if (parent === undefined) continue;
    held.set(parent, [...(held.get(parent) || []), ...(r.RelatedElements || []).map((h) => h.value)]);
  }
  const seen = new Set();
  const node = (id) => {
    seen.add(id);
    const l = lineOf(w, id);
    const n = { id, cls: clsOf(w, id), name: sv(l.Name), guid: sv(l.GlobalId), children: (kids.get(id) || []).filter((c) => !seen.has(c)).map(node) };
    const els = held.get(id);
    if (els) {
      n.elementCount = els.length;
      n.elements = els.slice(0, MAX_ELEMENTS).map((e) => { const x = lineOf(w, e); return { id: e, cls: clsOf(w, e), name: sv(x.Name), guid: sv(x.GlobalId) }; });
    }
    return n;
  };
  return idsOf(w, 'IFCPROJECT').map(node);
}

/** The schema, the project and the FILE_NAME header: what the IFC metadata window shows. */
export function metaOf(w) {
  const info = { schema: null, project: { name: null, longName: null, phase: null }, header: { timestamp: null, author: null, application: null }, elements: 0, storeys: idsOf(w, 'IFCBUILDINGSTOREY').length };
  try { info.schema = String(w.api.GetModelSchema(w.mid)); } catch (e) { /* unknown */ }
  const proj = idsOf(w, 'IFCPROJECT')[0];
  if (proj !== undefined) { const p = lineOf(w, proj); info.project = { name: sv(p.Name), longName: sv(p.LongName), phase: sv(p.Phase) }; }
  try {
    const h = w.api.GetHeaderLine(w.mid, w.W.FILE_NAME);
    const a = h && h.arguments;
    if (a) {
      const flat = (v) => (Array.isArray(v) ? v.map(sv).filter(Boolean).join(', ') || null : sv(v));
      info.header = { timestamp: sv(a[1]), author: flat(a[2]), application: [sv(a[4]), sv(a[5])].filter(Boolean).join(', ') || null };
    }
  } catch (e) { /* the header is optional */ }
  for (const rid of idsOf(w, 'IFCRELCONTAINEDINSPATIALSTRUCTURE')) info.elements += (lineOf(w, rid).RelatedElements || []).length;
  return info;
}

export function activate(api) {
  const port = globalThis.__pjPort || defaultPort();
  if (!port) return;   // BimCraft on its own: the bridge has nobody to talk to
  const post = (type, body = {}) => port.post({ pj: 1, type, ...body });
  let pending = null;   // the bytes of the next open

  api.files.importer({
    id: 'pjifc',
    label: 'Projektēšanas App',
    extensions: [PJ_EXT],
    read: async () => {
      if (!pending) throw new Error('no model from the app');
      const p = pending;
      pending = null;
      return { ifc: p.bytes, name: p.name };
    },
  });

  const describe = async (ids) => {
    const out = [];
    for (const id of ids.slice(0, MAX_ITEMS)) {
      const p = await api.model.properties(id);
      if (p) out.push({ id: Number(p.id ?? id), guid: p.guid ?? null, cls: p.cls ?? null, name: p.name ?? null });
    }
    return out;
  };

  // ---- pins in 3D (8.2): numbered dots over the canvas, kept on their elements as the camera moves ----
  let layer = null;
  let dots = [];   // { el, center, id }
  let detach = null;
  const keyOfGuid = (guid) => {
    try {
      const id = api.model.read((w) => w.byGuid(String(guid)));
      return id === null || id === undefined ? null : Number(id);   // the first model's key is its express id
    } catch (e) { return null; }
  };
  const placeDots = () => {
    const v = viewerOf();
    if (!v || !layer) return;
    const r = v.canvas?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
    for (const d of dots) {
      const p = v.project(d.center);
      if (!p) { d.el.style.display = 'none'; continue; }
      d.el.style.display = 'flex';
      d.el.style.left = (p.x - r.left) + 'px';
      d.el.style.top = (p.y - r.top) + 'px';
    }
  };
  const clearDots = () => {
    for (const d of dots) d.el.remove?.();
    dots = [];
  };
  const drawDots = (v, markers) => {
    clearDots();
    const doc = globalThis.document;
    const host = v.canvas?.parentElement;
    if (!doc?.createElement || !host) return 0;
    if (!layer) {
      layer = doc.createElement('div');
      layer.setAttribute?.('data-pj-markers', '');
      Object.assign(layer.style, { position: 'absolute', left: '0', top: '0', right: '0', bottom: '0', pointerEvents: 'none', overflow: 'hidden' });
      if (globalThis.getComputedStyle?.(host).position === 'static') host.style.position = 'relative';
      host.appendChild(layer);
      v.controls?.addEventListener?.('change', placeDots);
      globalThis.addEventListener?.('resize', placeDots);
      detach = () => { v.controls?.removeEventListener?.('change', placeDots); globalThis.removeEventListener?.('resize', placeDots); layer?.remove?.(); layer = null; };
    }
    for (const m of markers) {
      const key = keyOfGuid(m.guid);
      const bb = key === null ? null : v.keyBounds([key]);
      if (!bb) continue;
      const el = doc.createElement('div');
      el.textContent = String(m.n);
      el.title = 'Piezīme ' + m.n;
      Object.assign(el.style, { position: 'absolute', transform: 'translate(-50%, -50%)', minWidth: '22px', height: '22px', padding: '0 5px', borderRadius: '11px', background: DOT[m.state] || DOT.open, color: '#fff', font: '600 12px sans-serif', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', cursor: 'pointer', boxShadow: '0 0 0 2px #fff', opacity: m.state === 'closed' ? '0.6' : '1' });
      el.addEventListener('click', (e) => { e.stopPropagation?.(); post('marker', { id: m.id }); });
      layer.appendChild(el);
      dots.push({ el, id: m.id, center: [0, 1, 2].map((i) => (bb.min[i] + bb.max[i]) / 2) });
    }
    placeDots();
    return dots.length;
  };
  api.onDeactivate?.(() => { clearDots(); detach?.(); });

  // ---- the camera, posted while the host watches it (a linked second view follows); a move the host made is not echoed ----
  let watching = null;   // { v, fn }
  let quietUntil = 0;
  const watchCamera = (on) => {
    if (watching) { watching.v.controls?.removeEventListener?.('change', watching.fn); watching = null; }
    if (!on) return;
    const v = viewerOf();
    if (!v) throw new Error('no 3D view yet');
    let t = 0;
    const fn = () => {
      const now = Date.now();
      if (now < quietUntil || now - t < 120) return;
      t = now;
      const camera = cameraOf(v);
      if (camera) post('camera', { camera });
    };
    v.controls?.addEventListener?.('change', fn);
    watching = { v, fn };
  };
  api.onDeactivate?.(() => watchCamera(false));

  let last = '';
  const poll = async () => {
    try {
      if (!api.model.current()) return;
      const sel = api.model.selection();
      const key = JSON.stringify(sel);
      if (key === last) return;
      last = key;
      post('selection', { items: await describe(sel) });
    } catch (e) {
      post('error', { message: String(e && e.message || e) });
    }
  };
  const timer = setInterval(poll, 300);
  api.onDeactivate?.(() => clearInterval(timer));
  api.model.onChange(() => { last = ''; });

  port.on(async (m) => {
    try {
      if (m.type === 'open') {
        clearDots();
        pending = { bytes: m.bytes instanceof Uint8Array ? m.bytes : new Uint8Array(m.bytes), name: String(m.name || 'model.ifc') };
        const f = typeof File === 'function' ? new File([pending.bytes], `${pending.name}${PJ_EXT}`) : { name: `${pending.name}${PJ_EXT}` };
        const opened = await globalThis.ccAddons?.openFromAddon(f);
        if (opened === false) throw new Error('BimCraft did not take the model');
        post('opened', { name: pending?.name ?? m.name });
      } else if (m.type === 'select') {
        api.model.select((m.ids || []).map(Number).filter(Number.isFinite));
        await poll();
      } else if (m.type === 'highlight') {
        const ids = api.model.read((w) => (m.guids || []).map((g) => w.byGuid(String(g))).filter((x) => x !== null && x !== undefined));
        api.model.select(ids);
        post('highlighted', { found: ids.length, asked: (m.guids || []).length });
        await poll();
      } else if (m.type === 'compare') {
        // BimCraft's own version compare (Models panel, ifc-compare.js): A opened, B added as a second model, both by GlobalId;
        // BimCraft paints added / removed / changed itself
        const M = globalThis.bimcraftModels;
        const C = globalThis.bimcraftCompare;
        if (!M || !C) throw new Error('compare needs BimCraft\'s Models panel (bimcraftModels / bimcraftCompare)');
        pending = { bytes: new Uint8Array(m.a.bytes), name: String(m.a.name) };
        await globalThis.ccAddons?.openFromAddon(new File([pending.bytes], `${pending.name}${PJ_EXT}`));
        await M.add(new File([new Uint8Array(m.b.bytes)], String(m.b.name)));
        const list = M.list();
        const a = list[0];
        const b = list[list.length - 1];
        const r = C.run(a.mi, b.mi);
        post('compared', { added: r.added.length, removed: r.removed.length, changed: r.changed.length, same: r.same, changes: r.changed.slice(0, 200).map((c) => ({ guid: c.guid, props: c.props.map((p) => p.field), moved: c.moved, reshaped: c.reshaped })) });
      } else if (m.type === 'markers') {
        const asked = Array.isArray(m.markers) ? m.markers : [];
        const v = viewerOf();
        if (!v || !api.model.current()) { post('markers', { drawn: 0, asked: asked.length }); return; }
        post('markers', { drawn: drawDots(v, asked), asked: asked.length });
      } else if (m.type === 'fly') {
        const v = viewerOf();
        if (!v) throw new Error('no 3D view yet');
        if (m.camera) {
          quietUntil = Date.now() + 250;
          if (!flyCamera(v, m.camera)) throw new Error('the pin has no usable camera');
        } else if (m.guid) {
          const key = keyOfGuid(m.guid);
          if (key === null || !v.frameKeys([key])) throw new Error('the element is not in this model');
          api.model.select([key]);
        }
      } else if (m.type === 'capture') {
        const v = viewerOf();
        if (!v || !api.model.current()) throw new Error('no model is open');
        let vp = null;
        try { vp = viewpointOf(globalThis.bimcraftIssues?.capture?.()); } catch (e) { vp = null; }
        post('captured', { items: await describe(api.model.selection()), camera: cameraOf(v), viewpoint: vp });
      } else if (m.type === 'props') {
        if (!api.model.current()) throw new Error('no model is open');
        let id = Number.isInteger(m.id) && m.id > 0 ? m.id : null;
        if (id === null && typeof m.guid === 'string' && m.guid) id = api.model.read((w) => w.byGuid(m.guid));
        if (id === null && !(typeof m.guid === 'string' && m.guid) && !Number.isInteger(m.id)) throw new Error('props: an id or a guid is needed');
        const p = id === null || id === undefined ? null : await api.model.properties(id);
        if (!p) throw new Error('the element is not in this model');
        post('properties', { item: slimProps(p) });
      } else if (m.type === 'tree') {
        if (!api.model.current()) throw new Error('no model is open');
        post('tree', { nodes: api.model.read((w) => treeOf(w)) });
      } else if (m.type === 'meta') {
        if (!api.model.current()) throw new Error('no model is open');
        post('meta', { info: api.model.read((w) => metaOf(w)) });
      } else if (m.type === 'watch') {
        watchCamera(m.on === true);
      } else if (m.type === 'sketch') {
        const sel = api.model.selection();
        post('sketch', { items: await describe(sel), note: String(m.note || '') });
      }
    } catch (e) {
      post('error', { message: String(e && e.message || e) });
    }
  });

  // the app's ccAddons handle is set by BimCraft after activation; tests hand theirs in
  post('ready', { api: '1.1' });
  return { _openForTest: (bytes, name) => { pending = { bytes, name }; } };
}
