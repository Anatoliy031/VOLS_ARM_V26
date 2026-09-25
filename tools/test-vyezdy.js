/* Раздел «Выезды»: исключение объектов по статусу договора (графа «Статус»,
   столбец AA реестра). Реестр подменяется модельным CSV. */
/* Раздел «Выезды» в браузерном окружении на модельном реестре.
   Опубликованную таблицу подменяем: запрос отдаёт CSV, собранный здесь. */
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const NM=process.env.PPO_NODE_MODULES||path.join(ROOT,'node_modules');
const {JSDOM}=require(path.join(NM,'jsdom'));
let pass=0,fail=0;
function ok(n,c,e){ if(c)pass++; else {fail++;console.log('  ✗ '+n+(e?' :: '+e:''));} }

function csv(rows){ return rows.map(r=>r.map(c=>{c=String(c);return /[",\n]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c;}).join(',')).join('\n'); }
/* шапка: статус стоит в столбце AA (27-й, индекс 26) */
function head(statusName){
  const h=new Array(30).fill('');
  h[0]='ПЭС'; h[1]='Контрагент'; h[2]='Объект'; h[3]='Предмет договора';
  h[4]='Протяжённость, км'; h[5]='Дата оплаты'; h[6]='Исключено из выездов';
  h[7]='Э3 факт'; h[26]=statusName; h[27]='Статус оплаты';
  return h;
}
function row(pes,cust,obj,km,status,payStatus){
  const r=new Array(30).fill('');
  r[0]=pes; r[1]=cust; r[2]=obj; r[3]='ППО'; r[4]=km; r[5]='оплачено 100%';
  r[26]=status; r[27]=payStatus||'оплачено';
  return r;
}
function page(csvText,fn){
  let html=fs.readFileSync(path.join(ROOT,'vyezdy.html'),'utf8');
  html=html.replace(/<script src="(ppo-[a-z]+\.js)(\?[^"]*)?"><\/script>/g,
    (m,f)=>'<script>'+fs.readFileSync(path.join(ROOT,f),'utf8')+'</script>');
  html=html.replace(/<script src="https?:[^"]*"><\/script>/g,'');
  const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'https://x/vyezdy.html',
    beforeParse(w){
      const store={};
      Object.defineProperty(w,'localStorage',{value:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v);},removeItem(){},clear(){}}});
      w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});
      w.fetch=()=>Promise.resolve({ok:true,text:()=>Promise.resolve(csvText)});
      w.setInterval=()=>0;
    }});
  return new Promise(r=>setTimeout(()=>r(fn(dom.window,dom.window.document)),700));
}
const kpi=(d,i)=>d.querySelectorAll('#kpis .kpi .n')[i].textContent;

