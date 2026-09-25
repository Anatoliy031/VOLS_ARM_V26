/* ============================================================================
   tools/test-core.js — проверки ядра: справочники, расчёты, книга.
   Запуск: node tools/test-core.js
   ========================================================================== */
'use strict';
const H = require('./harness');
const { PPO: P, PPOREFS: R, XLSX } = H.loadCore();
const t = H.reporter('ядро');
const { ok } = t;

t.group('состав справочников');
ok('версия ядра читается', /^\d+\.\d+/.test(String(P.VERSION)), P.VERSION);
ok('марок опор не меньше 131', P.POLES.length >= 131, String(P.POLES.length));
ok('у каждой марки заполнены обязательные поля', P.POLES.every((p) =>
  p.kv && p.mark && p.sch && typeof p.m_adm === 'number' && p.m_adm > 0));
ok('схемы учёта тяжения из известного набора', P.POLES.every((p) =>
  ['промежуточная', 'угловая', 'анкерная', 'угловая анкерная', 'концевая', 'ответвительная']
    .indexOf(p.sch) >= 0),
  P.POLES.filter((p) => ['промежуточная', 'угловая', 'анкерная', 'угловая анкерная', 'концевая', 'ответвительная'].indexOf(p.sch) < 0).map((p) => p.mark).join(','));
ok('марки уникальны', new Set(P.POLES.map((p) => p.mark)).size === P.POLES.length);
ok('класс каждой марки есть в справочнике ВЛ', P.POLES.every((p) => !!P.vlByKv(p.kv)));
ok('кабелей не меньше 14', P.CABLES.length >= 14, String(P.CABLES.length));
ok('проводов не меньше 12', P.WIRES.length >= 12, String(P.WIRES.length));
ok('видов измерений 13', P.MEAS.length === 13, String(P.MEAS.length));
ok('схем производства работ 4', P.LISTS.scheme.length === 4, String(P.LISTS.scheme.length));
ok('есть схема «по распоряжению»',
  P.LISTS.scheme.some((s) => /по распоряжению/.test(s)));

t.group('приборы подразделения идут первыми');
/* Состав приборов ведётся в книге ID_shablon.xlsx, лист «Спр_Приборы».
   Проверяем не конкретные номера, а свойства, от которых зависит отчёт:
   закреплённые приборы идут первыми и несут полные реквизиты поверки. */
ok('приборы подразделения впереди типовых',
  P.SI_PRESETS.every((s, i, a) => i === 0 || !(s.own && !a[i - 1].own)),
  JSON.stringify(P.SI_PRESETS.map((s) => s.mark + (s.own ? '*' : ''))));
ok('у закреплённых приборов есть заводской номер, поверка и её дата',
  P.SI_PRESETS.filter((s) => s.own).every((s) => s.sn && s.fgis && s.d1),
  JSON.stringify(P.SI_PRESETS.filter((s) => s.own)));
ok('среди приборов есть пригодный для прочности бетона',
  P.SI_PRESETS.some((s) => P.siFits(s.name + ' ' + s.mark, 'beton') === 1));
ok('среди приборов есть пригодный для отклонения от вертикали',
  P.SI_PRESETS.some((s) => P.siFits(s.name + ' ' + s.mark, 'vert') === 1));
ok('измеритель прочности не годится для угла наклона',
  P.SI_PRESETS.filter((s) => P.siFits(s.name + ' ' + s.mark, 'beton') === 1)
    .every((s) => P.siFits(s.name + ' ' + s.mark, 'vert') === 0),
  JSON.stringify(P.SI_PRESETS.filter((s) => P.siFits(s.name + ' ' + s.mark, 'beton') === 1)));

t.group('справочники перенесены из книги ID_shablon.xlsx');
ok('совмещённый класс 10/0,4 есть в списке',
  P.LISTS.kv.indexOf('10/0,4') >= 0, P.LISTS.kv.join(', '));
ok('у совмещённого класса заданы габариты и охранная зона',
  !!P.vlByKv('10/0,4') && P.vlByKv('10/0,4').oz === 10,
  JSON.stringify(P.vlByKv('10/0,4')));
ok('совмещённые марки доступны по своему классу',
  P.polesByKv('10/0,4').length > 0,
  P.polesByKv('10/0,4').map((x) => x.mark).join(', '));
