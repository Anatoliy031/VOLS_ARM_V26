/* ============================================================================
   ППО ВОЛС — дополнительные проверки отчёта и шлюз выпуска (версия 3.2)

   Модуль появился после разбора двух выпущенных отчётов, в которых лист
   внутреннего контроля отработал, но ничего не остановил: оператор видел
   замечания и всё равно выгружал документ. Здесь собраны проверки, которых в
   контроле не было, и механизм, который не даёт выпустить отчёт молча.

   Модуль ничего не знает о разметке отчёта. На вход подаётся уже разобранная
   книга (S), производные показатели (d), результат оценки несущей способности
   (la) и несколько вспомогательных функций страницы. На выход — массив строк
   того же вида, что формирует runAudit: { grp, name, st, note }.

   Требуется ppo-core.js (справочники, матрица применимости средств измерений).
   ========================================================================== */
(function (global) {
'use strict';

var Y = 'ok', W = 'warn', X = 'fail';

/* ------------------------------------------------------------ УТИЛИТЫ */
function s(v){ return String(v === undefined || v === null ? '' : v).trim(); }
function low(v){ return s(v).toLowerCase(); }
function n(v){
  var t = s(v).replace(/\s/g, '').replace(',', '.');
  var x = parseFloat(t);
  return isFinite(x) ? x : NaN;
}
function uniq(a){
  var seen = {}, out = [];
  a.forEach(function(x){ if (!seen[x]){ seen[x] = 1; out.push(x); } });
  return out;
}
function few(a, k){
  var t = a.slice(0, k || 6).join(', ');
  return a.length > (k || 6) ? t + ' и ещё ' + (a.length - (k || 6)) : t;
}
function isWorkday(d){ var w = d.getDay(); return w !== 0 && w !== 6; }
function addWorkdays(start, k){
  var d = new Date(start.getTime()), left = k;
  while (left > 0){ d.setDate(d.getDate() + 1); if (isWorkday(d)) left--; }
  return d;
}
function fmt(d){
  if (!d) return '';
  var p = function(x){ return (x < 10 ? '0' : '') + x; };
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear();
}

/* --------------------------------------------------- ГЕОМЕТРИЯ ПО ОПОРАМ */
function haversine(la1, lo1, la2, lo2){
  var R = 6371000, t = Math.PI / 180;
  var dLa = (la2 - la1) * t, dLo = (lo2 - lo1) * t;
  var a = Math.sin(dLa/2) * Math.sin(dLa/2) +
          Math.cos(la1*t) * Math.cos(la2*t) * Math.sin(dLo/2) * Math.sin(dLo/2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
/* пролёты по координатам: линия → упорядоченный список → расстояния */
function geoSpans(poles){
  var cmp = (global.PPO && global.PPO.cmpPoleNum) || function(a, b){
    return s(a) < s(b) ? -1 : (s(a) > s(b) ? 1 : 0);
  };
  var byLine = {};
  poles.forEach(function(r){
    var k = s(r['Линия / фидер']);
    (byLine[k] = byLine[k] || []).push(r);
  });
  var out = { byRow:[], total:0, links:0, jumps:[] };
  Object.keys(byLine).forEach(function(k){
    var arr = byLine[k].slice().sort(function(a, b){ return cmp(a['№ опоры'], b['№ опоры']); });
    for (var i = 0; i < arr.length; i++){
      var a = arr[i], b = arr[i+1];
      var la = n(a['Широта']), lo = n(a['Долгота']);
      var rec = { row:a, line:k, num:s(a['№ опоры']), next:b ? s(b['№ опоры']) : '', geo:NaN, last:!b };
      if (b && !isNaN(la) && !isNaN(lo)){
        var lb = n(b['Широта']), ob = n(b['Долгота']);
        if (!isNaN(lb) && !isNaN(ob)) rec.geo = Math.round(haversine(la, lo, lb, ob));
      }
      var ref = (global.PPO && global.PPO.poleByMark) ? global.PPO.poleByMark(s(a['Марка опоры'])) : null;
      var lim = (ref && ref.lgab > 0) ? ref.lgab * 2 : 600;
      rec.lim = Math.round(lim);
      if (!isNaN(rec.geo)){
        if (rec.geo > lim) out.jumps.push(rec);
        else { out.total += rec.geo; out.links++; }
      }
      out.byRow.push(rec);
    }
  });
  return out;
}

/* ====================================================== НАБОР ПРОВЕРОК ==== */
/* ctx: { S, d, la, raw, photoCountFor } */
function extraChecks(ctx){
  var S = ctx.S || {}, d = ctx.d || {}, la = ctx.la || null;
  var raw = ctx.raw || function(){ return ''; };
  var A = [];
  var add = function(grp, name, st, note){ A.push({ grp:grp, name:name, st:st, note:note || '' }); };
  var P = S.poles || [], M = S.meas || [], SI = S.si || [], AC = S.acts || [];
  var core = global.PPO;

  /* ---------------------------------------------- III. МЕТРОЛОГИЯ */

  /* 1. Прибор пригоден для этого вида измерения.
        Поводом послужили протоколы, где сопротивление заземляющего устройства
        «измерялось» измерителем прочности бетона и тахеометром. */
  if (core && core.siFits){
    var wrongSI = [], unknownSI = [];
    M.forEach(function(m, i){
      var si = s(m['Средство измерения']);
      if (!si) return;
      var kind = core.measByName ? core.measByName(s(m['Вид измерения'])) : null;
      if (!kind) return;
      var full = si;
      SI.forEach(function(r){
        if (low(r['Тип / марка']) === low(si) || low(r['Наименование средства измерения']) === low(si))
          full = s(r['Наименование средства измерения']) + ' ' + s(r['Тип / марка']);
      });
      var fit = core.siFits(full, kind.id);
      if (fit === 0) wrongSI.push('поз. ' + (i+1) + ' (' + si + ' ↔ ' + s(m['Вид измерения']).toLowerCase() + ')');
      else if (fit === -1) unknownSI.push(si);
    });
    add('III. Метрология', 'Прибор пригоден для измеряемой величины', wrongSI.length ? X : Y,
        wrongSI.length ? few(wrongSI, 4) + ' — измерение выполнено прибором другого назначения' :
          'соответствие обеспечено');
    unknownSI = uniq(unknownSI);
    if (unknownSI.length)
      add('III. Метрология', 'Вид средства измерения распознан', W,
          'не удалось соотнести с видом измерений: ' + few(unknownSI, 4) +
          ' — проверьте наименование в приложении Д');
  }

  /* 2. Заводской номер средства измерения. */
  var noSn = SI.filter(function(r){ return !s(r['Заводской №']); });
  var snIsType = SI.filter(function(r){
    var sn = s(r['Заводской №']), tp = low(r['Тип / марка']), nm = low(r['Наименование средства измерения']);
    if (!sn) return false;
    if (low(sn) === tp || low(sn) === nm) return true;
    /* Заводской номер — это преимущественно цифры. Обозначение типа прибора
       («УОМ3 4Т30П», «ИПС-МГ4.03») состоит из нескольких буквенных групп при
       коротких числах. Отсюда правило: три и более буквы при отсутствии
       сплошного числа из четырёх и более цифр — это тип, а не номер. */
    var letters = (sn.match(/[А-Яа-яЁёA-Za-z]/g) || []).length;
    var longNum = /\d{4,}/.test(sn);
    return letters >= 3 && !longNum;
  });
  add('III. Метрология', 'Заводские номера средств измерений указаны',
      (noSn.length || snIsType.length) ? X : (SI.length ? Y : W),
      !SI.length ? 'лист «СИ» пуст' :
      (noSn.length ? 'не указан у ' + noSn.length + ' СИ' : '') +
      (noSn.length && snIsType.length ? '; ' : '') +
      (snIsType.length ? 'похоже на обозначение типа, а не на заводской номер: ' +
        few(snIsType.map(function(r){ return s(r['Заводской №']); }), 3) : '') ||
      'указаны');

  /* 3. Формат записи о поверке во ФГИС «Аршин». */
  var badFgis = SI.filter(function(r){
    var v = s(r['№ записи о поверке во ФГИС «Аршин»']);
    /* Запись ФГИС «Аршин» вида «С-ДЮП/27-08-2026/…»: после буквы вида документа
       идёт буквенный шифр организации-поверителя. Прежний шаблон ждал цифру сразу
       после первого дефиса и браковал этот формат — в том числе в заготовках
       приборов самого инструмента. */
    return v && !/^\s*(№\s*)?[А-ЯЁA-Z]{1,4}(?:[-\/][А-ЯЁA-Z]{1,6})*[-\/]\d/i.test(v);
  });
  if (SI.length)
    add('III. Метрология', 'Формат записи о поверке во ФГИС «Аршин»', badFgis.length ? W : Y,
        badFgis.length ? 'проверьте: ' + few(badFgis.map(function(r){ return s(r['№ записи о поверке во ФГИС «Аршин»']); }), 3) :
          'формат соблюдён');

  /* 4. Значения на границе норматива — нулевой запас. */
  var edge = [];
  M.forEach(function(m, i){
    var val = n(m['Значение']);
    var norm = s(m['Нормативное требование']);
    var lim = n((norm.match(/(?:не\s+менее|не\s+более)\s+([\d.,]+)/i) || [])[1]);
    if (isNaN(val) || isNaN(lim) || lim === 0) return;
    if (Math.abs(val - lim) / lim <= 0.015)
      edge.push('оп. ' + (s(m['№ опоры']) || '—') + ' · ' + s(m['Вид измерения']).toLowerCase() +
                ' ' + s(m['Значение']) + ' при ' + lim);
  });
  add('III. Метрология', 'Значения не лежат на границе норматива', edge.length ? W : Y,
      edge.length ? few(edge, 3) + ' — запас нулевой, вывод «соответствует» уязвим без указания погрешности' :
        'запас по измеренным величинам имеется');

  /* 5. Выборка при измерении сопротивления заземления. */
  var zaz = M.filter(function(m){ return /сопротивлен[а-яё]*\s*заземл/i.test(s(m['Вид измерения'])); });
  var zazBound = zaz.filter(function(m){ return s(m['№ опоры']); });
  var decl = s(raw('ЗАЗЕМ_ВЫБОРКА'));
  var pctDecl = n((decl.match(/(\d+)\s*%/) || [])[1]);
  if (d.total){
    var needZ = isNaN(pctDecl) ? 0 : Math.max(1, Math.round(d.total * pctDecl / 100));
    var stZ = !decl ? X : (zazBound.length < needZ ? X : Y);
    add('III. Метрология', 'Выборка при измерении сопротивления заземления подтверждена', stZ,
        !decl ? 'выборка не заявлена в паспорте при ' + d.total + ' опорах' :
        (zazBound.length < needZ ?
          'заявлено «' + decl + '» — это ' + needZ + ' опор(ы) при ' + d.total +
          ', фактически измерений с привязкой к опоре: ' + zazBound.length :
          'заявлено «' + decl + '», измерений с привязкой: ' + zazBound.length));
  }

  /* 6. Дефект подтверждён измерением соответствующего вида. */
  if (core && core.measNeededFor){
    var unproved = [];
    P.forEach(function(r){
      var txt = s(r['Дефект']) + ' ' + s(r['Примечание']);
      if (!s(r['Дефект'])) return;
      var need = core.measNeededFor(txt);
      if (!need.length) return;
      var mine = M.filter(function(m){
        return s(m['№ опоры']) === s(r['№ опоры']) && s(m['Линия / фидер']) === s(r['Линия / фидер']);
      });
      need.forEach(function(rule){
        var ok = mine.some(function(m){
          var k = core.measByName ? core.measByName(s(m['Вид измерения'])) : null;
          return k && rule.need.indexOf(k.id) >= 0;
        });
        if (!ok) unproved.push('оп. ' + s(r['№ опоры']) + ' → ' + rule.what);
      });
    });
    unproved = uniq(unproved);
    add('III. Метрология', 'Дефект подтверждён измерением', unproved.length ? X : Y,
        unproved.length ? few(unproved, 5) +
          ' — категория состояния и понижающий коэффициент в приложении Ж количественно не обоснованы' :
          'обоснование обеспечено');
  }

  /* 7. Фотоматериал по дефектным опорам. */
  if (d.defects && d.defects.length && ctx.photoNames){
    var names = ctx.photoNames.map(low).join(' | ');
    var noPhoto = d.defects.filter(function(r){
      var num = low(r['№ опоры']);
      return num && names.indexOf(num) < 0;
    }).map(function(r){ return s(r['№ опоры']); });
    add('III. Метрология', 'Дефектные опоры обеспечены фотоматериалом', noPhoto.length ? X : Y,
        noPhoto.length ? 'нет снимка по опорам: ' + few(noPhoto, 6) :
          'фотоматериалы приложены');
  }

  /* ------------------------------------------- II. НЕПРОТИВОРЕЧИВОСТЬ */

  /* 8. Пролёт согласован с расстоянием по координатам. */
  var gs = geoSpans(P);
  var mismatch = [], lastSpan = [];
  gs.byRow.forEach(function(rec){
    var sp = n(rec.row['Пролёт до следующей опоры, м']);
    if (rec.last){
      if (!isNaN(sp)) lastSpan.push(s(rec.num));
      return;
    }
    if (isNaN(sp) || isNaN(rec.geo)) return;
    var diff = Math.abs(sp - rec.geo);
    if (diff > 5 && diff / Math.max(rec.geo, 1) > 0.15)
      mismatch.push('оп. ' + rec.num + ': в отчёте ' + sp + ' м, по координатам ' + rec.geo + ' м');
  });
  add('II. Непротиворечивость', 'Пролёт согласован с координатами опор', mismatch.length ? X : Y,
      mismatch.length ? few(mismatch, 5) : (gs.byRow.length ? 'расхождений нет' : 'координаты не заданы'));
  add('II. Непротиворечивость', 'У концевой опоры цепи пролёт не указан', lastSpan.length ? X : Y,
      lastSpan.length ? 'пролёт «до следующей» указан у последних опор цепи: ' + few(lastSpan, 6) :
        'соответствие обеспечено');

  /* 9. Разрывы трассы. */
  add('II. Непротиворечивость', 'Разрывов трассы в расчёте пролётов нет', gs.jumps.length ? X : Y,
      gs.jumps.length ? 'расстояние до следующей опоры неправдоподобно велико: ' +
        few(gs.jumps.map(function(j){ return 'оп. ' + j.num + ' → ' + j.next + ' — ' + j.geo + ' м при пределе ' + j.lim; }), 4) +
        '. Порядок опор в пределах линии нарушен либо метки разных фидеров смешаны' :
        'разрывов нет');

  /* 9-бис. Смежность пролётов: у промежуточной опоры два смежных пролёта,
     у концевой один, и в обоих случаях названа смежная опора. */
  if (core && core.chainSpans){
    var chain = core.chainSpans(P, {
      line:function(r){ return r['Линия / фидер']; }, num:function(r){ return r['№ опоры']; },
      lat:function(r){ return r['Широта']; },        lon:function(r){ return r['Долгота']; },
      span:function(r){ return r['Пролёт до следующей опоры, м']; },
      mark:function(r){ return r['Марка опоры']; }
    });
    var noNb = [], badMid = [], badEnd = [];
    chain.forEach(function(rec){
      if (!rec.prevNum && !rec.nextNum){ noNb.push(rec.num); return; }
      var cnt = (rec.lPrev !== null ? 1 : 0) + (rec.lNext !== null ? 1 : 0);
      if (!rec.ends && cnt < 2) badMid.push(rec.num + ' (' + cnt + ' из 2)');
      if (rec.ends && cnt < 1) badEnd.push(rec.num);
    });
    add('II. Непротиворечивость', 'Смежные опоры определены по всей трассе', noNb.length ? X : Y,
        noNb.length ? 'опоры без смежных: ' + few(noNb, 6) +
          ' — одиночная опора в линии либо номер не сопоставляется с остальными' :
          (P.length ? 'смежность установлена по ' + chain.length + ' опорам' : 'перечень опор пуст'));
    add('II. Непротиворечивость', 'У промежуточной опоры учтены два пролёта', badMid.length ? X : Y,
        badMid.length ? 'смежный пролёт не задан: ' + few(badMid, 6) +
          ' — расчётный (ветровой) пролёт по таким опорам занижен' : 'учтены');
    add('II. Непротиворечивость', 'У концевой опоры учтён смежный пролёт', badEnd.length ? X : Y,
        badEnd.length ? 'нет ни одного смежного пролёта: ' + few(badEnd, 6) : 'учтён');
  }

  /* 10. Протяжённость участка. */
  var declLen = n(raw('ОБЪЕКТ_ДЛИНА'));
  if (gs.links && !isNaN(declLen) && declLen > 0){
    var geoKm = gs.total / 1000;
    var dev = Math.abs(declLen - geoKm) / Math.max(geoKm, 0.001);
    add('II. Непротиворечивость', 'Протяжённость участка согласована с геометрией', dev > 0.25 ? X : Y,
        'в паспорте ' + String(declLen).replace('.', ',') + ' км, по координатам ' +
        String(Math.round(geoKm * 100) / 100).replace('.', ',') + ' км' +
        (dev > 0.25 ? ' — расхождение ' + Math.round(dev * 100) + ' %' : ''));
  }

  /* 11. Характер местности не противоречит типу опоры. */
  var mestConf = P.filter(function(r){
    var t = low(r['Тип по назначению']), m = low(r['Характер местности']);
    if (!t || !m) return false;
    return (/ненасел/.test(t) && /^населённая|^населенная/.test(m)) ||
           (/\(насел/.test(t) && /ненасел/.test(m));
  }).map(function(r){ return s(r['№ опоры']); });
  add('II. Непротиворечивость', 'Характер местности не противоречит типу опоры', mestConf.length ? X : Y,
      mestConf.length ? 'конфликт по ' + mestConf.length + ' опорам: ' + few(mestConf, 6) +
        ' — от признака местности зависит нормируемый габарит до земли' : 'конфликтов нет');

  /* 12. Ранее размещённые ОК ↔ существующая подвеска приложения Ж. */
  var lw = S.loadWires || [];
  var otherInLoad = lw.filter(function(w){ return /иной пользовател|данный пользовател/i.test(s(w['Принадлежность'])); });
  var anyPrev = P.some(function(r){ var v = s(r['Ранее размещённые ОК — владелец']); return v && v !== '—'; });
  if (otherInLoad.length && !anyPrev)
    add('II. Непротиворечивость', 'Ранее размещённые ОК отражены в перечне опор', X,
        'в приложении Ж учтена подвеска иного пользователя (' + otherInLoad.length +
        ' поз.), но в перечне опор графа «ранее размещённые ОК» не заполнена ни по одной опоре — ' +
        'критерий пункта 5.1 «наличие свободного места» документально не подтверждён');
  else
    add('II. Непротиворечивость', 'Ранее размещённые ОК отражены в перечне опор', Y,
        anyPrev ? 'сведения приведены' : 'ранее размещённых элементов нет');

  /* 13. Полнота приложения Г.2 по нормируемым интервалам. */
  if (core && core.MEAS){
    var g2ids = core.MEAS.filter(function(k){ return k.g2; }).map(function(k){ return k.id; });
    var have = {};
    (d.measG2 || []).forEach(function(m){
      var k = core.measByName(s(m['Вид измерения']));
      if (k) have[k.id] = 1;
    });
    var missG2 = g2ids.filter(function(id){ return !have[id]; })
                      .map(function(id){ return core.measById(id).name.toLowerCase(); });
    /* расстояние до провода нормируется только при наличии класса напряжения */
    add('II. Непротиворечивость', 'Полнота оценки свободных интервалов (приложение Г.2)',
        (d.measG2 && d.measG2.length) ? (missG2.length ? X : Y) : X,
        !(d.measG2 && d.measG2.length) ? 'оценка достаточности интервалов не выполнялась, при этом пункт 5.3 содержит вывод о соблюдении расстояний' :
        (missG2.length ? 'не оценивались: ' + few(missG2, 4) + ' — вывод пункта 5.3 шире фактически проверенного' :
          'все нормируемые интервалы оценены'));
  }

  /* 14. Свободная высота ≥ заявленной высоты подвеса. */
  var hDecl = 0;
  (S.cables || []).forEach(function(c){ var h = n(c['Высота подвеса, м']); if (h > hDecl) hDecl = h; });
  if (hDecl > 0){
    var free = (d.measG2 || []).filter(function(m){ return /свободн[а-яё]*\s*высот/i.test(s(m['Вид измерения'])); });
    var tooLow = free.filter(function(m){ var v = n(m['Значение']); return !isNaN(v) && v < hDecl; })
                     .map(function(m){ return s(m['Значение']) + ' м'; });
    if (free.length)
      add('II. Непротиворечивость', 'Свободная высота не ниже заявленной высоты подвеса', tooLow.length ? X : Y,
          tooLow.length ? 'фактически свободно ' + few(tooLow, 3) + ' при заявленной высоте подвеса ' +
            String(hDecl).replace('.', ',') + ' м — значения не согласованы' : 'согласовано');
  }

  /* 15. Обязательные графы перечня опор. */
  var noKv = P.filter(function(r){ return !s(r['Класс напряжения опоры']); }).map(function(r){ return s(r['№ опоры']) || '?'; });
  var noNum = P.filter(function(r){ return !s(r['№ опоры']) || /^б\/?н$/i.test(s(r['№ опоры'])); }).length;
  add('I. Комплектность', 'Обязательные графы перечня опор заполнены',
      (noKv.length || noNum) ? X : (P.length ? Y : W),
      !P.length ? 'перечень пуст' :
      ((noKv.length ? 'без класса напряжения: ' + few(noKv, 6) : '') +
       (noKv.length && noNum ? '; ' : '') +
       (noNum ? 'без номера опоры: ' + noNum + ' поз.' : '')) || 'заполнены');

  /* 16. Единообразие нумерации опор. */
  var shapes = {};
  P.forEach(function(r){
    var v = s(r['№ опоры']);
    if (!v) return;
    var k = /^\d+$/.test(v) ? 'числовой' : (/^\d+-\d+[а-яёa-z]?$/i.test(v) ? 'через дефис' :
            (/\//.test(v) ? 'с дробью' : 'иной'));
    shapes[k] = (shapes[k] || 0) + 1;
  });
  var shapeKeys = Object.keys(shapes);
  add('I. Комплектность', 'Единообразие нумерации опор', shapeKeys.length > 2 ? W : Y,
      shapeKeys.length > 2 ? 'форматы номеров: ' +
        shapeKeys.map(function(k){ return k + ' — ' + shapes[k]; }).join('; ') +
        '. Сопоставление опор с протоколами и эксплуатационной документацией затруднено' :
        'нумерация единообразна');

  /* 17. Наименования линий в протоколах совпадают с перечнем опор. */
  var lineSet = {};
  P.forEach(function(r){ var k = s(r['Линия / фидер']); if (k) lineSet[k] = 1; });
  var strayLines = uniq(M.filter(function(m){
    var k = s(m['Линия / фидер']);
    return k && k !== '—' && !lineSet[k];
  }).map(function(m){ return s(m['Линия / фидер']); }));
  add('II. Непротиворечивость', 'Наименования линий в протоколах совпадают с перечнем опор', strayLines.length ? X : Y,
      strayLines.length ? 'в протоколах есть линии, которых нет в перечне опор: ' + few(strayLines, 4) :
        'соответствие обеспечено');

  /* ------------------------------------------------------- IV. СРОКИ */

  /* 18. Срок по пункту 16 Правил — тридцать рабочих дней.
     Считается ядром по правилам раздела 6 Регламента: рабочие дни,
     течение со следующего рабочего дня, приостановление по пункту 6.2.3
     исключается. Договорный срок этот срок не заменяет — пункт 7.1.4
     Регламента прямо предписывает контролировать его в порядке пункта 6.2. */
  var toDate = ctx.toDate || function(){ return null; };
  var DL = (core && core.deadlines) ? core.deadlines(S.pass || {}) : null;
  var dIn  = DL ? DL.reg : (toDate(raw('ЗАПРОС_ВХ_ДАТА')) || toDate(raw('ЗАПРОС_ДАТА')));
  var dRep = DL ? DL.report : toDate(raw('ОТЧЁТ_ДАТА'));
  if (dIn && dRep && DL && DL.p16){
    var over = dRep > DL.p16;
    add('IV. Сроки', 'Срок по пункту 16 Правил (30 рабочих дней)', over ? X : Y,
        'запрос ' + fmt(dIn) + ', предельная дата ' + fmt(DL.p16) + ', отчёт ' + fmt(dRep) +
        ' — израсходовано рабочих дней: ' + DL.workSpent +
        (DL.pause ? ' (учтено приостановление ' + DL.pause + ' раб. дн., пункт 6.2.3 Регламента)' : '') +
        (over ? '. Договорный срок императивный срок Правил не заменяет (пункт 17 Правил, пункт 7.1.4 Регламента)' : ''));
  } else {
    add('IV. Сроки', 'Срок по пункту 16 Правил (30 рабочих дней)', W,
        'не заполнена дата регистрации запроса либо дата отчёта');
  }

  /* ------------------------------------------------------- VII. ЦЕНА */

  /* 19. Стоимость работ выражена числом. */
  var price = s(raw('ЦЕНА_РАБОТЫ'));
  var hasNum = /\d/.test(price.replace(/п\.?\s*16|№\s*\d+|2106|13/gi, ''));
  add('I. Комплектность', 'Стоимость работ выражена числом', price ? (hasNum ? Y : X) : X,
      !price ? 'не указана' :
      (hasNum ? price : 'указано «' + price + '» — отсылка к прейскуранту без числового значения ' +
        'не раскрывает цену по подпунктам «б» и «д» пункта 10 Правил'));
  var prObj = s(raw('ПРЕЙСКУРАНТ'));
  add('I. Комплектность', 'Реквизиты документа об утверждении прейскуранта', /\d/.test(prObj) ? Y : X,
      /\d/.test(prObj) ? prObj : 'указано «' + (prObj || '—') + '» — нет номера и даты');
  var pub = s(raw('ЦЕНА_ПУБЛИКАЦИЯ'));
  if (pub)
    add('I. Комплектность', 'Ссылка на опубликованный порядок формирования цены',
        /\/\S/.test(pub.replace(/^https?:\/\//, '')) ? Y : W,
        /\/\S/.test(pub.replace(/^https?:\/\//, '')) ? 'указана' :
          'указан корневой адрес сайта без ссылки на раздел');

  /* --------------------------------- V. НЕСУЩАЯ СПОСОБНОСТЬ (дополнение) */

  /* 20. Тип местности по ветру при малом запасе. */
  if (la && la.rows && la.rows.length){
    var minRes = null;
    la.rows.forEach(function(r){ if (r.reserve !== null && (minRes === null || r.reserve < minRes)) minRes = r.reserve; });
    var ter = s(raw('МЕСТНОСТЬ_ТИП')).toUpperCase();
    if (minRes !== null && minRes < 25 && /^[BВ]/.test(ter))
      add('V. Несущая способность', 'Тип местности по ветру обоснован при малом запасе', W,
          'минимальный запас ' + (Math.round(minRes * 10) / 10).toString().replace('.', ',') +
          ' % при типе местности «' + ter + '» (коэффициент 0,65). При типе «A» коэффициент 1,0, ' +
          'расчётная ветровая нагрузка возрастает примерно в полтора раза и запас обращается в отрицательный. ' +
          'Выбор типа местности подлежит документальному обоснованию по пункту 2.5.6 ПУЭ-7');
    else
      add('V. Несущая способность', 'Тип местности по ветру обоснован при малом запасе', Y,
          'запас достаточен либо тип местности не является определяющим');
  }

  /* 21. Сроки и стоимость мероприятий. */
  var noTermE1 = (d.actsE1 || []).filter(function(r){ return !s(r['Срок выполнения']); }).length;
  var noCost = AC.filter(function(r){ return !s(r['Ориентировочная стоимость, руб. с НДС']); }).length;
  add('VI. Разделение ответственности', 'Сроки и стоимость мероприятий заданы',
      (noTermE1 || noCost) ? W : (AC.length ? Y : Y),
      !AC.length ? 'мероприятий нет' :
      ((noTermE1 ? 'без срока в группе Е.1: ' + noTermE1 + ' поз.' : '') +
       (noTermE1 && noCost ? '; ' : '') +
       (noCost ? 'без ориентировочной стоимости: ' + noCost + ' поз.' : '')) || 'заданы');

  /* 22. Служебные строки в графе «№ опоры» приложения Е. */
  var svc = AC.filter(function(r){ return /опор данной марки/i.test(s(r['№ опоры'])); }).length;
  add('VI. Разделение ответственности', 'В графе «№ опоры» приложения Е нет служебных строк', svc ? W : Y,
      svc ? 'служебная строка вместо номеров опор в ' + svc + ' поз. — охват мероприятия следует указывать отдельно' :
        'соответствие обеспечено');

  return A;
}

/* ============================================================ ШЛЮЗ ВЫПУСКА
   Выгрузка и печать при наличии несоответствий возможны единственным путём —
   через письменное решение о выпуске. Решение печатается в лист внутреннего
   контроля и попадает в .docx: молчаливый выпуск становится невозможен. */
var _release = null;   /* { reason, person, when } */

function releaseDecision(){ return _release; }
function clearRelease(){ _release = null; }

function ensureStyles(){
  if (document.getElementById('ppoGateCss')) return;
  var st = document.createElement('style');
  st.id = 'ppoGateCss';
  st.textContent =
    '.ppo-gate{position:fixed;inset:0;background:rgba(20,24,28,.55);z-index:9999;' +
      'display:flex;align-items:center;justify-content:center;padding:24px}' +
    '.ppo-gate .box{background:#fff;border-radius:14px;max-width:760px;width:100%;' +
      'max-height:86vh;overflow:auto;padding:22px 24px;box-shadow:0 18px 50px rgba(0,0,0,.3);' +
      'font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1B2A33}' +
    '.ppo-gate h3{margin:0 0 6px;font-size:19px}' +
    '.ppo-gate .sub{color:#5A6B75;margin:0 0 14px}' +
    '.ppo-gate ol{margin:0 0 14px;padding-left:20px}' +
    '.ppo-gate li{margin-bottom:7px}' +
    '.ppo-gate li b{color:#A32B2B}' +
    '.ppo-gate .warnli b{color:#B26A00}' +
    '.ppo-gate label{display:block;font-weight:600;margin:12px 0 5px}' +
    '.ppo-gate textarea,.ppo-gate input{width:100%;box-sizing:border-box;padding:9px 11px;' +
      'border:1px solid #CFD8DD;border-radius:8px;font:inherit}' +
    '.ppo-gate textarea{min-height:76px;resize:vertical}' +
    '.ppo-gate .row{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}' +
    '.ppo-gate button{padding:9px 16px;border-radius:8px;border:1px solid #CFD8DD;' +
      'background:#fff;font:inherit;cursor:pointer}' +
    '.ppo-gate button.main{background:#1F6F63;border-color:#1F6F63;color:#fff}' +
    '.ppo-gate button.risk{background:#fff;border-color:#A32B2B;color:#A32B2B}' +
    '.ppo-gate button[disabled]{opacity:.45;cursor:not-allowed}' +
    '.ppo-gate .adv{margin-top:14px;border-top:1px solid #E6ECEF;padding-top:12px}' +
    '.ppo-gate .adv summary{cursor:pointer;color:#5A6B75}';
  document.head.appendChild(st);
}

/* Показывает шлюз. Возвращает Promise<boolean>: true — можно продолжать. */
function gate(audit, action){
  var fails = audit.filter(function(a){ return a.st === 'fail'; });
  var warns = audit.filter(function(a){ return a.st === 'warn'; });
  if (!fails.length){
    /* замечания не блокируют, но фиксируются */
    if (warns.length && !_release)
      _release = { reason:'', person:'', when:'', warnOnly:true, warns:warns.length };
    return Promise.resolve(true);
  }
  ensureStyles();
  return new Promise(function(resolve){
    var wrap = document.createElement('div');
    wrap.className = 'ppo-gate';
    wrap.innerHTML =
      '<div class="box" role="dialog" aria-modal="true">' +
        '<h3>Выпуск отчёта не допускается</h3>' +
        '<p class="sub">Внутренний контроль выявил несоответствий: <b>' + fails.length + '</b>' +
          (warns.length ? ', замечаний: ' + warns.length : '') +
          '. ' + (action === 'print' ? 'Печать' : 'Выгрузка в Word') +
          ' возможна после их устранения.</p>' +
        '<ol>' + fails.map(function(a){
            return '<li><b>' + a.name + '</b><br>' + a.note + '</li>';
          }).join('') + '</ol>' +
        (warns.length ?
          '<details class="adv"><summary>Замечания, требующие пояснения (' + warns.length + ')</summary><ol>' +
          warns.map(function(a){ return '<li class="warnli"><b>' + a.name + '</b><br>' + a.note + '</li>'; }).join('') +
          '</ol></details>' : '') +
        '<details class="adv">' +
          '<summary>Выпустить под ответственность руководителя работ</summary>' +
          '<p class="sub" style="margin-top:10px">Решение печатается в листе внутреннего контроля ' +
            'и входит в состав отчёта. Без обоснования выпуск невозможен.</p>' +
          '<label for="gReason">Обоснование выпуска при наличии несоответствий</label>' +
          '<textarea id="gReason" placeholder="Например: несоответствие по пункту … устранено вне книги исходных данных, подтверждающий документ …"></textarea>' +
          '<label for="gWho">Фамилия и инициалы принявшего решение</label>' +
          '<input id="gWho" placeholder="Иванов И.И.">' +
          '<div class="row"><button class="risk" id="gForce" disabled>Выпустить с обоснованием</button></div>' +
        '</details>' +
        '<div class="row"><button class="main" id="gBack">Вернуться к устранению</button></div>' +
      '</div>';
    document.body.appendChild(wrap);

    var reason = wrap.querySelector('#gReason'),
        who    = wrap.querySelector('#gWho'),
        force  = wrap.querySelector('#gForce');
    function recheck(){
      force.disabled = !(reason.value.trim().length >= 40 && who.value.trim().length >= 3);
    }
    reason.addEventListener('input', recheck);
    who.addEventListener('input', recheck);

    function close(ok){
      wrap.remove();
      document.removeEventListener('keydown', onEsc);
      resolve(ok);
    }
    function onEsc(e){ if (e.key === 'Escape') close(false); }
    document.addEventListener('keydown', onEsc);

    wrap.querySelector('#gBack').onclick = function(){ close(false); };
    force.onclick = function(){
      _release = {
        reason: reason.value.trim(),
        person: who.value.trim(),
        when: fmt(new Date()),
        fails: fails.length,
        warns: warns.length
      };
      close(true);
    };
    wrap.onclick = function(e){ if (e.target === wrap) close(false); };
  });
}

global.PPOAudit = {
  extraChecks: extraChecks,
  geoSpans: geoSpans,
  gate: gate,
  releaseDecision: releaseDecision,
  clearRelease: clearRelease,
  addWorkdays: addWorkdays
};

})(typeof window !== 'undefined' ? window : this);
