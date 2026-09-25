/* ============================================================================
   ППО ВОЛС — точечная правка книги Excel без её пересборки.
   Зачем: обычная перезапись .xlsx библиотекой разбора теряет заливку ячеек
   и выпадающие списки, а в ID_shablon.xlsx именно они отличают ручной ввод
   от автоматического. Здесь книга остаётся исходным ZIP-архивом, а меняются
   только значения нужных ячеек внутри XML листов.
   Требуется JSZip.
   ========================================================================== */
(function (global) {
'use strict';

function colName(n){                       // 1 -> A, 27 -> AA
  var s = '';
  while (n > 0){ var m = (n-1) % 26; s = String.fromCharCode(65+m) + s; n = (n-1-m)/26; }
  return s;
}
function colIndex(s){                      // A -> 1
  var n = 0;
  for (var i=0;i<s.length;i++) n = n*26 + (s.charCodeAt(i)-64);
  return n;
}
function xesc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;');
}

/* ------------------------------------------------- одна ячейка листа */
function cellXml(ref, styleAttr, v){
  if (v === '' || v === null || v === undefined) return '';
  var s = styleAttr ? ' ' + styleAttr : '';
  if (typeof v === 'number' && isFinite(v))
    return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
  return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' +
         xesc(v) + '</t></is></c>';
}
function styleOf(cellStr){
  var m = /\ss="(\d+)"/.exec(cellStr || '');
  return m ? 's="' + m[1] + '"' : '';
}

/* Разбирает лист на строки. Возвращает { head, rows:{n:{xml, attrs}}, tail }. */
function splitSheet(xml){
  var i = xml.indexOf('<sheetData');
  var selfClosed = /<sheetData\s*\/>/.test(xml);
  var open, close, body;
  if (selfClosed){
    open = xml.match(/<sheetData\s*\/>/)[0];
    return { head: xml.slice(0, i), body: '', tail: xml.slice(i + open.length), rows: {}, order: [] };
  }
  var startEnd = xml.indexOf('>', i) + 1;
  close = xml.indexOf('</sheetData>', startEnd);
  body = xml.slice(startEnd, close);
  var rows = {}, order = [];
  var re = /<row([^>]*)\/>|<row([^>]*)>([\s\S]*?)<\/row>/g, m;
  while ((m = re.exec(body))){
    var attrs = (m[1] !== undefined ? m[1] : m[2]) || '';
    var inner = m[3] !== undefined ? m[3] : '';
    var rn = /\sr="(\d+)"/.exec(attrs);
    if (!rn) continue;
    var n = +rn[1];
    rows[n] = { attrs: attrs, inner: inner };
    order.push(n);
  }
  return { head: xml.slice(0, startEnd), tail: xml.slice(close), rows: rows, order: order };
}
function joinSheet(sp){
  var nums = Object.keys(sp.rows).map(Number).sort(function(a,b){ return a-b; });
  var body = nums.map(function(n){
    var r = sp.rows[n];
    return r.inner ? '<row' + r.attrs + '>' + r.inner + '</row>' : '<row' + r.attrs + '/>';
  }).join('');
  return sp.head + body + sp.tail;
}

/* Ставит значение в ячейку (r, c). Стиль исходной ячейки сохраняется. */
function setCell(sp, r, c, v){
  var ref = colName(c) + r;
  var row = sp.rows[r];
  if (!row){ row = sp.rows[r] = { attrs:' r="' + r + '"', inner:'' }; }
  var re = new RegExp('<c r="' + ref + '"(?:[^>]*\\/>|[^>]*>[\\s\\S]*?<\\/c>)');
  var found = re.exec(row.inner);
  if (found){
    row.inner = row.inner.replace(re, cellXml(ref, styleOf(found[0]), v));
    return;
  }
  if (v === '' || v === null || v === undefined) return;
  /* вставляем в правильном порядке столбцов */
  var cells = row.inner.match(/<c [^>]*\/>|<c [^>]*>[\s\S]*?<\/c>/g) || [];
  var out = '', done = false;
  for (var i=0;i<cells.length;i++){
    var cr = /r="([A-Z]+)\d+"/.exec(cells[i]);
    if (!done && cr && colIndex(cr[1]) > c){ out += cellXml(ref, '', v); done = true; }
    out += cells[i];
  }
  if (!done) out += cellXml(ref, '', v);
  row.inner = out;
}
function clearCell(sp, r, c){
  var row = sp.rows[r]; if (!row) return;
  var ref = colName(c) + r;
  var re = new RegExp('<c r="' + ref + '"(?:[^>]*\\/>|[^>]*>[\\s\\S]*?<\\/c>)');
  var found = re.exec(row.inner);
  if (found) row.inner = row.inner.replace(re, cellXml(ref, styleOf(found[0]), ''));
}

/* Клонирует строку-образец на новый номер: стили и формулы едут следом,
   ссылки на текущую строку в формулах перенумеровываются. */
function cloneRow(sp, from, to){
  var src = sp.rows[from];
  if (!src) return;
  var inner = src.inner
    .replace(/r="([A-Z]+)(\d+)"/g, function(_, col, n){
      return 'r="' + col + (+n === from ? to : n) + '"';
    })
    .replace(/<f([^>]*)>([\s\S]*?)<\/f>/g, function(_, at, f){
      return '<f' + at + '>' + f.replace(/(\$?[A-Z]{1,3})(\$?)(\d+)/g, function(all, col, abs, n){
        if (abs === '$' || +n !== from) return all;
        return col + to;
      }) + '</f>';
    })
    .replace(/<v>[\s\S]*?<\/v>/g, '');          // кэш значений — Excel пересчитает
  sp.rows[to] = { attrs: src.attrs.replace(/\sr="\d+"/, ' r="' + to + '"'), inner: inner };
}

/* -------------------------------------------------------- главный вход
   plan = [{ sheet:'Опоры', set:[[r,c,v],…], clear:[[r,c],…], clone:[[from,to],…] }] */
function patch(buf, plan){
  if (typeof JSZip === 'undefined') return Promise.reject(new Error('Не подключена библиотека JSZip'));
  return JSZip.loadAsync(buf).then(function(zip){
    return zip.file('xl/workbook.xml').async('string').then(function(wbx){
      return zip.file('xl/_rels/workbook.xml.rels').async('string').then(function(rels){
        /* Имя листа -> путь к XML.
           Порядок атрибутов в OOXML не закреплён: разные генераторы книг
           пишут Id и Target в разной последовательности, а сам Target бывает
           как относительным («worksheets/sheet1.xml»), так и абсолютным по
           пакету («/xl/worksheets/sheet1.xml»). Разбираем каждый элемент
           целиком и вытаскиваем атрибуты по отдельности — иначе книга,
           собранная «не тем» инструментом, молча оставалась без правок. */
        function attr(tag, nameAttr){
          var m2 = new RegExp('\\b' + nameAttr + '="([^"]*)"').exec(tag);
          return m2 ? m2[1] : '';
        }
        var rid = {}, m;
        var reSheet = /<sheet\b[^>]*\/?>/g;
        while ((m = reSheet.exec(wbx))){
          var nm = attr(m[0], 'name'), id0 = attr(m[0], 'r:id') || attr(m[0], 'id');
          if (nm && id0) rid[nm] = id0;
        }
        var tgt = {};
        var reRel = /<Relationship\b[^>]*\/?>/g;
        while ((m = reRel.exec(rels))){
          var id1 = attr(m[0], 'Id'), t1 = attr(m[0], 'Target');
          if (id1 && t1) tgt[id1] = t1;
        }
        function pathOf(name){
          var id = rid[name]; if (!id) return null;
          var t = tgt[id]; if (!t) return null;
          if (t.charAt(0) === '/') return t.slice(1);          // путь от корня пакета
          return 'xl/' + t.replace(/^\.\//, '');              // путь относительно xl/
        }

        var chain = Promise.resolve();
        plan.forEach(function(step){
          var path = pathOf(step.sheet);
          if (!path || !zip.file(path)) return;
          chain = chain.then(function(){
            return zip.file(path).async('string').then(function(xml){
              var sp = splitSheet(xml);
              (step.clone || []).forEach(function(p){ cloneRow(sp, p[0], p[1]); });
              (step.clear || []).forEach(function(p){ clearCell(sp, p[0], p[1]); });
              (step.set   || []).forEach(function(p){ setCell(sp, p[0], p[1], p[2]); });
              var out = joinSheet(sp);
              /* расширяем объявленный диапазон листа */
              var nums = Object.keys(sp.rows).map(Number);
              var maxR = nums.length ? Math.max.apply(null, nums) : 1;
              out = out.replace(/<dimension ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"\/>/,
                function(all, c1, r1, c2, r2){
                  return '<dimension ref="' + c1 + r1 + ':' + c2 + Math.max(+r2, maxR) + '"/>';
                });
              /* растягиваем выпадающие списки на дописанные строки */
              if (step.clone && step.clone.length)
                out = out.replace(/sqref="([^"]+)"/g, function(all, ref){
                  return 'sqref="' + ref.split(/\s+/).map(function(rng){
                    return rng.replace(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/, function(_, a, b, c, d){
                      return a + b + ':' + c + Math.max(+d, maxR);
                    });
                  }).join(' ') + '"';
                });
              zip.file(path, out);
            });
          });
        });

        /* Сбрасываем кэш значений у всех формул: иначе Excel и LibreOffice
           могут показать старые числа шаблона вместо пересчитанных. */
        chain = chain.then(function(){
          var files = [];
          zip.forEach(function(rel){ if (/^xl\/worksheets\/sheet\d+\.xml$/.test(rel)) files.push(rel); });
          return files.reduce(function(pr, rel){
            return pr.then(function(){
              return zip.file(rel).async('string').then(function(x){
                zip.file(rel, x.replace(/(<f[^>]*>[\s\S]*?<\/f>)<v>[\s\S]*?<\/v>/g, '$1'));
              });
            });
          }, Promise.resolve());
        });

        return chain.then(function(){
          /* заставляем Excel пересчитать формулы при открытии */
          zip.remove('xl/calcChain.xml');
          var w = wbx;
          if (/<calcPr[^>]*\/>/.test(w))
            w = w.replace(/<calcPr[^>]*\/>/, '<calcPr calcId="191029" fullCalcOnLoad="1"/>');
          else
            w = w.replace('</workbook>', '<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
          zip.file('xl/workbook.xml', w);
          var ct = 'xl/calcChain.xml';
          return zip.file('[Content_Types].xml').async('string').then(function(c){
            zip.file('[Content_Types].xml',
              c.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''));
            return zip.generateAsync({ type:'blob', compression:'DEFLATE',
              mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          });
        });
      });
    });
  });
}

global.PPOXLSX = { patch:patch, colName:colName, colIndex:colIndex };

})(window);
