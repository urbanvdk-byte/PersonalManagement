import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Download, FolderKanban, Inbox, LayoutGrid, ListTodo, Menu, Plus, Search, Target, Trash2, X } from 'lucide-react';
import { api, isDemo } from './api';
import { addDays, dateTimeLocal, dayKey, fmtDate, fmtTime, makeDay, priorityFlags, weekStart } from './date';
import type { Editing, EventItem, Goal, Kind, Page, Store, Task } from './types';

const empty:Store={areas:[],projects:[],goals:[],tasks:[],events:[]};
const pages:{id:Page;title:string;icon:typeof CalendarDays}[]=[
 {id:'calendar',title:'Календарь',icon:CalendarDays},{id:'inbox',title:'Входящие',icon:Inbox},
 {id:'tasks',title:'Все задачи',icon:ListTodo},{id:'matrix',title:'Приоритеты',icon:LayoutGrid},
 {id:'projects',title:'Проекты',icon:FolderKanban},{id:'goals',title:'Цели',icon:Target},
 {id:'areas',title:'Направления',icon:Target}
];
const statuses:Record<string,string>={inbox:'Входящие',planned:'Запланировано',in_progress:'В работе',waiting:'Ожидаю',done:'Выполнено',someday:'Когда-нибудь',cancelled:'Отменено'};
const projectStatuses:Record<string,string>={active:'Активен',paused:'Пауза',done:'Завершён',archived:'Архив'};
const labels:Record<Kind,string>={areas:'направление',projects:'проект',goals:'цель',tasks:'задачу',events:'событие'};
const colors=['#d84f46','#e5ad27','#0a91df','#91a0b3'];
const isOpen=(t:Task)=>!['done','cancelled'].includes(t.status);
const groupName=(id:number|null,items:{id:number;title:string}[])=>items.find(x=>x.id===id)?.title||'Без привязки';
function percent(goal:Goal){const range=goal.target_value-goal.start_value;return range===0?(goal.current_value>=goal.target_value?100:0):Math.max(0,Math.min(100,Math.round(100*(goal.current_value-goal.start_value)/range)))}

