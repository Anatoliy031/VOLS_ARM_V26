/* ============================================================================
   ППО ВОЛС — чтение KMZ полевого обхода и разбор полевых обозначений.

   Метка в поле подписывается по схеме
        номер : марка : [линия] : [примечание]
   Линия указывается только там, где она меняется — остальные опоры наследуют
   её от предыдущей метки. Марка пишется полевым сокращением (П3, УА10-1,
   П10/0,38), которое здесь приводится к марке справочника.
   Требуется JSZip.
   ========================================================================== */
(function (global) {
'use strict';

/* ------------------------------------------------------------ ЧТЕНИЕ KMZ */
function readKmz(file){
  if (typeof JSZip === 'undefined') return Promise.reject(new Error('Не подключена библиотека JSZip'));
  return JSZip.loadAsync(file).then(function(zip){
    var kmlName = null;
    zip.forEach(function(rel, f){
      if (!f.dir && /\.kml$/i.test(rel) && (!kmlName || rel.length < kmlName.length)) kmlName = rel;
    });
    if (!kmlName) throw new Error('Внутри архива нет файла .kml');
    return zip.file(kmlName).async('string').then(function(kml){
      var images = {};
      zip.forEach(function(rel, f){
        if (!f.dir && /\.(jpe?g|png|webp)$/i.test(rel)) images[rel] = f;
      });
      return { kml:kml, images:images, zip:zip, name:file.name };
    });
  });
}
/* одиночный .kml тоже принимаем */
function readKml(file){
  return file.text().then(function(t){ return { kml:t, images:{}, zip:null, name:file.name }; });
}
function readAny(file){
  return /\.kml$/i.test(file.name) ? readKml(file) : readKmz(file);
}

/* ------------------------------------------------------------ РАЗБОР KML */
function textOf(node, tag){
  var el = node.getElementsByTagName(tag)[0];
  return el ? (el.textContent || '').trim() : '';
}
function parseKml(kmlText){
  var doc = new DOMParser().parseFromString(kmlText, 'text/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Файл .kml повреждён');
  var docName = '';
  var dn = doc.getElementsByTagName('Document')[0];
  if (dn) docName = textOf(dn, 'name');

  var points = [], tracks = [];
  var pms = doc.getElementsByTagName('Placemark');
  for (var i = 0; i < pms.length; i++){
    var pm = pms[i];
    var name = textOf(pm, 'name');
    var when = textOf(pm, 'when');
    var folder = '';
    var par = pm.parentNode;
    while (par && par.nodeName){
      if (par.nodeName === 'Folder'){ folder = textOf(par, 'name'); break; }
      par = par.parentNode;
    }
    /* картинки из описания */
    var desc = textOf(pm, 'description');
    var imgs = [], m, re = /<img[^>]+src="([^"]+)"/gi;
    while ((m = re.exec(desc))) if (!/^https?:/i.test(m[1])) imgs.push(decodeURIComponent(m[1]));
    /* Часть полевых программ пишет замечание не в подпись, а в описание метки.
       Берём оттуда текст без разметки — иначе наблюдение теряется. */
    var descText = desc.replace(/<[^>]*>/g, ' ')
                       .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
                       .replace(/https?:\/\/\S+/gi, ' ')
                       .replace(/\s+/g, ' ').trim();
    if (descText.length > 300) descText = descText.slice(0, 300).trim();

    var pt = pm.getElementsByTagName('Point')[0];
    var ls = pm.getElementsByTagName('LineString')[0];
    if (pt){
      var c = (textOf(pt, 'coordinates') || '').split(',');
      if (c.length >= 2)
        points.push({ raw:name, folder:folder, when:when, imgs:imgs, desc:descText,
                      lon:parseFloat(c[0]), lat:parseFloat(c[1]), order:i, id:'kml' + i });
    } else if (ls){
      var cc = (textOf(ls, 'coordinates') || '').trim().split(/\s+/).map(function(s){
        var a = s.split(','); return [parseFloat(a[0]), parseFloat(a[1])];
      }).filter(function(a){ return !isNaN(a[0]); });
      if (cc.length) tracks.push({ name:name, coords:cc });
    }
  }
  return { docName:docName, points:points, tracks:tracks };
}

/* ------------------------------------------- РАЗБОР ПОДПИСИ И ОБОЗНАЧЕНИЙ */
/* Обозначение линии: сегмент начинается с ВЛ/КЛ/ТП/РП/ПС и дальше идёт номер
   или название. Проверка по началу строки, иначе «Отклонение» ловится на «кл». */
var RX_LINE = /^\s*(ВЛ|КЛ|ТП|РП|ПС|Ф)\s*[\d№.\-]/i;
/* Номер опоры: цифры, далее допустимы дробь и дефис, в конце — буквенный
   индекс дополнительной опоры или опоры ответвления: «92», «92/1», «5-4»,
   «92а», «92/1а», «5-4А». Без хвостовой буквы метки вида «92а:П10/0,38»
   номера не давали и уходили в список «метки, не ставшие опорами». */
