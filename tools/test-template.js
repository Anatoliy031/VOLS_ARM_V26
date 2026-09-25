/* Сквозная проверка шаблона: заполнить его данными осмотра, прочитать обратно
   и сверить. Именно так книга работает в инструменте. */
var path=require('path');
var H=require('./harness');
var C=H.loadCore(), P=C.PPO, XLSX=C.XLSX;
var pass=0,fail=0;
function ok(n,c,e){ if(c)pass++; else {fail++;console.log('  ✗ '+n+(e?' :: '+e:''));} }

var d=P.blank();
d.pass['ОБЪЕКТ_КЛАСС']='10'; d.pass['ОБЪЕКТ_НАИМ']='ВЛ 10 кВ ТМ-6';
d.pass['СХЕМА_РАБОТ']='без снятия напряжения (в охранной зоне, по распоряжению)';
d.pass['МЕСТНОСТЬ_ТИП']='A — открытые побережья морей, озёр и водохранилищ, пустыни, степи, лесостепи, тундра';
d.poles=[
 {id:'a',line:'ВЛ 10 кВ ТМ-6',num:'92',kv:'10',mark:'ПМ10-1',span:'',spanSrc:'',hangs:3,defect:'—',
  defText:'скол у комля',lat:'45.000000',lon:'39.0',photos:[],note:'',mest:'населённая',angle:'',
  prevOwner:'',prevH:'',endPole:0,nextId:'',prevId:'',nextRef:'',prevRef:''},
 {id:'b',line:'ВЛ 10 кВ ТМ-6',num:'93',kv:'10',mark:'А10-1',span:'',spanSrc:'',hangs:2,defect:'Б',
  defText:'наклон стойки',lat:'45.000450',lon:'39.0',photos:[],note:'',mest:'населённая',angle:'',
  prevOwner:'',prevH:'',endPole:1,nextId:'',prevId:'',nextRef:'',prevRef:''}];
d.wires=[{mark:'СИП-3 1х70',n:3,kv:'10',h:'6',tens:'7',belong:'Владелец (провода ВЛ)',note:''}];
d.cables=[{mark:'ОКСН-8-4,0',n:1,kv:'10',h:'5,5',type:'ОКСН — самонесущий неметаллический'}];
d.si=[{name:'Измеритель угла наклона',mark:'УОМ3 4Т30П',sn:'УОМ3 4Т30П',fgis:'АС-ВЮ/29-06-26',d1:'2026-06-30',d2:'2027-06-29'}];
d.meas=[{id:'m',pole:'92',line:'ВЛ 10 кВ ТМ-6',kindId:'vert',name:'Отклонение стойки от вертикали',
  place:'вершина',value:'1/143',unit:'—',norm:'не более 1/100',verdict:'соответствует',
  si:'УОМ3 4Т30П',proto:'Г.1 — фактическое состояние',vals:{deg:'0.4',h:'10'}}];
P.replaceAll(d); P.recalcSpans({force:true});

var tpl=XLSX.readFile(require('path').join(H.ROOT,'ID_shablon.xlsx'));
console.log('--- шаблон открывается и содержит нужные листы ---');
['Паспорт','Линии','Кабели','Опоры','Измерения','СИ','Мероприятия','Нагрузки',
 'Спр_ВЛ','Спр_Кабели','Спр_Опоры','Спр_Измерения','Спр_Дефекты','Спр_Списки',
 'Спр_Провода','Спр_Приборы'].forEach(function(n){
  ok('лист «'+n+'»', tpl.SheetNames.indexOf(n)>=0);
});

console.log('--- заполнение шаблона данными осмотра ---');
var filled=null, err=null;
try { filled=P.fillTemplate(tpl); } catch(e){ err=e.message; }
ok('fillTemplate отработал', !!filled && !err, err);

if(filled){
  var buf=XLSX.write(filled,{type:'buffer',bookType:'xlsx'});
  ok('книга записывается', buf.length>20000, String(buf.length));
  var back=XLSX.read(buf,{type:'buffer'});
  /* Считаем строки с номером опоры, а не все подряд: в сохранённой из Excel
     книге формулы вычислены во всех двухстах строках заготовки, и пустые
     строки тоже возвращаются разбором. Ядро при чтении их отбрасывает. */
  var all=XLSX.utils.sheet_to_json(back.Sheets['Опоры'],{defval:''});
  var rows=all.filter(function(r){ return String(r['№ опоры']||'').trim(); });
  ok('опоры записаны', rows.length===2, 'строк с номером '+rows.length+' из '+all.length);
  ok('марка из нового справочника', String(rows[0]['Марка опоры'])==='ПМ10-1', rows[0]['Марка опоры']);
  ok('служебная отметка несёт конец участка', /КОНЕЧНАЯ/.test(String(rows[1]['Служебная отметка'])),
     JSON.stringify(rows[1]['Служебная отметка']));
  var ld=XLSX.utils.sheet_to_json(back.Sheets['Нагрузки'],{header:1,defval:''});
  var hi=ld.findIndex(function(r){return /^Марка провода/.test(String(r[0]));});
  var b2=ld.slice(hi+1).filter(function(r){return String(r[0]).trim();});
  ok('в блоке 2 провода ВЛ и выведенные ОК', b2.length===2, JSON.stringify(b2.map(function(r){return r[0];})));

  console.log('--- обратное чтение ---');
  P.replaceAll(P.blank());
  P.importWorkbook(back);
  var D=P.load();
  ok('опоры прочитаны', D.poles.length===2, String(D.poles.length));
  ok('пустые строки заготовки опор не создают',
     D.poles.every(function(p){ return String(p.num||'').trim(); }),
     JSON.stringify(D.poles.map(function(p){return p.num;})));
  ok('признак конца участка пережил круг', D.poles[1].endPole===1);
  ok('марка пережила круг', D.poles[0].mark==='ПМ10-1', D.poles[0].mark);
  ok('подвесы пережили круг', String(D.poles[0].hangs)==='3', String(D.poles[0].hangs));
}
console.log('  пройдено '+pass+', провалено '+fail);
process.exit(fail?1:0);
