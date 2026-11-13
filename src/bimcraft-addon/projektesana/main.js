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
 *   BimCraft → app   ready { api }              the bridge is active
 *                    opened { name }            a model is open
 *                    selection { items }        what the user selected: [{ id, guid, cls, name }] (≤ 50)
 *                    sketch { items }           the sketch as an instruction (never written to the model)
 *                    captured { items, camera, viewpoint }   selection + camera (viewer space) + BCF camera (IFC space, metres)
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