var RX_NUM  = /^\d+[\d\/\-–]*[а-яёa-z]?$/i;

/* полевой префикс -> тип опоры по назначению */
var PREFIX = [
  ['УОА', 'Угловая ответвительная'],
  ['УА',  'Анкерная угловая'],
  ['УП',  'Промежуточно-угловая'],
  ['ОА',  'Ответвительная анкерная'],
  ['АО',  'Ответвительная анкерная'],
  ['КА',  'Концевая анкерная'],
  ['КР',  'Концевая анкерная'],
  ['АР',  'Анкерная (концевая)'],
  ['К',   'Концевая анкерная'],
  ['А',   'Анкерная (концевая)'],
  ['П',   'Промежуточная'],
  ['У',   'Анкерная угловая']
];
function typeOfMark(mark){
  var s = String(mark || '').trim().toUpperCase().replace(/[^А-ЯЁ]/g, function(c){ return /[0-9]/.test(c) ? '' : ''; });
  var letters = String(mark || '').trim().toUpperCase().match(/^[А-ЯЁ]+/);
  if (!letters) return null;
  var L = letters[0];
  for (var i = 0; i < PREFIX.length; i++)
    if (L.indexOf(PREFIX[i][0]) === 0) return PREFIX[i][1];
  return null;
}
/* класс напряжения из названия линии («ВЛ 10 …», «ВЛ 0,4 №1 …») */
function kvOfLine(line){
  var m = /ВЛ\s*([\d]+(?:[,.]\d+)?)/i.exec(String(line || ''));
  if (!m) return '';
  var v = m[1].replace('.', ',');
  return v === '0,38' ? '0,4' : v;
}
/* класс напряжения из полевой марки — запасной путь */
function kvOfMark(mark){
  var s = String(mark || '');
  if (/10\s*[\/\-]\s*0[,.]?38/.test(s) || /^[А-ЯЁ]+10/.test(s)) return '10';
  if (/^[А-ЯЁ]+35/.test(s)) return '35';
  if (/^[А-ЯЁ]+110/.test(s)) return '110';
  if (/^[А-ЯЁ]+6\b/.test(s)) return '6';
  if (/^[А-ЯЁ]+(3|23)\b/.test(s)) return '0,4';
  return '';
}
/* совмещённая опора ВЛ 10/0,4 */
function isCombined(mark){ return /10\s*[\/\-]\s*0[,.]?38/.test(String(mark || '')); }

/* полевая марка + класс -> марка из справочника опор */
function matchMark(fieldMark, kv){
  if (!fieldMark) return '';
  if (PPO.poleByMark(fieldMark)) return fieldMark;          // совпала как есть
  var t = typeOfMark(fieldMark);
  var arr = PPO.polesByKv(kv || kvOfMark(fieldMark));
  if (!arr.length || !t) return '';
  var hit = arr.filter(function(p){ return p.type.indexOf(t) === 0; })[0];
  if (!hit && t === 'Концевая анкерная')
    hit = arr.filter(function(p){ return p.type.indexOf('Анкерная (концевая)') === 0; })[0];
  if (!hit && t === 'Угловая ответвительная')
    hit = arr.filter(function(p){ return p.type.indexOf('Ответвительная анкерная') === 0; })[0];
  return hit ? hit.mark : '';
}

/* ключевые слова примечаний -> категория дефекта */
var DEFECT_WORDS = [
  [/разруш|оголен|обнаж|коррози.*арматур|аварийн/i, 'A'],
  [/отклонен|наклон|крен|трещин|сверх нормы|выправ/i, 'Б'],
  [/скол|загрязн|поверхностн|незначительн|малозначительн/i, 'В']
];
function defectOf(note){
  for (var i = 0; i < DEFECT_WORDS.length; i++)
    if (DEFECT_WORDS[i][0].test(note || '')) return DEFECT_WORDS[i][1];
  return '—';
}

/* Разбор одной подписи. prev — линия предыдущей метки. */
function parseLabel(raw, prevLine){
  var parts = String(raw || '').split(':').map(function(s){ return s.trim(); });
  var first = parts.shift() || '';

  /* «15П10-1» — забыли двоеточие между номером и маркой */
  var glued = /^(\d+[\d\/\-–]*)\s*([А-ЯЁA-Z].*)$/.exec(first);
  var num = first, mark = '';
  if (glued && !RX_NUM.test(first)){ num = glued[1]; mark = glued[2]; }

  if (!RX_NUM.test(num)) return { pole:false, note:raw };   // «Б/С» и прочие пометки

  var line = '', notes = [];
  parts.forEach(function(p, i){
    if (!p) return;
    if (!mark && i === 0 && !RX_LINE.test(p)){ mark = p; return; }
    if (RX_LINE.test(p) && !line){ line = p; return; }
    notes.push(p);
  });
  if (!line) line = prevLine || '';
  var note = notes.join('; ');
  return { pole:true, num:num, mark:mark, line:line, note:note, defect:defectOf(note) };
}