ok('марки опор уникальны',
  new Set(P.POLES.map((x) => x.mark)).size === P.POLES.length,
  'марок ' + P.POLES.length + ', уникальных ' + new Set(P.POLES.map((x) => x.mark)).size);
ok('марки кабелей уникальны',
  new Set(P.CABLES.map((x) => x.mark)).size === P.CABLES.length);
ok('марки проводов уникальны',
  new Set(P.WIRES.map((x) => x.mark)).size === P.WIRES.length);
ok('у каждой марки опоры задан класс, схема и допустимый момент',
  P.POLES.every((x) => x.kv && x.sch && x.m_adm > 0),
  JSON.stringify(P.POLES.filter((x) => !(x.kv && x.sch && x.m_adm > 0)).slice(0, 3)));
ok('класс каждой марки есть в справочнике ВЛ',
  P.POLES.every((x) => !!P.vlByKv(x.kv)),
  JSON.stringify([...new Set(P.POLES.filter((x) => !P.vlByKv(x.kv)).map((x) => x.kv))]));
ok('у каждого кабеля задан диаметр и погонная масса',
  P.CABLES.every((c) => c.d > 0 && c.m > 0));
ok('у каждого провода задан диаметр и погонная масса',
  P.WIRES.every((w) => w.d > 0 && w.m > 0));

t.group('типовое описание дефекта зависит от материала стойки');
(() => {
  const wood = P.POLES.filter((x) => /дерев/i.test(x.mat))[0];
  const conc = P.POLES.filter((x) => /железобетон/i.test(x.mat))[0];
  const txt = (mark) => P.poleDerived({ id: 'x', mark, defect: 'A', defText: '', kv: '10', num: '1' }).defTxt;
  ok('у железобетонной — про защитный слой', /защитного слоя/i.test(txt(conc.mark)), txt(conc.mark));
  ok('у деревянной — про загнивание древесины', /загниван/i.test(txt(wood.mark)), txt(wood.mark));
})();

t.group('отклонение от вертикали вводится в градусах');
ok('поле ввода — угол', P.MEAS.filter((m) => m.id === 'vert')[0].inputs[0].k === 'deg');
const m1 = P.evalMeas('vert', { deg: 1, h: 10 }, {});
ok('1° при 10 м → 1/57', m1 && m1.value === '1/57', m1 && m1.value);
ok('отклонение верха 175 мм', m1 && m1.res.dev === 175, m1 && String(m1.res.dev));
const m2 = P.evalMeas('vert', { deg: 0.4, h: 10 }, {});
ok('0,4° → 1/143, соответствует', m2.value === '1/143' && m2.verdict === 'соответствует', m2.value);
ok('пустой ввод не даёт результата', P.evalMeas('vert', { deg: '', h: '' }, {}) === null);
const mig = P.migrate({ v: '3.4', pass: {}, poles: [], si: [], cables: [], wires: [],
  acts: [], skips: [], lines: [], meas: [{ id: 'x', kindId: 'vert', vals: { dev: 175, h: 10 } }] });
ok('старые измерения в мм пересчитаны в градусы',
  Math.abs(mig.meas[0].vals.deg - 1.0) < 0.02, String(mig.meas[0].vals.deg));

t.group('ход линии строится по координатам');
function setLine(n, reverse, extra) {
  const d = P.blank();
  d.pass['ОБЪЕКТ_КЛАСС'] = '10';
  d.poles = H.line(n, 'Л', extra);
  if (reverse) d.poles.reverse();
  P.replaceAll(d);
  P.recalcSpans({ force: true });
  return P.load();
}
setLine(5);
let D = P.load();
ok('пролёты посчитаны по координатам',
  D.poles.slice(0, 4).every((p) => p.span >= 49 && p.span <= 51),
  JSON.stringify(D.poles.map((p) => p.span)));