type DrawerProps={editing:Editing;store:Store;close:()=>void;save:(kind:Kind,data:Record<string,unknown>,id?:number)=>Promise<void>;remove:(kind:Kind,id:number)=>Promise<void>};
function Drawer({editing,store,close,save,remove}:DrawerProps){
 const {kind,record,defaults}=editing;
 const [form,setForm]=useState<Record<string,unknown>>({...defaults,...record});
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const set=(key:string,value:unknown)=>setForm(v=>({...v,[key]:value}));
 const field=(key:string,label:string,placeholder='')=><label className="form-field"><span>{label}</span><input value={String(form[key]??'')} placeholder={placeholder} onChange={e=>set(key,e.target.value)}/></label>;
 const choices=(key:string,label:string,opts:Record<string,string>)=><label className="form-field"><span>{label}</span><select value={String(form[key]??Object.keys(opts)[0])} onChange={e=>set(key,e.target.value)}>{Object.entries(opts).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>;
 const refs=(key:string,label:string,items:{id:number;title:string}[])=><label className="form-field"><span>{label}</span><select value={String(form[key]??'')} onChange={e=>set(key,e.target.value?Number(e.target.value):null)}><option value="">Не выбрано</option>{items.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label>;
 const dateField=(key:string,label:string,time=false)=><label className="form-field"><span>{label}</span><input type={time?'datetime-local':'date'} value={String(form[key]??'').slice(0,time?16:10)} onChange={e=>set(key,e.target.value||null)}/></label>;
 const number=(key:string,label:string,defaultValue=0)=><label className="form-field"><span>{label}</span><input type="number" step={kind==='goals'?'any':'1'} min={key==='duration_minutes'?1:undefined} value={Number(form[key]??defaultValue)} onChange={e=>set(key,Number(e.target.value))}/></label>;
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');
  const payload={...form};delete payload.id;delete payload.created_at;delete payload.updated_at;
  if(kind==='tasks')Object.assign(payload,priorityFlags(Number(payload.priority??4)));
  try{await save(kind,payload,record?.id);close()}catch(err){setError(err instanceof Error?err.message:String(err))}finally{setBusy(false)}
 }
 async function doRemove(){if(!record||!window.confirm('Удалить запись без возможности отмены?'))return;setBusy(true);
  try{await remove(kind,record.id);close()}catch(err){setError(String(err));setBusy(false)}
 }
 return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><aside className="drawer" role="dialog" aria-modal="true" aria-label="Редактирование">
  <div className="drawer-head"><div><small>{record?'РЕДАКТИРОВАНИЕ':'НОВАЯ ЗАПИСЬ'}</small><h2>{record?'Изменить':'Добавить'} {labels[kind]}</h2></div><button className="icon-btn" onClick={close} aria-label="Закрыть"><X size={20}/></button></div>
  <form onSubmit={submit} className="drawer-form">
   {field('title','Название *','Название задачи или результата')}
   {kind==='areas'&&<label className="form-field"><span>Цвет</span><input type="color" value={String(form.color??'#4689db')} onChange={e=>set('color',e.target.value)}/></label>}
   {kind!=='areas'&&<label className="form-field"><span>{kind==='tasks'||kind==='events'?'Заметки':'Описание'}</span><textarea rows={3} value={String(form[kind==='tasks'||kind==='events'?'notes':'description']??'')} onChange={e=>set(kind==='tasks'||kind==='events'?'notes':'description',e.target.value)}/></label>}
   {kind!=='areas'&&<div className="two">{refs('area_id','Направление',store.areas)}{kind!=='projects'&&refs('project_id','Проект',store.projects)}</div>}
   {kind==='projects'&&<>{choices('status','Статус проекта',projectStatuses)}<div className="two">{dateField('start_date','Начало')}{dateField('due_date','Срок')}</div></>}
   {kind==='goals'&&<><div className="two">{dateField('period_start','Начало периода')}{dateField('period_end','Конец периода')}</div><div className="two">{number('start_value','Исходное')}{number('target_value','Цель',1)}</div><div className="two">{number('current_value','Достигнуто')}{field('unit','Единица','шт., км, ₽')}</div></>}
   {kind==='tasks'&&<>
    {refs('goal_id','Цель',store.goals)}
    <div className="two"><label className="form-field"><span>Приоритет</span><select value={Number(form.priority??4)} onChange={e=>set('priority',Number(e.target.value))}>
     <option value={1}>P1 — важно и срочно</option><option value={2}>P2 — важно</option><option value={3}>P3 — срочно</option><option value={4}>P4 — прочее</option>
    </select></label>{choices('status','Статус',statuses)}</div>
    <div className="two">{dateField('scheduled_at','Когда выполнить',true)}{dateField('due_at','Дедлайн',true)}</div>
    {number('duration_minutes','Длительность, минут',60)}
    <p className="form-help">Дата выполнения и крайний срок — разные поля. Приоритет задаёт положение в матрице Эйзенхауэра.</p>
   </>}
   {kind==='events'&&<><div className="two">{dateField('starts_at','Начало *',true)}{dateField('ends_at','Окончание *',true)}</div><label className="form-field"><span>Цвет</span><input type="color" value={String(form.color??'#f3bb28')} onChange={e=>set('color',e.target.value)}/></label></>}
   {error&&<p role="alert" className="error">{error}</p>}
   <div className="form-actions">{record&&<button type="button" className="danger-btn" disabled={busy} onClick={doRemove}><Trash2 size={15}/> Удалить</button>}<button className="primary-btn" disabled={busy} type="submit"><Check size={16}/>{busy?'Сохраняю…':'Сохранить'}</button></div>
  </form></aside></div>
}
function TaskList({tasks,store,edit,toggle,message='Здесь пока нет задач'}:{tasks:Task[];store:Store;edit:(e:Editing)=>void;toggle:(task:Task)=>void;message?:string}){
 if(!tasks.length)return <div className="empty">{message}</div>;
 return <div className="task-list">{tasks.map(t=><div className="task-row" key={t.id}>
   <button className={'task-check '+(t.status==='done'?'done':'')} onClick={()=>toggle(t)} aria-label="Отметить выполненным">{t.status==='done'&&<Check size={13}/>}</button>
   <button className="task-main" onClick={()=>edit({kind:'tasks',record:t})}><strong className={t.status==='done'?'strike':''}>{t.title}</strong><small>{groupName(t.project_id,store.projects)}{t.due_at?' · срок '+fmtDate(t.due_at):''}{t.scheduled_at?' · '+fmtTime(t.scheduled_at):''}</small></button>
   <span className={'priority p'+t.priority}>P{t.priority}</span>
  </div>)}</div>
}
function WeekView({start,store,day,setDay,edit,slot}:{start:Date;store:Store;day:string;setDay:(s:string)=>void;edit:(e:Editing)=>void;slot:(date:Date)=>void}){
 const days=Array.from({length:7},(_,i)=>addDays(start,i));
 const hours=Array.from({length:16},(_,i)=>i+7);
 const current=dayKey(new Date());
 return <div className="calendar-scroll"><div className="cal-inner">
  <div className="cal-row cal-head"><div className="rail-label">МЕСТН.</div>{days.map(d=><button className={'day-head '+(day===dayKey(d)?'selected':'')} key={dayKey(d)} onClick={()=>setDay(dayKey(d))}><small>{d.toLocaleDateString('ru-RU',{weekday:'short'}).toUpperCase()}</small><strong className={dayKey(d)===current?'today':''}>{d.getDate()}</strong></button>)}</div>
  <div className="cal-row all-day"><div className="rail-label">Весь день</div>{days.map(d=><div className="allday-cell" key={dayKey(d)}>{store.tasks.filter(t=>isOpen(t)&&!t.scheduled_at&&t.due_at?.startsWith(dayKey(d))).slice(0,3).map(t=><button key={t.id} onClick={()=>edit({kind:'tasks',record:t})}>{t.title}</button>)}</div>)}</div>
  <div className="cal-row cal-body">
   <div className="time-rail">{hours.map(h=><span key={h} style={{top:(h-7)*62-7}}>{String(h).padStart(2,'0')}:00</span>)}</div>
   {days.map(d=>{
    const key=dayKey(d);
    const tasks=store.tasks.filter(t=>isOpen(t)&&t.scheduled_at?.startsWith(key)).map(t=>({id:t.id,kind:'tasks' as const,title:t.title,start:t.scheduled_at!,minutes:t.duration_minutes,color:colors[t.priority-1]||colors[3],record:t}));
    const events=store.events.filter(e=>e.starts_at.startsWith(key)).map(e=>({id:e.id,kind:'events' as const,title:e.title,start:e.starts_at,minutes:Math.max(15,(new Date(e.ends_at).getTime()-new Date(e.starts_at).getTime())/60000),color:e.color,record:e}));
    return <div key={key} className={'day-track '+(day===key?'active':'')} style={{height:16*62}} onClick={e=>{
      if(e.target!==e.currentTarget)return;
      const rect=e.currentTarget.getBoundingClientRect();
      const minute=Math.max(0,Math.min(15.5*60,Math.floor((e.clientY-rect.top)/31)*30));
      const v=new Date(d);v.setHours(7,minute,0,0);slot(v);
    }}>{[...tasks,...events].map(b=>{
      const t=new Date(b.start);const minutes=t.getHours()*60+t.getMinutes();
      if(minutes>=23*60||minutes+b.minutes<=7*60)return null;
      const top=Math.max(0,(minutes-7*60)*62/60);
      const height=Math.max(25,Math.min(b.minutes*62/60,16*62-top));
      return <button key={b.kind+b.id} className="cal-item" style={{top,height,borderLeftColor:b.color,backgroundColor:b.color+'26'}} onClick={e=>{e.stopPropagation();edit({kind:b.kind,record:b.record})}} title={b.title}><strong>{b.title}</strong><small>{fmtTime(b.start)}</small></button>;
    })}</div>;
   })}
  </div>
 </div></div>
}
export default function App(){
 const [data,setData]=useState<Store>(empty);const [page,setPage]=useState<Page>('calendar');
 const [week,setWeek]=useState(weekStart(new Date()));const [selectedDay,setSelectedDay]=useState(dayKey(new Date()));
 const [editing,setEditing]=useState<Editing|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
 const [search,setSearch]=useState('');const [mobile,setMobile]=useState(false);
 const load=async()=>setData(await api.load());
 useEffect(()=>{load().catch(e=>setError(String(e))).finally(()=>setLoading(false))},[]);
 const save=async(kind:Kind,payload:Record<string,unknown>,id?:number)=>{await api.save(kind,payload,id);await load()};
 const remove=async(kind:Kind,id:number)=>{await api.remove(kind,id);await load()};
 const toggle=async(t:Task)=>{try{await save('tasks',{status:t.status==='done'?'planned':'done'},t.id)}catch(e){setError(String(e))}};
 const open=(kind:Kind,defaults:Record<string,unknown>={})=>{
  const basic=kind==='tasks'?{priority:4,status:'inbox',duration_minutes:60}:kind==='projects'?{status:'active'}:kind==='goals'?{start_value:0,target_value:1,current_value:0}:kind==='events'?{color:'#f3bb28'}:{color:'#4689db'};
  setEditing({kind,defaults:{...basic,...defaults}});
 };
 const active=data.tasks.filter(isOpen);const overdue=active.filter(t=>t.due_at&&t.due_at.slice(0,10)<dayKey(new Date())).length;
 const filtered=useMemo(()=>data.tasks.filter(t=>t.title.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))),[data.tasks,search]);
 const selectedTasks=active.filter(t=>t.scheduled_at?.startsWith(selectedDay)||t.due_at?.startsWith(selectedDay));
 const selectedEvents=data.events.filter(t=>t.starts_at.startsWith(selectedDay));
 const title=pages.find(x=>x.id===page)?.title||'Календарь';
 const resetToday=()=>{setWeek(weekStart(new Date()));setSelectedDay(dayKey(new Date()))};
 const addSlot=(d:Date)=>open('tasks',{scheduled_at:dateTimeLocal(d),status:'planned'});
 return <div className="app">
  <aside className={'sidebar '+(mobile?'open':'')}>
   <div className="brand"><div className="brand-icon"><Target size={23}/></div><div><strong>PersonalManagement</strong><span>Мой центр управления</span></div></div>
   <div className="nav-caption">ПЛАНИРОВАНИЕ</div>
   <nav>{pages.map(p=><button key={p.id} className={'nav-item '+(page===p.id?'selected':'')} onClick={()=>{setPage(p.id);setMobile(false)}}><p.icon size={18}/>{p.title}{p.id==='inbox'&&data.tasks.filter(t=>t.status==='inbox').length>0&&<em>{data.tasks.filter(t=>t.status==='inbox').length}</em>}</button>)}</nav>
   <div className="sidebar-foot"><div>Открытых задач <strong>{active.length}</strong></div><div>Просроченных <strong>{overdue}</strong></div><button className="export-link" onClick={()=>api.download().catch(e=>setError(String(e)))}><Download size={15}/> Выгрузить данные JSON</button></div>
  </aside>
  {mobile&&<button className="nav-mask" onClick={()=>setMobile(false)} aria-label="Закрыть навигацию"/>}
  <div className="workspace">
   <header className="topbar"><div className="top-title"><button className="icon-btn mobile-toggle" onClick={()=>setMobile(true)}><Menu size={21}/></button><div><small>МОЙ ПЛАН</small><h1>{title}</h1></div></div>
    <div className="top-actions">{page==='calendar'&&<div className="week-nav"><button className="subtle-btn" onClick={resetToday}>Сегодня</button><button className="icon-btn" onClick={()=>setWeek(addDays(week,-7))}><ChevronLeft size={19}/></button><button className="icon-btn" onClick={()=>setWeek(addDays(week,7))}><ChevronRight size={19}/></button><span>{fmtDate(week,{day:'numeric',month:'short'})} — {fmtDate(addDays(week,6),{day:'numeric',month:'short',year:'numeric'})}</span></div>}
     <button className="secondary-btn hide-mobile" onClick={()=>open('events',{starts_at:selectedDay+'T10:00',ends_at:selectedDay+'T11:00'})}><CalendarDays size={16}/> Событие</button>
     <button className="primary-btn" onClick={()=>open('tasks')}><Plus size={17}/> Задача</button>
    </div>
   </header>
   {isDemo&&<div className="demo-banner"><span><strong>Демонстрация GitHub Pages</strong> · Данные только в этом браузере, без синхронизации. Не вводите личную или конфиденциальную информацию.</span><button onClick={()=>{if(window.confirm('Сбросить демонстрационные записи?'))api.resetDemo().then(setData).catch(e=>setError(String(e)))}}>Сбросить демо</button></div>}
   {error&&<div className="error-banner" role="alert">{error}<button onClick={()=>setError('')}><X size={16}/></button></div>}
   <main className="main">
    {loading?<div className="loading">Загружаем план…</div>:<>
    {page==='calendar'&&<div className="calendar-layout"><WeekView start={week} store={data} day={selectedDay} setDay={setSelectedDay} edit={setEditing} slot={addSlot}/><aside className="day-panel">
     <small>ПЛАН ДНЯ</small><h2>{fmtDate(selectedDay,{weekday:'long',day:'numeric',month:'long'})}</h2>
     <div className="day-stat"><strong>{selectedTasks.length}</strong> задач на выбранный день</div><h3>Задачи</h3>
     <TaskList tasks={selectedTasks} store={data} edit={setEditing} toggle={toggle} message="На этот день задач пока нет"/>
     {selectedEvents.length>0&&<><h3>События</h3>{selectedEvents.map(e=><button className="event-row" key={e.id} onClick={()=>setEditing({kind:'events',record:e})}><span style={{background:e.color}}/><div><strong>{e.title}</strong><small>{fmtTime(e.starts_at)}–{fmtTime(e.ends_at)}</small></div></button>)}</>}
     <button className="inline-add" onClick={()=>open('tasks',{scheduled_at:selectedDay+'T10:00',status:'planned'})}><Plus size={16}/> Добавить в этот день</button>
     <p className="tip">Нажмите на свободную ячейку календаря, чтобы назначить время задаче.</p>
    </aside></div>}
    {page==='inbox'&&<section className="content narrow"><div className="content-header"><div><h2>Входящие</h2><p>Собирайте здесь всё новое, затем распределяйте по проектам и времени.</p></div><button className="primary-btn" onClick={()=>open('tasks')}><Plus size={16}/> Добавить</button></div><TaskList tasks={filtered.filter(t=>t.status==='inbox')} store={data} edit={setEditing} toggle={toggle} message="Входящие пусты"/></section>}
    {page==='tasks'&&<section className="content narrow"><div className="content-header"><div><h2>Все задачи</h2><p>Общий список личных дел, работы и проектов.</p></div><button className="primary-btn" onClick={()=>open('tasks')}><Plus size={16}/> Добавить</button></div><label className="search"><Search size={18}/><input placeholder="Поиск по названию" value={search} onChange={e=>setSearch(e.target.value)}/></label><h3 className="section-label">Активные</h3><TaskList tasks={filtered.filter(isOpen).sort((a,b)=>a.priority-b.priority)} store={data} edit={setEditing} toggle={toggle}/><h3 className="section-label">Завершённые</h3><TaskList tasks={filtered.filter(t=>!isOpen(t))} store={data} edit={setEditing} toggle={toggle}/></section>}
    {page==='matrix'&&<section className="content"><div className="content-header"><div><h2>Матрица Эйзенхауэра</h2><p>Распределение задач по важности и срочности.</p></div><button className="primary-btn" onClick={()=>open('tasks')}><Plus size={16}/> Добавить</button></div><div className="matrix">{[
      ['Важно и срочно','Сделать в первую очередь'],['Важно, не срочно','Запланировать время'],['Срочно, не важно','Делегировать или упростить'],['Не важно, не срочно','Отложить или исключить']
     ].map(([name,hint],i)=><div className={'matrix-cell m'+(i+1)} key={name}><header><span className={'priority p'+(i+1)}>P{i+1}</span><div><h3>{name}</h3><small>{hint}</small></div></header>{active.filter(t=>t.priority===i+1).map(t=><button key={t.id} className="matrix-task" onClick={()=>setEditing({kind:'tasks',record:t})}><strong>{t.title}</strong><small>{groupName(t.project_id,data.projects)}</small></button>)}{!active.some(t=>t.priority===i+1)&&<p className="tip">Задач нет</p>}<button className="matrix-add" onClick={()=>open('tasks',{priority:i+1})}><Plus size={15}/> Добавить</button></div>)}</div></section>}
    {page==='projects'&&<section className="content"><div className="content-header"><div><h2>Проекты</h2><p>Сроки, задачи и измеримые результаты каждого проекта.</p></div><button className="primary-btn" onClick={()=>open('projects')}><Plus size={16}/> Проект</button></div><div className="cards">{data.projects.map(p=>{
      const tasks=data.tasks.filter(t=>t.project_id===p.id);const done=tasks.filter(t=>t.status==='done').length;
      return <button className="entity-card" key={p.id} onClick={()=>setEditing({kind:'projects',record:p})}><header><FolderKanban size={21}/><span className="pill">{projectStatuses[p.status]||p.status}</span></header><h3>{p.title}</h3><p>{p.description||groupName(p.area_id,data.areas)}</p><div className="card-meta"><span>{done}/{tasks.length} задач</span><span>{p.due_date?fmtDate(p.due_date):'Без срока'}</span></div><div className="progress"><div style={{width:tasks.length?done/tasks.length*100+'%':'0%'}}/></div><small>{data.goals.filter(g=>g.project_id===p.id).length} связанных целей</small></button>;
     })}{!data.projects.length&&<div className="empty-card">Создайте первый проект, а затем свяжите с ним задачи и цели.</div>}</div><h3 className="section-label">Задачи по проектам</h3><TaskList tasks={active.filter(t=>t.project_id!==null)} store={data} edit={setEditing} toggle={toggle}/></section>}
    {page==='goals'&&<section className="content"><div className="content-header"><div><h2>Измеримые цели</h2><p>Целевые значения, фактический прогресс, период достижения.</p></div><button className="primary-btn" onClick={()=>open('goals')}><Plus size={16}/> Цель</button></div><div className="cards">{data.goals.map(g=><button key={g.id} className="entity-card" onClick={()=>setEditing({kind:'goals',record:g})}><header><Target size={21}/><span className="pill">{percent(g)}%</span></header><h3>{g.title}</h3><p>{groupName(g.project_id,data.projects)}</p><div className="goal-value">{g.current_value} <small>/ {g.target_value} {g.unit}</small></div><div className="progress"><div style={{width:percent(g)+'%'}}/></div><div className="card-meta"><span>{g.period_start?fmtDate(g.period_start):'Без начала'}</span><span>{g.period_end?fmtDate(g.period_end):'Без конца'}</span></div></button>)}{!data.goals.length&&<div className="empty-card">Создайте первую измеримую цель: показатель, период и ожидаемый результат.</div>}</div></section>}
    {page==='areas'&&<section className="content"><div className="content-header"><div><h2>Направления</h2><p>Постоянные сферы вашей жизни — работа, здоровье, семья, финансы и другие.</p></div><button className="primary-btn" onClick={()=>open('areas')}><Plus size={16}/> Направление</button></div><div className="cards">{data.areas.map(a=><button key={a.id} className="entity-card" onClick={()=>setEditing({kind:'areas',record:a})}><header><span className="area-dot" style={{background:a.color}}/><span className="pill">Направление</span></header><h3>{a.title}</h3><p>{data.projects.filter(p=>p.area_id===a.id).length} проектов · {data.goals.filter(g=>g.area_id===a.id).length} целей</p><div className="card-meta"><span>{active.filter(t=>t.area_id===a.id).length} открытых задач</span></div></button>)}{!data.areas.length&&<div className="empty-card">Добавьте направления жизни, чтобы организовать проекты, цели и задачи.</div>}</div></section>}
    </>}
   </main>
  </div>
  {editing&&<Drawer key={editing.kind+'-'+(editing.record?.id||'new')+JSON.stringify(editing.defaults||{})} editing={editing} store={data} close={()=>setEditing(null)} save={save} remove={remove}/>}
 </div>
}
