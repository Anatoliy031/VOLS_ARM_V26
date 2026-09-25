/* ============================================================================
   tools/harness.js — общая обвязка для проверок рабочего места.

   Зачем: страницы комплекта — это HTML со встроенным кодом и внешними
   библиотеками (Leaflet, SheetJS, proj4, JSZip). Проверять их только на
   синтаксис недостаточно: так не видно, что целый блок разметки не попал в
   файл, что поле не отрисовалось или что обработчик не сохранил значение.
   Здесь страница поднимается целиком в браузерном окружении: локальные
   скрипты подставляются в разметку, внешние библиотеки заменяются на
   заглушки, хранилище браузера подменяется объектом обследования.

   Заглушка Leaflet, помимо прочего, СЧИТАЕТ обращения к слоям. На этом
   держится проверка быстродействия карты: перекраска после правки не должна
   пересоздавать все метки и подписи (см. tools/test-map.js).

   Требуется: npm install jsdom xlsx
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE_MODULES = process.env.PPO_NODE_MODULES ||
  (fs.existsSync(path.join(ROOT, 'node_modules')) ? path.join(ROOT, 'node_modules')
                                                  : '/home/claude/node_modules');

const { JSDOM, VirtualConsole } = require(path.join(NODE_MODULES, 'jsdom'));
const XLSX = require(path.join(NODE_MODULES, 'xlsx'));
const XLSX_SRC = fs.readFileSync(path.join(NODE_MODULES, 'xlsx/dist/xlsx.full.min.js'), 'utf8');

const STORE_KEY = 'ppo_vols_object_v2';

/* ---------------------------------------------------------------- счётчик */
function makeCounter() {
  return { markers: 0, icons: 0, tooltips: 0, addLayer: 0, removeLayer: 0,
           setIcon: 0, bindPopup: 0, unbindPopup: 0 };
}

/* ------------------------------------------------------- заглушка Leaflet */
function stubLeaflet(w, cnt) {
  const chain = (base) => new Proxy(Object.assign({}, base), {
    get: (t, k) => (k in t ? t[k] : () => chain(base))
  });
  const proto = {
    on(ev, fn) { (this.__h = this.__h || {})[ev] = fn; return this; },
    fire(ev, e) { if (this.__h && this.__h[ev]) this.__h[ev](e || {}); return this; },
    bindPopup(f) { cnt.bindPopup++; this.__popup = f; return this; },
    unbindPopup() { cnt.unbindPopup++; this.__popup = null; return this; },
    openPopup() { if (this.__popup) this.__built = this.__popup(); return this; },
    addTo() { return this; },
    setIcon(i) { cnt.setIcon++; this.__icon = i; return this; },
    bindTooltip(h, o) { cnt.tooltips++; this.__tip = { h, o }; return this; },
    unbindTooltip() { this.__tip = null; return this; },
    getTooltip() { return this.__tip || null; },
    setPopupContent() { return this; },
    getLatLng() { return { lat: 45, lng: 39 }; },
    setLatLng() { return this; },
    remove() { return this; }
  };
  const layer = () => Object.create(proto);
  const L = {
    map: () => chain({ on() { return this; }, setView() { return this; },
      getCenter: () => ({ lat: 45, lng: 39 }), getZoom: () => 15,
      closePopup() { return this; }, off() { return this; }, remove() { return this; },
      fitBounds() { return this; }, addLayer() { return this; }, removeLayer() { return this; } }),
    tileLayer: () => chain({ addTo() { return this; } }),
    layerGroup: () => chain({ addTo() { return this; }, clearLayers() { return this; },
      addLayer() { cnt.addLayer++; return this; },
      removeLayer() { cnt.removeLayer++; return this; } }),
    marker() { cnt.markers++; return layer(); },
    polyline() { return layer(); },
    polygon() { return layer(); },
    divIcon(o) { cnt.icons++; return o; },
    latLngBounds: () => chain({ extend() { return this; }, isValid: () => true }),
    control: new Proxy(function () { return chain({ addTo() { return this; } }); },
      { get: () => () => chain({ addTo() { return this; }, addBaseLayer() { return this; } }) }),
    Icon: { Default: { prototype: {} } },
    Proj: { CRS: function () { return {}; } },
    DomEvent: { stop() {}, stopPropagation() {}, preventDefault() {} },
    Browser: {}, bounds: () => chain({}), point: () => chain({}),
    transformation: () => chain({}), latLng: () => ({ lat: 45, lng: 39 }),
    CRS: { EPSG3857: {} }, Util: chain({}), extend: (a) => a, setOptions() {}
  };
  /* всё, что заглушка не описала явно, отдаём цепочкой: страница вправе
     обратиться к любому методу библиотеки, а нам важен только её код */
  w.L = new Proxy(L, { get: (t, k) => (k in t ? t[k] : () => chain({})) });
}

