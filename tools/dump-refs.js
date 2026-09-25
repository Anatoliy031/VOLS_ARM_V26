/* ============================================================================
   tools/dump-refs.js — выгрузка справочников из ядра в tools/refs.json.
   Первый шаг обновления шаблона: tools/build-template.py берёт данные отсюда,
   чтобы книга и инструмент не расходились.
   Запуск: node tools/dump-refs.js
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const H = require('./harness');
const { PPO: P } = H.loadCore();

const KIND = P.SI_KINDS || [];
function canOf(s) {
  const t = s.name + ' ' + s.mark;
  let ids = [];
  KIND.forEach((k) => { if (k.re.test(t)) ids = ids.concat(k.can || []); });
  return ids.map((id) => {
    const m = P.MEAS.filter((x) => x.id === id)[0];
    return m ? m.name : id;
  }).join('; ');
}
/* образцы ввода, чтобы в справочник видов измерений попали живые значения */
const SAMPLES = {
  vert: { deg: 0.5, h: 10 }, beton: { val: 35, cls: 30 }, gz_prov: { val: 7.5 },
  gz_oksn: { val: 5.5 }, d_oksn_prov: { val: 0.8 }, d_oksn_elem: { val: 0.3 },
  zaglub: { val: 2.2, ref: 2.0 }, diam: { val: 0.164, ref: 0.164 }
};
const ctx = { kv: '10', mestnost: 'населённая', ro: 100 };
const meas = P.MEAS.map((m) => {
  const r = SAMPLES[m.id] ? P.evalMeas(m.id, SAMPLES[m.id], ctx) : null;
  return {
    id: m.id, name: m.name, place: m.place, unit: m.unit,
    inputs: (m.inputs || []).map((i) => i.l).join('; '),
    sample: r ? r.value : '', norm: r ? r.norm : (m.normTxt || ''),
    verdict: r ? r.verdict : '', proto: P.measProto(m.id)
  };
});

const out = {
  poles: P.POLES.filter((p) => !p.user).map((p) => ({
    kv: p.kv, mark: p.mark, mat: p.mat, type: p.type, proj: p.proj, st: p.st,
    sch: p.sch, m_adm: p.m_adm, h: p.h, lgab: p.lgab, approx: p.approx ? 1 : 0 })),
  cables: P.CABLES.filter((c) => !c.user),
  wires: P.WIRES.filter((w) => !w.user),
  si: P.SI_PRESETS.filter((s) => !s.user).map((s) => {
    const o = {}; Object.keys(s).forEach((k) => { o[k] = s[k]; });
    o.can = canOf(s); return o; }),
  vl: P.VL || [],
  meas,
  defects: P.DEFECTS.map((d) => ({ cat: d.cat, txt: d.txt, txtWood: d.txtWood || '', state: d.state, tv: d.tv,
    k: (d.k === null || d.k === undefined ? '' : d.k), act: d.act || '', note: d.note || '' })),
  lists: P.LISTS
};
const dest = path.join(H.ROOT, 'tools', 'refs.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 1));
console.log('выгружено в ' + dest);
console.log('  марок опор ' + out.poles.length + ', кабелей ' + out.cables.length +
            ', проводов ' + out.wires.length + ', приборов ' + out.si.length +
            ', видов измерений ' + out.meas.length);