ok('у последней опоры пролёта нет', String(D.poles[4].span) === '');
ok('ручной ввод не переживает пересчёт', (() => {
  const d = P.load(); d.poles[0].span = 999; d.poles[0].spanSrc = 'manual';
  P.replaceAll(d); P.recalcSpans();
  return P.load().poles[0].span <= 51;
})(), String(P.load().poles[0].span));
const ordA = P.orderByRoute(setLine(30, false).poles).map((p) => p.num);
const ordB = P.orderByRoute(setLine(30, true).poles).map((p) => p.num);
ok('порядок не зависит от порядка ввода', ordA.join(',') === ordB.join(','));
ok('ход идёт от первой к последней', ordA[0] === '1' && ordA[29] === '30', ordA[0] + '…' + ordA[29]);
/* одноимённые опоры допустимы: опознаются координатами */
(() => {
  const d = P.blank();
  d.poles = [H.pole({ id: 'a', num: '92б', lat: '45.000000' }),
             H.pole({ id: 'b', num: '92/1а', lat: '45.000450' }),
             H.pole({ id: 'c', num: '92а', lat: '45.000900' }),
             H.pole({ id: 'e', num: '92б', lat: '45.001350' })];
  P.replaceAll(d); P.recalcSpans({ force: true });
  const o = P.orderByRoute(P.load().poles).map((p) => p.num + '@' + p.lat);
  ok('одинаковые номера не мешают ходу',
    /^92б@45\.0*$|^92б@45$/.test(o[0]) && /^92б@45\.00135/.test(o[3]), o.join(' '));
  ok('дубликат номера не считается замечанием',
    !P.problems().some((x) => /несколько опор с номером/i.test(x.txt)));
})();

t.group('конец участка и ручная привязка соседей');
(() => {
  const d = P.blank();
  d.poles = [H.pole({ id: 'a1', line: 'A', num: '97', lat: '45.000000' }),
             H.pole({ id: 'a2', line: 'A', num: '98', mark: 'А10-1', lat: '45.000450' }),
             H.pole({ id: 'b1', line: 'B', num: '1', kv: '0,4', mark: 'П8-1', lat: '45.000900' })];
  P.replaceAll(d); P.recalcSpans({ force: true });
  const by = (n, l) => P.load().poles.filter((p) => p.num === n && p.line === l)[0];
  ok('без привязки у стыка пролёта нет', String(by('98', 'A').span) === '');
  ok('признак конца не выставлен по марке', by('98', 'A').endPole === 0);
  ok('замечание предлагает указать соседа',
    P.problems().some((x) => /Опора № 98/.test(x.where) && /Следующая опора/.test(x.txt)));
  P.setPoleLinks('a2', { nextId: 'b1' });
  ok('пролёт через линии посчитан', by('98', 'A').span === 50, String(by('98', 'A').span));
  ok('ссылка сохранена текстом', by('98', 'A').nextRef === 'B|1', by('98', 'A').nextRef);
  /* два звена: 97→98 по линии A и 98→1 по ручной привязке через линии */
  ok('звено ручной привязки вошло в протяжённость',
    P.objectLength().links === 2 && P.objectLength().m === 100,
    JSON.stringify(P.objectLength()));
  const rec = (n, l) => { let r = null; P.chainSpans(P.load().poles).forEach((x) => { if (x.num === n && x.line === l) r = x; }); return r; };
  ok('опора со связью не конец цепи', rec('98', 'A').ends === false);
  P.setPoleLinks('a2', { endPole: 1 });
  ok('конец участка очищает пролёт', String(by('98', 'A').span) === '');
})();

t.group('полнота привязки и кэш цепи');
(() => {
  const d = P.blank();
  d.poles = [H.pole({ id: 'a', num: '1', lat: '45.0000' }),
             H.pole({ id: 'b', num: '2', lat: '45.00045' }),
             H.pole({ id: 'c', num: '3', lat: '45.0009' })];
  P.replaceAll(d); P.recalcSpans({ force: true });
  const c1 = P.poleChain();
  ok('повторный запрос берётся из кэша', P.poleChain() === c1);
  ok('разрывы определены',
    c1.gaps.a === 'prev' && c1.gaps.b === '' && c1.gaps.c === 'next', JSON.stringify(c1.gaps));
  P.setPoleLinks('a', { endPole: 1 });
  ok('запись обесценивает кэш', P.poleChain() !== c1);
  const t0 = Date.now();
  const big = P.blank(); big.poles = H.line(600, 'Л'); P.replaceAll(big);
  P.recalcSpans({ force: true });
  const tR = Date.now() - t0;
  const t1 = Date.now(); for (let i = 0; i < 10; i++) P.poleChain();
  const tC = Date.now() - t1;
  ok('пересчёт 600 опор укладывается в 300 мс', tR < 300, tR + ' мс');
  ok('десять запросов цепи из кэша быстрее 25 мс', tC < 25, tC + ' мс');
})();