/* --------------------------------------------------------- загрузка страницы
   file  — имя html-файла комплекта
   obj   — объект обследования, который положим в хранилище браузера
   ready — колбэк (window, document, counters); может вернуть Promise
   wait  — сколько ждать инициализации страницы, мс                        */
function loadPage(file, obj, ready, wait) {
  let html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  /* локальные скрипты — внутрь разметки, чтобы не ходить по сети */
  html = html.replace(/<script src="(ppo-[a-z]+\.js)(\?[^"]*)?"><\/script>/g,
    (m, f) => '<script>' + fs.readFileSync(path.join(ROOT, f), 'utf8') + '</script>');
  html = html.replace(/<script src="https?:[^"]*"><\/script>/g, '');
  /* настоящая SheetJS: без неё не собирается отчёт и не читается книга.
     Подставляем функцией-заменителем — в тексте библиотеки есть «$&», и при
     строковой замене он был бы истолкован как спецпоследовательность. */
  html = html.replace('<script>', () => '<script>' + XLSX_SRC + '\n');

  const cnt = makeCounter();
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://local.test/' + file, virtualConsole: vc,
    beforeParse(w) {
      const store = {};
      if (obj) store[STORE_KEY] = JSON.stringify(obj);
      Object.defineProperty(w, 'localStorage', { value: {
        getItem: (k) => (store[k] === undefined ? null : store[k]),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
        __store: store } });
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {} }));
      const p4 = function () { return function () { return [0, 0]; }; };
      p4.defs = function () {}; p4.Proj = function () { return {}; };
      w.proj4 = p4;
      w.JSZip = function () {};
      w.confirm = () => true;
      w.alert = () => {};
      stubLeaflet(w, cnt);
    }
  });
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(ready(dom.window, dom.window.document, cnt, errors)); }
      catch (e) { reject(e); }
    }, wait || 900);
  });
}

/* ------------------------------------------------------------- ядро без DOM
   Для проверок, которым страница не нужна: справочники, расчёты, книга.   */
function loadCore() {
  const store = {};
  global.localStorage = {
    getItem: (k) => (store[k] === undefined ? null : store[k]),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  };
  global.window = global;
  global.addEventListener = function () {};
  global.document = { addEventListener() {}, dispatchEvent() {} };
  global.CustomEvent = function () {};
  global.XLSX = XLSX;
  ['ppo-kmz.js', 'ppo-core.js', 'ppo-refs.js'].forEach((f) => require(path.join(ROOT, f)));
  return { PPO: global.window.PPO, PPOREFS: global.window.PPOREFS, XLSX };
}

/* --------------------------------------------------------------- образцы */
function pole(o) {
  return Object.assign({
    id: 'x', line: 'ВЛ-10 ТМ-6', num: '1', kv: '10', mark: 'П10-1',
    span: '', spanSrc: '', hangs: 0, defect: '—', defText: '',
    performer: '', term: '', cost: '', lat: '45.0', lon: '39.0', photos: [],
    note: '', mest: '', angle: '', prevOwner: '', prevH: '',
    endPole: 0, nextId: '', prevId: '', nextRef: '', prevRef: ''
  }, o);
}
function obj(poles, passExtra) {
  return {
    v: 'test', saved: '2026-08-01T00:00:00.000Z',
    pass: Object.assign({ 'ОБЪЕКТ_КЛАСС': '10' }, passExtra || {}),
    lines: [], meas: [], si: [], cables: [], wires: [], acts: [], skips: [],
    poles: poles || []
  };
}
/* линия из n опор с шагом ~50 м по широте */
function line(n, lineName, extra) {
  const a = [];
  for (let i = 1; i <= n; i++) {
    a.push(pole(Object.assign({
      id: 'p' + i, num: String(i), line: lineName || 'ВЛ-10 ТМ-6',
      lat: String(45 + i * 0.00045)
    }, extra || {})));
  }
  return a;
}
const saved = (w) => JSON.parse(w.localStorage.getItem(STORE_KEY));

/* --------------------------------------------------------------- счётчик */
function reporter(title) {
  let pass = 0; const fails = [];
  return {
    ok(name, cond, extra) {
      if (cond) pass++;
      else { fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' :: ' + extra : '')); }
    },
    group(name) { console.log('--- ' + name + ' ---'); },
    done() {
      console.log('  [' + title + '] пройдено ' + pass + ', провалено ' + fails.length);
      return fails.length;
    }
  };
}

module.exports = { loadPage, loadCore, pole, obj, line, saved, reporter, XLSX, ROOT, STORE_KEY };