(async()=>{
console.log('--- статус в столбце AA по заголовку «Статус» ---');
const R=[head('Статус'),
  row('Краснодарские ЭС','ООО Связь-1','ВЛ 10 кВ ТМ-6, ст. Динская',3.2,'В работе'),
  row('Краснодарские ЭС','ООО Связь-2','ВЛ 10 кВ Т-3, ст. Динская',2.1,'Завершен'),
  row('Краснодарские ЭС','ООО Связь-3','ВЛ 0,4 кВ, ст. Динская',1.4,'Расторжение'),
  row('Краснодарские ЭС','ООО Связь-4','ВЛ 10 кВ Д-1, ст. Динская',1.8,'Согласование'),
  row('Краснодарские ЭС','ООО Связь-5','ВЛ 10 кВ Д-2, ст. Динская',2.6,'Завершён'),
  row('Краснодарские ЭС','ООО Связь-6','ВЛ 10 кВ Д-3, ст. Динская',1.1,'На согласовании'),
  row('Краснодарские ЭС','ООО Связь-7','ВЛ 10 кВ Д-4, ст. Динская',0.9,'Не согласовано'),
  row('Краснодарские ЭС','ООО Связь-8','ВЛ 10 кВ Д-5, ст. Динская',1.5,''),
];
await page(csv(R),(w,d)=>{
  const raw=w.eval('RAW');
  ok('все восемь строк прочитаны', raw.length===8, String(raw.length));
  ok('графа «Статус» найдена в столбце AA', w.eval('mapHeaders(['+JSON.stringify(R[0]).slice(1,-1)+']).status')===26);
  const done=raw.filter(o=>o.statusDone).map(o=>o.status);
  ok('«Завершен» исключён', done.includes('Завершен'));
  ok('«Расторжение» исключено', done.includes('Расторжение'));
  ok('«Согласование» исключено', done.includes('Согласование'));
  ok('«Завершён» с буквой ё исключён', done.includes('Завершён'));
  ok('«На согласовании» исключено', done.includes('На согласовании'));
  ok('«Не согласовано» НЕ исключено', !done.includes('Не согласовано'));
  ok('«В работе» остаётся', !done.includes('В работе'));
  ok('пустой статус остаётся', raw.filter(o=>o.status==='').every(o=>!o.statusDone));
  ok('объектов к обследованию — три', kpi(d,0)==='3', kpi(d,0));
  const box=d.getElementById('done');
  ok('сводка исключённых выведена', /выезд уже выполнен \(5\)/.test(box.textContent), box.textContent.slice(0,90));
  ok('в сводке разбивка по статусам', /Завершен — 1/.test(box.textContent) && /Расторжение — 1/.test(box.textContent));
});

console.log('--- статус оплаты не путается со статусом договора ---');
const R2=[head('Статус'),
  row('Краснодарские ЭС','ООО А','ВЛ 10 кВ, ст. Динская',2,'В работе','Завершено'),
];
await page(csv(R2),(w,d)=>{
  ok('«Статус оплаты» не принят за статус', w.eval('RAW')[0].statusDone===false, JSON.stringify(w.eval('RAW')[0].status));
});

console.log('--- заголовка «Статус» нет: берётся столбец AA ---');
const H3=head(''); 
const R3=[H3, row('Краснодарские ЭС','ООО Б','ВЛ 10 кВ, ст. Динская',2,'Завершен'),
               row('Краснодарские ЭС','ООО В','ВЛ 10 кВ, ст. Динская',2,'В работе')];
await page(csv(R3),(w,d)=>{
  ok('статус прочитан из столбца AA', w.eval('RAW')[0].status==='Завершен', JSON.stringify(w.eval('RAW')[0].status));
  ok('исключение сработало', w.eval('RAW')[0].statusDone===true);
  ok('к обследованию один', kpi(d,0)==='1', kpi(d,0));
});

console.log('--- столбцы переставлены: «Статус» не в AA ---');
const H4=new Array(30).fill('');
H4[0]='ПЭС';H4[1]='Контрагент';H4[2]='Объект';H4[4]='Протяжённость, км';H4[5]='Дата оплаты';H4[10]='Статус';
const r4=new Array(30).fill(''); r4[0]='Краснодарские ЭС'; r4[1]='ООО Г'; r4[2]='ВЛ 10 кВ, ст. Динская'; r4[4]=2; r4[5]='оплачено'; r4[10]='Расторжение';
await page(csv([H4,r4]),(w,d)=>{
  ok('статус найден по заголовку, а не по букве', w.eval('RAW')[0].status==='Расторжение', JSON.stringify(w.eval('RAW')[0].status));
  ok('исключение сработало', w.eval('RAW')[0].statusDone===true);
});

console.log('--- прежнее поведение не нарушено ---');
const R5=[head('Статус'),
  (()=>{const r=row('Краснодарские ЭС','ООО Д','ВЛ 10 кВ, ст. Динская',2,'В работе');r[6]='да';return r;})(),
  (()=>{const r=row('Краснодарские ЭС','ООО Е','ВЛ 10 кВ, ст. Динская',2,'В работе');r[7]='12.08.2026';return r;})(),
  row('Краснодарские ЭС','ООО Ж','ВЛ 10 кВ, ст. Динская',2,'В работе'),
];
await page(csv(R5),(w,d)=>{
  ok('«Исключено из выездов: да» по-прежнему исключает', kpi(d,0)==='1', kpi(d,0));
  ok('сводка по статусу пуста', d.getElementById('done').textContent.trim()==='');
});

console.log('  [выезды] пройдено '+pass+', провалено '+fail);
process.exit(fail?1:0);
})();
