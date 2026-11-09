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
 *   BimCraft → app   ready { api }              the bridge is active
 *                    opened { name }            a model is open
 *                    selection { items }        what the user selected: [{ id, guid, cls, name }] (≤ 50)
 *                    sketch { items }           the sketch as an instruction (never written to the model)
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