t.group('дефект определяется категорией');
(() => {
  const d = P.blank();
  d.poles = [H.pole({ id: 'q', num: '93', defect: '—', defText: 'скол у комля' })];
  P.replaceAll(d);
  const x = P.poleDerived(P.load().poles[0]);
  ok('графа «Дефект» пуста при снятой категории', x.defTxt === '', x.defTxt);
  ok('состояние работоспособное', x.state === 'Работоспособное');
  ok('описание ушло в примечание', /скол у комля/.test(P.poleNote(P.load().poles[0])));
  ok('описание без категории не блокирует',
    !P.problems().some((y) => /категория не выбрана/i.test(y.txt)));
  d.poles[0].defect = 'A'; P.replaceAll(d);
  ok('при категории описание идёт в графу «Дефект»',
    P.poleDerived(P.load().poles[0]).defTxt === 'скол у комля');
})();

t.group('номер опоры из наименования');
[['Опора 93', '93'], ['оп. № 95', '95'], ['Опора № 100а', '100а'], ['оп. 12 б', '12б'],
 ['92б:ПР-1:ВЛ 10 - ТМ-6', '92б'], ['92/1а', '92/1а'], ['опора 1-11а', '1-11а'],
 ['', ''], ['ввод в ТП', 'ввод в ТП']].forEach(([src, want]) => {
  ok('«' + src + '» → «' + want + '»', P.poleNumFromName(src) === want, P.poleNumFromName(src));
});

t.group('синхронизация метки и опоры');
(() => {
  const d = P.blank();
  d.poles = [H.pole({ id: 'X1', line: 'Л', num: '93', lat: '45.100000', lon: '39.100000' })];
  P.replaceAll(d);
  const r = P.syncMarksToPoles([{ markId: 'pm1', poleId: 'X1', line: 'Л',
    pole: P.poleNumFromName('Опора 95'), lat: '45.100000', lon: '39.100000', defect: '', kv: '10' }]);
  ok('переименование дошло до опоры', P.load().poles[0].num === '95', P.load().poles[0].num);
  ok('опора не задвоилась', P.load().poles.length === 1);
  ok('связь возвращена карте', r.bound.pm1 === 'X1');
  /* смена номера и координат разом — связь держит идентификатор */
  P.syncMarksToPoles([{ markId: 'pm1', poleId: 'X1', line: 'Л', pole: '95б',
    lat: '45.200000', lon: '39.200000', defect: 'Б', kv: '10' }]);
  ok('номер и координаты вместе',
    P.load().poles.length === 1 && P.load().poles[0].num === '95б' && P.load().poles[0].lat === '45.200000');
  const del = P.deletePoleForMark({ poleId: 'X1', line: 'Л', pole: '95б' });
  ok('удаление метки удаляет опору', del.removed === 1 && P.load().poles.length === 0);
})();

t.group('линия измерения выводится от опоры');
(() => {
  const d = P.blank();
  d.poles = [H.pole({ id: 'a', line: 'ВЛ-10 ТМ-6', num: '95' })];
  d.meas = [{ id: 'm', pole: '95', line: 'ВЛ-10 ТМ-6 наклон опоры', kindId: 'vert',
    name: 'Отклонение', place: 'вершина', value: '1/17', unit: '—', norm: '',
    verdict: 'не соответствует', si: 'X', vals: { deg: 3.38, h: 10.5 } }];
  P.replaceAll(P.migrate(d));
  ok('комментарий из графы линии убран', P.load().meas[0].line === 'ВЛ-10 ТМ-6', P.load().meas[0].line);
})();

t.group('ранее размещённые ОК в расчёте');
(() => {
  const d = P.blank();
  d.poles = [H.pole({ id: 'a', num: '1', hangs: 3, lat: '45.0' }),
             H.pole({ id: 'b', num: '2', hangs: 2, lat: '45.00045' })];
  d.wires = [{ mark: 'СИП-3 1х70', n: 3, kv: '10', h: '6', tens: '7',
               belong: 'Владелец (провода ВЛ)', note: '' }];
  P.replaceAll(d); P.recalcSpans({ force: true });
  const rows = P.existingOkRows();
  ok('позиция выведена', rows.length === 1, JSON.stringify(rows.map((r) => r.mark)));
  ok('количество = наибольшему числу подвесов', rows[0].n === 3, String(rows[0].n));
  ok('характеристики из справочника', !!P.cableByMark(rows[0].mark));
  ok('происхождение подписано', /характеристики приняты по справочнику/.test(rows[0].note));
  ok('в блок 2 попадают обе позиции', P.wiresForLoads().length === 2);
})();