/* --------------------------------------------------------- ИНТЕРПРЕТАЦИЯ */
function interpret(parsed){
  var prevLine = '', poles = [], skipped = [];
  var pts = parsed.points.slice().sort(function(a,b){
    if (a.when && b.when && a.when !== b.when) return a.when < b.when ? -1 : 1;
    return a.order - b.order;
  });

  pts.forEach(function(p){
    var L = parseLabel(p.raw, prevLine);
    if (!L.pole){
      skipped.push({ raw:p.raw, lat:p.lat, lon:p.lon, imgs:p.imgs, when:p.when, id:p.id });
      return;
    }
    prevLine = L.line;
    /* замечание из описания метки, если в подписи его не было */
    if (!L.note && p.desc){ L.note = p.desc; L.defect = defectOf(p.desc); }
    /* Категория дефекта, проставленная в метке явным полем (ExtendedData или
       карточка на карте), важнее вывода по ключевым словам: это осознанный
       выбор осмотрщика, а не догадка по тексту. */
    if (p.defect && /^[АAБBВ]$/.test(String(p.defect).trim())) L.defect = String(p.defect).trim();
    var kv = kvOfLine(L.line) || kvOfMark(L.mark);
    poles.push({
      num:L.num, fieldMark:L.mark, line:L.line, kv:kv,
      combined:isCombined(L.mark), defect:L.defect, note:L.note,
      lat:p.lat, lon:p.lon, when:p.when, imgs:p.imgs, raw:p.raw, id:p.id
    });
  });

  /* уникальные полевые марки — по ним пользователь подтверждает соответствие */
  var byMark = {};
  poles.forEach(function(p){
    var key = (p.fieldMark || '(без марки)') + ' | ' + (p.kv || '?');
    if (!byMark[key]) byMark[key] = { field:p.fieldMark, kv:p.kv, n:0,
      type:typeOfMark(p.fieldMark) || '', guess:matchMark(p.fieldMark, p.kv), combined:p.combined };
    byMark[key].n++;
  });

  /* линии в порядке первого появления */
  var lines = [], seen = {};
  poles.forEach(function(p){
    var l = p.line || '(линия не указана)';
    if (!seen[l]){ seen[l] = { name:p.line, kv:p.kv, n:0, poles:[] }; lines.push(seen[l]); }
    seen[l].n++; seen[l].poles.push(p);
  });

  /* пролёты внутри линии по координатам, в порядке обхода */
  var spanStat = { done:0, ends:0, jumps:[] };
  lines.forEach(function(L){
    for (var i = 0; i < L.poles.length - 1; i++){
      var a = L.poles[i], b = L.poles[i+1];
      var m = PPO.haversine(a.lat, a.lon, b.lat, b.lon);
      if (m > 600){
        a.span = '';
        spanStat.jumps.push({ line:L.name, a:a.num, b:b.num, d:Math.round(m) });
      } else {
        a.span = Math.round(m);
        spanStat.done++;
      }
    }
    if (L.poles.length){ L.poles[L.poles.length-1].span = ''; spanStat.ends++; }
  });

  var dates = poles.map(function(p){ return p.when; }).filter(Boolean).sort();
  var kvs = {}; poles.forEach(function(p){ if (p.kv) kvs[p.kv] = 1; });

  return {
    docName: parsed.docName, poles:poles, lines:lines, skipped:skipped,
    marks: Object.keys(byMark).map(function(k){ return byMark[k]; }),
    tracks: parsed.tracks,
    dateFrom: dates[0] ? dates[0].slice(0,10) : '',
    dateTo:   dates[dates.length-1] ? dates[dates.length-1].slice(0,10) : '',
    kvList: Object.keys(kvs).sort(function(a,b){
      return parseFloat(a.replace(',','.')) - parseFloat(b.replace(',','.')); }),
    photoCount: poles.reduce(function(s,p){ return s + p.imgs.length; }, 0),
    spanStat: spanStat
  };
}

/* Разбор произвольного набора точек тем же порядком, что и файл KMZ.
   Нужен карте: она держит метки в своей структуре, но результат в осмотре
   обязан совпадать с импортом через «Поток» — иначе одни и те же данные
   дают разные опоры в зависимости от того, каким путём их загрузили. */
function interpretPoints(points){
  return interpret({ docName:'', points:points || [], tracks:[] });
}

global.PPOKMZ = {
  readAny:readAny, readKmz:readKmz, parseKml:parseKml, interpret:interpret,
  interpretPoints:interpretPoints, isCombined:isCombined,
  parseLabel:parseLabel, matchMark:matchMark, typeOfMark:typeOfMark,
  kvOfLine:kvOfLine, kvOfMark:kvOfMark, defectOf:defectOf
};

})(window);
