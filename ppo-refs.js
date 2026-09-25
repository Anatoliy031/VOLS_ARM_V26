/* ============================================================================
   ППО ВОЛС — пользовательский слой справочников.

   Зашитые справочники (марки опор, кабели ОК, провода ВЛ, приборы, списки)
   закрывают типовые случаи, но не все: в сети встречаются опоры по проектам,
   которых нет в общем перечне, кабели с иными характеристиками и приборы,
   закреплённые за конкретной бригадой. Раньше такую позицию нельзя было ни
   добавить, ни поправить — она уходила в примечание свободным текстом и
   выпадала из расчётов.

   Модуль хранит добавленные вручную записи отдельно от кода и дописывает их
   В ТЕ ЖЕ массивы PPO.POLES / PPO.CABLES / PPO.WIRES / PPO.SI_PRESETS и
   значения PPO.LISTS. Массивы именно дописываются: на них замкнуты
   polesByKv, poleByMark, cableByMark, wireByMark и выпадающие списки всех
   страниц — подмена массива их бы обесточила.

   Подключается СРАЗУ ПОСЛЕ ppo-core.js на каждой странице комплекта и
   применяет записи при загрузке, до первой отрисовки.
   ========================================================================== */
(function (global) {
'use strict';

var KEY = 'ppo_refs_user_v1';

/* Поля пользовательских записей по видам справочников. Тот же состав, что у
   зашитых записей: иначе позиция не пройдёт через расчёты и выгрузку. */
var FIELDS = {
  poles: [
    { k:'kv',    l:'Класс напряжения, кВ', t:'kv',   req:1 },
    { k:'mark',  l:'Марка опоры',          req:1 },
    { k:'mat',   l:'Материал',             t:'list', opts:['Железобетонная','Стальная','Стальная многогранная','Композитная','Деревянная','Деревянная на ж/б приставке','Иной материал'] },
    { k:'type',  l:'Тип по назначению',    t:'list', opts:['Промежуточная','Промежуточная (насел.)','Промежуточная (ненасел.)','Промежуточно-угловая','Анкерная (концевая)','Анкерная угловая','Ответвительная анкерная','Угловая ответвительная анкерная','Концевая анкерная','Переходная промежуточная','Переходная анкерная'] },
    { k:'proj',  l:'Типовой проект (серия, шифр)' },
    { k:'st',    l:'Стойка' },
    { k:'sch',   l:'Схема (учёт тяжения)', t:'list', req:1,
      opts:['промежуточная','угловая','анкерная','угловая анкерная','концевая','ответвительная'],
      h:'Определяет, воспринимает ли опора момент от тяжения: анкерная, угловая, концевая и ответвительная — воспринимают.' },
    { k:'m_adm', l:'Допустимый момент стойки M\u2009доп, кН·м', t:'num', req:1,
      h:'Задаётся ПО СТОЙКЕ, а не по назначению опоры. Подкосы, вторая стойка и оттяжки в запас не учитываются.' },
    { k:'h',     l:'Высота подвеса, м',    t:'num' },
    { k:'lgab',  l:'Габаритный пролёт, м', t:'num' },
    { k:'approx',l:'Значения приняты по аналогии', t:'flag',
      h:'Отметьте, если M\u2009доп, высота и габаритный пролёт взяты у стойки-аналога, а не из типового проекта. Отметка выводится в карточке опоры.' }
  ],
  cables: [
    { k:'mark', l:'Марка кабеля ОК', req:1 },
    { k:'type', l:'Тип',  req:1, t:'list',
      opts:['ОКСН — самонесущий неметаллический','ОКГТ — встроенный в грозозащитный трос','ОКНН — навиваемый на фазный провод/СИП','ОКНН — прикрепляемый к несущему элементу','КМЖ — кабель электросвязи с металлическими жилами','Ответвительный кабель (в жгуте)','ОК без привязки к типу'] },
    { k:'d',    l:'Наружный диаметр, мм', t:'num', req:1 },
    { k:'m',    l:'Погонная масса, кг/км', t:'num', req:1 },
    { k:'t',    l:'Тяжение, кН',           t:'num' },
    { k:'area', l:'Область применения, кВ' },
    { k:'note', l:'Примечание' }
  ],
  wires: [
    { k:'mark', l:'Марка провода / троса', req:1 },
    { k:'d',    l:'Наружный диаметр, мм',  t:'num', req:1 },
    { k:'m',    l:'Погонная масса, кг/км', t:'num', req:1 },
    { k:'note', l:'Вид',  t:'list',
      opts:['сталеалюминиевый','самонесущий изолированный','защищённый провод','грозозащитный трос','иной'] }
  ],
  si: [
    { k:'name', l:'Наименование прибора', req:1 },
    { k:'mark', l:'Тип / марка',          req:1 },
    { k:'sn',   l:'Заводской номер' },
    { k:'fgis', l:'№ записи о поверке во ФГИС «Аршин»' },
    { k:'d1',   l:'Дата поверки', t:'date' }
  ]
};
/* Списки, куда допускается дописывать значения. Перечни, от которых зависят
   расчёты и нормативы (классы напряжения, вердикты, протоколы), не трогаем:
   добавленное туда значение прошло бы в отчёт без норматива. */
var LIST_KEYS = {
  mestnost:  'Характер местности',
  belong:    'Принадлежность подвеса',
  performer: 'Исполнитель мероприятия',
  actGrp:    'Группа мероприятия',
  scheme:    'Схема производства работ',
  zaborka:   'Правило выборки при измерении заземления'
};

function blank(){ return { poles:[], cables:[], wires:[], si:[], lists:{} }; }

function load(){
  var raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { return blank(); }
  if (!raw) return blank();
  var o;
  try { o = JSON.parse(raw); } catch (e) { return blank(); }
  var b = blank();
  ['poles','cables','wires','si'].forEach(function(k){
    if (!Array.isArray(o[k])) o[k] = b[k];
  });
  if (!o.lists || typeof o.lists !== 'object') o.lists = {};
  return o;
}
function save(o){
  try { localStorage.setItem(KEY, JSON.stringify(o)); }
  catch (e) { throw new Error('Не удалось сохранить справочник: хранилище браузера переполнено или недоступно'); }
  apply();
  return o;
}
function uid(){ return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* Применить пользовательские записи поверх зашитых справочников.

   Штатный путь — через PPO.refApply: там записи дописываются в те же массивы
   и корректно снимаются при повторном применении. Но модуль может оказаться
   рядом со СТАРЫМ ppo-core.js — например, браузер отдал его из кеша после
   обновления сайта. Тогда refApply отсутствует, и раньше слой молча не
   применялся: запись добавлена, а в выпадающих списках её нет. Поэтому здесь
   предусмотрен запасной путь — дописать напрямую в PPO.POLES и соседние
   массивы. Он делает то же самое и оставляет пометку о причине.          */
var _mode = 'none';
function applyDirect(store){
  var map = { poles:'POLES', cables:'CABLES', wires:'WIRES', si:'SI_PRESETS' };
  Object.keys(map).forEach(function(k){
    var arr = global.PPO[map[k]];
    if (!Array.isArray(arr)) return;
    for (var i = arr.length - 1; i >= 0; i--) if (arr[i] && arr[i].user) arr.splice(i, 1);
    (store[k] || []).forEach(function(rec){
      var o = {}; Object.keys(rec).forEach(function(f){ o[f] = rec[f]; });
      o.user = 1;
      if (k === 'poles'){
        o.m_adm = +o.m_adm || 0; o.h = +o.h || 0; o.lgab = +o.lgab || 0;
        o.proj_full = (o.proj || '') + (o.st ? ' (' + o.st + ')' : '');
      }
      if (k === 'cables'){ o.d = +o.d || 0; o.m = +o.m || 0; o.t = +o.t || 0; }
      if (k === 'wires'){ o.d = +o.d || 0; o.m = +o.m || 0; }
      arr.push(o);
    });
  });
  Object.keys(store.lists || {}).forEach(function(k){
    var arr = global.PPO.LISTS && global.PPO.LISTS[k];
    if (!Array.isArray(arr)) return;
    (store.lists[k] || []).forEach(function(v){
      var t = String(v || '').trim();
      if (t && arr.indexOf(t) < 0) arr.push(t);
    });
  });
}
function apply(){
  if (!global.PPO){ _mode = 'none'; return false; }
  var st = load();
  if (global.PPO.refApply){ global.PPO.refApply(st); _mode = 'core'; return true; }
  applyDirect(st); _mode = 'direct';
  return true;
}
/* сколько записей реально попало в справочники — для самопроверки */
function status(){
  var live = 0, want = 0, st = load();
  var map = { poles:'POLES', cables:'CABLES', wires:'WIRES', si:'SI_PRESETS' };
  Object.keys(map).forEach(function(k){
    want += (st[k] || []).length;
    var arr = global.PPO && global.PPO[map[k]];
    if (Array.isArray(arr)) live += arr.filter(function(x){ return x && x.user; }).length;
  });
  return {
    mode:_mode, live:live, want:want, ok:(live === want),
    core: !!(global.PPO && global.PPO.refApply),
    version: (global.PPO && global.PPO.VERSION) || '—'
  };
}

function add(kind, obj){
  var st = load();
  if (!st[kind] && kind !== 'lists') throw new Error('Неизвестный справочник: ' + kind);
  var rec = {}; Object.keys(obj || {}).forEach(function(k){ rec[k] = obj[k]; });
  rec.uid = uid();
  st[kind].push(rec);
  save(st);
  return rec;
}
function update(kind, id, obj){
  var st = load(), hit = null;
  (st[kind] || []).forEach(function(r){ if (r.uid === id) hit = r; });
  if (!hit) throw new Error('Запись не найдена');
  Object.keys(obj || {}).forEach(function(k){ if (k !== 'uid') hit[k] = obj[k]; });
  save(st);
  return hit;
}
function remove(kind, id){
  var st = load();
  st[kind] = (st[kind] || []).filter(function(r){ return r.uid !== id; });
  save(st);
}

/* добавление / удаление значений в списках выбора */
function listAdd(key, value){
  if (!LIST_KEYS[key]) throw new Error('Список «' + key + '» не редактируется');
  var st = load(), t = String(value || '').trim();
  if (!t) throw new Error('Пустое значение');
  st.lists[key] = st.lists[key] || [];
  if (st.lists[key].indexOf(t) < 0) st.lists[key].push(t);
  save(st);
}
function listRemove(key, value){
  var st = load();
  st.lists[key] = (st.lists[key] || []).filter(function(v){ return v !== value; });
  save(st);
}

/* ------------------------------------------------------- ПРОВЕРКА ССЫЛОК
   Удалять запись, на которую уже ссылается объект обследования, нельзя:
   опора осталась бы с маркой, которой нет ни в одном справочнике, и вылетела
   бы из расчёта несущей способности молча. Возвращаем места использования. */
function usedBy(kind, rec){
  if (!global.PPO || !global.PPO.load) return [];
  var d, out = [];
  try { d = global.PPO.load(); } catch (e) { return []; }
  var mark = String((rec && rec.mark) || '').trim();
  if (kind === 'poles' && mark)
    (d.poles || []).forEach(function(p){
      if (String(p.mark || '').trim() === mark)
        out.push('опора № ' + (p.num || '?') + (p.line ? ' (' + p.line + ')' : ''));
    });
  if (kind === 'cables' && mark)
    (d.cables || []).forEach(function(c, i){
      if (String(c.mark || '').trim() === mark) out.push('кабель ОК, позиция ' + (i + 1));
    });
  if (kind === 'wires' && mark)
    (d.wires || []).forEach(function(w, i){
      if (String(w.mark || '').trim() === mark) out.push('провод ВЛ, позиция ' + (i + 1));
    });
  if (kind === 'si' && mark)
    (d.si || []).forEach(function(x){
      if (String(x.mark || '').trim() === mark) out.push('средство измерения ' + mark);
    });
  return out;
}

/* выгрузка и загрузка справочника целиком — чтобы поделиться с коллегами */
function exportJson(){ return JSON.stringify(load(), null, 2); }
function importJson(text, mergeMode){
  var o;
  try { o = JSON.parse(text); } catch (e) { throw new Error('Файл не является справочником (.json)'); }
  if (!o || typeof o !== 'object') throw new Error('Файл не является справочником');
  var st = mergeMode ? load() : blank();
  ['poles','cables','wires','si'].forEach(function(k){
    (Array.isArray(o[k]) ? o[k] : []).forEach(function(r){
      var rec = {}; Object.keys(r).forEach(function(f){ rec[f] = r[f]; });
      if (!rec.uid) rec.uid = uid();
      var dup = st[k].some(function(x){ return x.uid === rec.uid ||
        (rec.mark && String(x.mark || '') === String(rec.mark)); });
      if (!dup) st[k].push(rec);
    });
  });
  Object.keys(o.lists || {}).forEach(function(k){
    if (!LIST_KEYS[k]) return;
    st.lists[k] = st.lists[k] || [];
    (o.lists[k] || []).forEach(function(v){
      if (st.lists[k].indexOf(v) < 0) st.lists[k].push(v);
    });
  });
  save(st);
  return st;
}

global.PPOREFS = {
  KEY:KEY, FIELDS:FIELDS, LIST_KEYS:LIST_KEYS,
  load:load, save:save, blank:blank, apply:apply, status:status,
  add:add, update:update, remove:remove,
  listAdd:listAdd, listRemove:listRemove,
  usedBy:usedBy, exportJson:exportJson, importJson:importJson
};

/* применяем сразу при загрузке модуля — до первой отрисовки страницы */
apply();

})(window);