t.group('протяжённость участка расчётная');
(() => {
  const d = P.blank();
  d.pass['ОБЪЕКТ_ДЛИНА'] = '0,363';
  d.poles = [H.pole({ id: 'a', num: '1', lat: '45.0' }), H.pole({ id: 'b', num: '2', lat: '45.0009' })];
  P.replaceAll(P.migrate(d));
  ok('заявленная длина заменена расчётной', P.load().pass['ОБЪЕКТ_ДЛИНА'] === '0,1',
    P.load().pass['ОБЪЕКТ_ДЛИНА']);
  ok('поле помечено расчётным',
    P.PASSPORT.filter((f) => f.c === 'ОБЪЕКТ_ДЛИНА')[0].t === 'calc');
})();

t.group('пользовательские справочники');
(() => {
  P.replaceAll(P.blank());
  R.add('poles', { kv: '10', mark: 'ТЕСТ-1', mat: 'Композитная', type: 'Промежуточная',
    proj: 'ТП-тест', st: 'КС-1', sch: 'промежуточная', m_adm: '33', h: '9', lgab: '75' });
  ok('своя марка видна в справочнике', !!P.poleByMark('ТЕСТ-1'));
  ok('число приведено к числу', P.poleByMark('ТЕСТ-1').m_adm === 33);
  ok('попала в фильтр по классу', P.polesByKv('10').some((x) => x.mark === 'ТЕСТ-1'));
  const n0 = P.POLES.length; R.apply(); R.apply();
  ok('повторное применение не дублирует', P.POLES.length === n0);
  ok('самопроверка слоя сходится', R.status().ok, JSON.stringify(R.status()));
  R.remove('poles', R.load().poles[0].uid);
  ok('удаление своей записи работает', !P.poleByMark('ТЕСТ-1'));
})();

t.group('книга значениями');
(() => {
  const d = P.blank();
  d.pass['ОБЪЕКТ_КЛАСС'] = '10';
  d.poles = [H.pole({ id: 'a', num: '1', lat: '45.0', hangs: 2 }),
             H.pole({ id: 'b', num: '2', mark: 'А10-1', lat: '45.00045', endPole: 1 })];
  P.replaceAll(d); P.recalcSpans({ force: true });
  const wb = P.buildWorkbook();
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const back = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(back.Sheets['Опоры'], { defval: '' });
  ok('опоры записаны', rows.length === 2, String(rows.length));
  ok('служебная графа несёт конец участка',
    /КОНЕЧНАЯ/.test(String(rows[1]['Служебная отметка'])), String(rows[1]['Служебная отметка']));
  P.replaceAll(P.blank());
  P.importWorkbook(back);
  ok('чтение вернуло опоры', P.load().poles.length === 2);
  ok('признак конца пережил круг', P.load().poles[1].endPole === 1);
})();

t.group('категория дефекта В остаётся В');
/* normCat превращал «В» в «Б»: исправная опора получала «выправку / усиление»,
   категория В в отчёт не попадала никогда. */
ok('«В» остаётся «В»', P.normCat('В') === 'В', P.normCat('В'));
ok('«Б» остаётся «Б»', P.normCat('Б') === 'Б', P.normCat('Б'));
ok('латинская «b» приводится к кириллической «В»', P.normCat('b') === 'В', P.normCat('b'));
ok('кириллическая «а» приводится к латинской «A»', P.normCat('а') === 'A', P.normCat('а'));
ok('для В берётся мероприятие категории В',
  /плановом обслуживании/.test(P.defectByCat('В').act || ''), P.defectByCat('В').act);
