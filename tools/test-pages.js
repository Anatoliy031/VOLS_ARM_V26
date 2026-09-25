/* ============================================================================
   tools/test-pages.js — проверки страниц в браузерном окружении.
   Ловит то, что синтаксической проверкой не видно: не отрисованное поле,
   не сохранённое значение, пересоздание всех меток на карте.
   Запуск: node tools/test-pages.js
   ========================================================================== */
'use strict';
const H = require('./harness');
const t = H.reporter('страницы');
const { ok } = t;

const MAP_OBJ = () => H.obj([
  H.pole({ id: 'p1', num: '92', lat: '45.000000' }),
  H.pole({ id: 'p2', num: '93', lat: '45.000450' }),
  H.pole({ id: 'p3', num: '94', lat: '45.000900' }),
  H.pole({ id: 'p9', line: 'ВЛ-0,4 ТП-45', num: '1', kv: '0,4', mark: 'П8-1', lat: '45.010000' })
]);
/* карточка метки по номеру опоры */
function card(w, num) {
  w.eval("window.__pm=placemarks.filter(function(p){return guessPoleNumber(p)==='" + num + "';})[0];" +
         "window.__c=buildPopup(window.__pm);");
  return w.__c;
}

(async () => {

t.group('все страницы поднимаются');
for (const f of ['portal.html', 'potok.html', 'karta.html', 'osmotr.html', 'pribory.html',
                 'spravochniki.html', 'index.html', 'vyezdy.html', 'obyazatelstvo.html']) {
  await H.loadPage(f, MAP_OBJ(), (w, d, cnt, errs) => {
    const hard = errs.filter((e) => !/нет сети|Not implemented|Could not load|network/i.test(e));
    ok(f + ' — без ошибок', hard.length === 0, hard.slice(0, 1).join(' | '));
    ok(f + ' — навигация отрисована', !!d.querySelector('#ppoNav a'));
  });
}

t.group('осмотр: карточка опоры');
await H.loadPage('osmotr.html', MAP_OBJ(), (w, d) => {
  w.eval("try{poleForm(D.poles.filter(function(p){return p.num==='93';})[0],false)}catch(e){window.__err=e.stack}");
  if (w.__err) throw new Error(w.__err);
  ok('поле «Предыдущая опора» есть', !!d.getElementById('f_prev'));
  ok('поле «Следующая опора» есть', !!d.getElementById('f_next'));
  ok('пролёт только для чтения', d.getElementById('f_span').hasAttribute('readonly'));
  ok('признак конца участка есть', !!d.getElementById('f_end'));
  const nx = d.getElementById('f_next');
  ok('в списке опоры других линий и классов',
    Array.from(nx.options).some((o) => /ВЛ-0,4 ТП-45/.test(o.textContent) && /0,4 кВ/.test(o.textContent)));
  ok('сама опора в список не попала', !Array.from(nx.options).some((o) => o.value === 'p2'));
  nx.value = 'p3';
  d.getElementById('f_ok').click();
  const p = H.saved(w).poles.filter((x) => x.num === '93')[0];
  ok('связь сохранена', p.nextId === 'p3', JSON.stringify(p.nextId));
  ok('пролёт посчитан по координатам', p.span === 50, String(p.span));
});

t.group('осмотр: подсветка разрыва цепи');
await H.loadPage('osmotr.html', MAP_OBJ(), (w, d) => {
  w.eval("go('poles')");
  const cards = {};
  d.querySelectorAll('.pcard').forEach((c) => {
    cards[c.querySelector('.no').textContent.replace('Опора № ', '')] = c;
  });
  ok('середина цепи не подсвечена', !cards['93'].classList.contains('gap'));
  ok('начало цепи подсвечено', cards['92'].classList.contains('gap'));
  ok('у начала не хватает предыдущей',
    /не определена предыдущая/.test(cards['92'].getAttribute('title') || ''),
    cards['92'].getAttribute('title'));
  ok('одиночная опора подсвечена', cards['1'].classList.contains('gap'));
  ok('у одиночной не хватает обеих',
    /ни предыдущая, ни следующая/.test(cards['1'].getAttribute('title') || ''));
});

t.group('осмотр: паспорт');
await H.loadPage('osmotr.html', H.obj([H.pole({ id: 'a', num: '1', lat: '45.0' }),
                                       H.pole({ id: 'b', num: '2', lat: '45.0009' })],
                                      { 'ОБЪЕКТ_ДЛИНА': '0,363' }), (w, d) => {
  w.eval("go('pass')");
  const len = d.querySelector('[data-p="ОБЪЕКТ_ДЛИНА"]');
  ok('поле протяжённости есть', !!len);
  ok('ввод закрыт', len && len.hasAttribute('readonly'));
  ok('показана расчётная величина', len && len.value === '0,1', len && len.value);
  const nm = d.querySelector('[data-lines]');
  ok('подбор линий проекта выведен', !!nm);
});

t.group('карта: подписи и цвета меток');
await H.loadPage('karta.html', MAP_OBJ(), (w, d, cnt) => {
  ok('кнопка «Убрать номера опор»', !!d.getElementById('btnLblPole'));
  ok('кнопка «Убрать номера линий»', !!d.getElementById('btnLblLine'));
  ok('легенда цветов выведена', d.querySelectorAll('.legend .lg').length === 4);
  w.eval("pullFromOsmotr(true)");
  const tips = cnt.tooltips;
  ok('подписи меток созданы', tips >= 4, String(tips));
  const cls = cnt.icons > 0;
  ok('иконки построены', cls);
  ok('середина цепи без разрыва',
    w.eval("(function(){var m=placemarks.filter(function(p){return guessPoleNumber(p)==='93';})[0];return gapOf(m);})()") === '');
  ok('край цепи помечен разрывом',
    w.eval("(function(){var m=placemarks.filter(function(p){return guessPoleNumber(p)==='92';})[0];return gapOf(m);})()") !== '');
  w.eval("toggleLabel('pole')");
  ok('подпись переключается', d.getElementById('lblPoleTxt').textContent === 'Показать номера опор');
});

t.group('карта: карточка метки');
await H.loadPage('karta.html', MAP_OBJ(), (w, d) => {
  w.eval("pullFromOsmotr(true)");
  const c = card(w, '93');
  const lbls = Array.from(c.querySelectorAll('.pop-lbl')).map((x) => x.textContent);
  ['Линия / фидер', 'Класс напряжения, кВ', 'Марка опоры', 'Предыдущая опора', 'Следующая опора']
    .forEach((n) => ok('поле «' + n + '»', lbls.indexOf(n) >= 0, lbls.join(' | ')));
  ok('признак конца участка есть', !!c.querySelector('.pop-chk input'));
  ok('поиска в выборе соседа нет', !c.querySelector('.cmb-q'));
  ok('кнопка «Указать на карте»',
    /Указать на карте/.test(c.querySelector('.cmb-map').textContent));
  ok('прочие характеристики свёрнуты', !!c.querySelector('.pop-more') && !c.querySelector('.pop-more').open);
  /* правка линии, класса и марки */
  const sels = c.querySelectorAll('.pop-sel');
  const markSel = Array.from(sels).filter((s) => Array.from(s.options).some((o) => /П10-1/.test(o.textContent)))[0];
  const kvSel = Array.from(sels).filter((s) => Array.from(s.options).some((o) => o.value === '0,4'))[0];
  c.querySelector('.pop-inp').value = 'ВЛ-10 ТМ-6 (испр.)';
  kvSel.value = '0,4'; kvSel.dispatchEvent(new w.Event('change'));
  ok('марки перефильтровались по классу',
    Array.from(markSel.options).some((o) => /^П8-1/.test(o.value)));
  markSel.value = 'П8-1';
  c.querySelector('.pop-save').click();
  const p = H.saved(w).poles.filter((x) => x.num === '93')[0];
  ok('линия исправлена', p.line === 'ВЛ-10 ТМ-6 (испр.)', p.line);
  ok('класс исправлен', p.kv === '0,4', p.kv);
  ok('марка исправлена', p.mark === 'П8-1', p.mark);
});

t.group('карта: переименование доходит до осмотра');
for (const [name, want] of [['Опора 95', '95'], ['оп. № 97а', '97а'], ['92/1а', '92/1а']]) {
  await H.loadPage('karta.html', MAP_OBJ(), (w, d) => new Promise((r) => {
    w.eval("pullFromOsmotr(true)");
    const c = card(w, '93');
    c.querySelector('.pop-name').value = name;
    c.querySelector('.pop-save').click();
    setTimeout(() => {
      const nums = H.saved(w).poles.map((x) => x.num);
      ok('«' + name + '» → № ' + want, nums.indexOf(want) >= 0, nums.join(', '));
      ok('«' + name + '» — опора не задвоилась', H.saved(w).poles.length === 4);
      ok('«' + name + '» — подтягивание включено обратно', w.eval('pullMuted') === 0);
      r();
    }, 400);
  }));
}

t.group('карта: удаление метки удаляет опору');
await H.loadPage('karta.html', MAP_OBJ(), (w, d) => {
  w.eval("pullFromOsmotr(true)");
  ok('до удаления 4 опоры', H.saved(w).poles.length === 4);
  w.eval("deletePm(placemarks.filter(function(p){return guessPoleNumber(p)==='93';})[0].id)");
  ok('опора удалена в осмотре', H.saved(w).poles.length === 3,
    H.saved(w).poles.map((p) => p.num).join(', '));
  ok('удалена именно 93', !H.saved(w).poles.some((p) => p.num === '93'));
});

t.group('карта: выбор соседа на карте не перерисовывает всё');
await H.loadPage('karta.html', (() => {
  const o = H.obj(H.line(200, 'Л'));
  return o;
})(), (w, d, cnt) => {
  w.eval("pullFromOsmotr(true)");
  Object.keys(cnt).forEach((k) => { cnt[k] = 0; });
  const c = card(w, '1');
  c.querySelectorAll('.cmb-map')[0].click();
  ok('режим выбора включён', w.eval('!!pickState'));
  ok('карточки меток не отвязаны', cnt.unbindPopup === 0, String(cnt.unbindPopup));
  Object.keys(cnt).forEach((k) => { cnt[k] = 0; });
  w.eval("placemarks.filter(function(p){return guessPoleNumber(p)==='2';})[0].layer.fire('click')");
  ok('метки не пересоздавались', cnt.markers === 0, String(cnt.markers));
  ok('подписи не пересоздавались', cnt.tooltips === 0, String(cnt.tooltips));
  ok('перекрашено не больше двух меток из 200', cnt.setIcon <= 2, String(cnt.setIcon));
  ok('режим выключен', w.eval('pickState') === null);
}, 1600);

t.group('отчёт: пересборка и лист контроля');
await H.loadPage('index.html', H.obj([H.pole({ id: 'a', num: '1', lat: '45.0' }),
                                      H.pole({ id: 'b', num: '2', lat: '45.0009' })]), (w, d) => {
  const b = d.getElementById('btnRebuild');
  ok('кнопка пересборки есть', !!b && /Пересобрать отчёт по новым данным/.test(b.textContent));
  ok('кнопка видна всегда', b && b.closest('#staleBar') === null);
  ok('полоса устаревания скрыта на старте', d.getElementById('staleBar').style.display === 'none');
  w.eval("parseWorkbook(PPO.buildWorkbook()); render(); markSrc();");
  ok('снимок отмечен', w.eval('srcStale()') === false);
  ok('лист контроля собран', w.eval('LAST_AUDIT.length') > 20, String(w.eval('LAST_AUDIT.length')));
  w.eval("var D2=PPO.load(); D2.pass['ОБЪЕКТ_НАИМ']='ВЛ 10 кВ Тест'; PPO.replaceAll(D2);");
  ok('снимок стал устаревшим', w.eval('srcStale()') === true);
  b.click();
  ok('пересборка подхватила правку', /ВЛ 10 кВ Тест/.test(w.eval('JSON.stringify(S.pass)')));
  ok('снимок снова актуален', w.eval('srcStale()') === false);
});

t.group('справочники');
await H.loadPage('spravochniki.html', MAP_OBJ(), (w, d) => {
  ok('таблица заполнена', d.querySelectorAll('#tbl tbody tr').length > 100,
    String(d.querySelectorAll('#tbl tbody tr').length));
  ok('самопроверка слоя доступна', typeof w.PPOREFS.status === 'function' && w.PPOREFS.status().ok);
});

process.exit(t.done() ? 1 : 0);
})().catch((e) => { console.log('ОШИБКА ПРОГОНА:', e.message); process.exit(1); });