(function(){
  const d = P.blank();
  d.poles = [{ id:'v1', line:'ВЛ 10 Т-1', num:'5', kv:'10', mark:'П10-2', defect:'В', defText:'скол бетона',
    lat:'45.0', lon:'39.0', photos:[] }];
  P.replaceAll(d);
  ok('после сохранения и загрузки категория В не меняется', P.load().poles[0].defect === 'В',
    P.load().poles[0].defect);
})();

t.group('линия измерения при одинаковых номерах опор');
/* Каждая линия нумеруется с 1. Раньше при загрузке измерения опор второй
   линии переписывались на первую линию с тем же номером. */
(function(){
  const d = P.blank();
  d.poles = [
    { id:'a1', line:'ВЛ 10 Д-12', num:'1', kv:'10', mark:'А10-1', defect:'—', lat:'45.0000', lon:'39.0000', photos:[] },
    { id:'a2', line:'ВЛ 10 Д-12', num:'2', kv:'10', mark:'П10-2', defect:'—', lat:'45.0005', lon:'39.0000', photos:[] },
    { id:'b1', line:'ВЛ 0,4 №1', num:'1', kv:'0,4', mark:'А8-1', defect:'—', lat:'45.0010', lon:'39.0010', photos:[] },
    { id:'b3', line:'ВЛ 0,4 №1', num:'3', kv:'0,4', mark:'П8-1', defect:'—', lat:'45.0013', lon:'39.0010', photos:[] }];
  d.meas = [
    { id:'m1', pole:'1', line:'ВЛ 0,4 №1', kindId:'vert', name:'Отклонение стойки от вертикали', value:'1/200' },
    { id:'m2', pole:'1', line:'ВЛ 10 Д-12', kindId:'vert', name:'Отклонение стойки от вертикали', value:'1/300' },
    { id:'m3', pole:'3', line:'', kindId:'vert', name:'Отклонение стойки от вертикали', value:'1/250' },
    { id:'m4', pole:'1', line:'', kindId:'beton', name:'Прочность бетона', value:'31' }];
  P.replaceAll(d);
  const M = {}; P.load().meas.forEach((m) => { M[m.id] = m.line; });
  ok('измерение опоры № 1 второй линии остаётся на второй линии', M.m1 === 'ВЛ 0,4 №1', M.m1);
  ok('измерение опоры № 1 первой линии остаётся на первой линии', M.m2 === 'ВЛ 10 Д-12', M.m2);
  ok('линия подставляется, когда номер опоры однозначен', M.m3 === 'ВЛ 0,4 №1', M.m3);
  ok('при неоднозначном номере линия не выдумывается', M.m4 === '', JSON.stringify(M.m4));
  const probs = P.problems().filter((x) => /дважды/.test(x.txt));
  ok('нет ложного замечания о двойном измерении', probs.length === 0, probs.map((x) => x.txt).join('; '));
})();

t.group('формат записи ФГИС «Аршин»');
(function(){
  require(require('path').join(H.ROOT, 'ppo-audit.js'));
  const A = (typeof window !== 'undefined' && window.PPOAudit) || global.PPOAudit;
  ok('модуль проверок загружается', !!A);
  if (!A) return;
  const KEY = '№ записи о поверке во ФГИС «Аршин»';
  function verdict(v){
    let rows = [];
    try { rows = A.extraChecks({ S:{ si:[{ [KEY]: v }], poles:[], meas:[], acts:[] }, d:{}, la:null }); }
    catch (e) { return 'ошибка: ' + e.message; }
    const r = rows.filter((x) => /Формат записи о поверке/.test(x.name))[0];
    return r ? r.st : 'нет строки';
  }
  ok('«С-ДЮП/27-08-2026/123456789» принимается', verdict('С-ДЮП/27-08-2026/123456789') === 'ok',
    verdict('С-ДЮП/27-08-2026/123456789'));
  ok('«П-431-2026» принимается', verdict('П-431-2026') === 'ok', verdict('П-431-2026'));
  ok('«свидетельство есть» отклоняется', verdict('свидетельство есть') === 'warn', verdict('свидетельство есть'));
  ok('заготовки приборов ядра проходят проверку формата',
    P.SI_PRESETS.filter((s) => s.fgis).every((s) => verdict(s.fgis) === 'ok'),
    P.SI_PRESETS.filter((s) => s.fgis && verdict(s.fgis) !== 'ok').map((s) => s.fgis).join(', '));
})();

process.exit(t.done() ? 1 : 0);
