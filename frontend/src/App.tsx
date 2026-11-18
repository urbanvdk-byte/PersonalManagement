import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Download, FolderKanban, Inbox, LayoutGrid, ListTodo, Menu, Plus, Search, Target, Trash2, X } from 'lucide-react';
import { api, isDemo } from './api';
import {hasScheduledTime,isValidTaskDuration} from './taskValidation';
import MiniMonth from './MiniMonth';
import CalendarWeek from './CalendarWeek';
import {TASK_COLORS,DEFAULT_TASK_COLOR,AREA_EMOJIS,areaEmoji,taskColor} from './taskPalette';
import {normalizeRange,shiftCalendarMonth,type DateSelection} from './miniMonthModel';
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
const isOpen=(t:Task)=>!['done','cancelled'].includes(t.status);
const groupName=(id:number|null,items:{id:number;title:string}[])=>items.find(x=>x.id===id)?.title||'Без привязки';
function percent(goal:Goal){const range=goal.target_value-goal.start_value;return range===0?(goal.current_value>=goal.target_value?100:0):Math.max(0,Math.min(100,Math.round(100*(goal.current_value-goal.start_value)/range)))}

type DrawerProps={editing:Editing;store:Store;close:()=>void;save:(kind:Kind,data:Record<string,unknown>,id?:number)=>Promise<void>;remove:(kind:Kind,id:number)=>Promise<void>};
function Drawer({editing,store,close,save,remove}:DrawerProps){
 const {kind,record,defaults}=editing;
 const [form,setForm]=useState<Record<string,unknown>>({...defaults,...record});
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const missingTaskTime=kind==='tasks'&&!hasScheduledTime(form.scheduled_at);
 const invalidTaskDuration=kind==='tasks'&&!isValidTaskDuration(form.duration_minutes??60);
 const missingTitle=!String(form.title??'').trim();
 const preventSave=missingTitle||missingTaskTime||invalidTaskDuration;
 const set=(key:string,value:unknown)=>setForm(v=>({...v,[key]:value}));
 const field=(key:string,label:string,placeholder='')=><label className={'form-field '+(key==='title'&&missingTitle?'required-missing':'')}><span>{label}</span><input value={String(form[key]??'')} placeholder={placeholder} aria-invalid={key==='title'&&missingTitle} onChange={e=>set(key,e.target.value)}/></label>;
 const choices=(key:string,label:string,opts:Record<string,string>)=><label className="form-field"><span>{label}</span><select value={String(form[key]??Object.keys(opts)[0])} onChange={e=>set(key,e.target.value)}>{Object.entries(opts).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>;
 const refs=(key:string,label:string,items:{id:number;title:string}[])=><label className="form-field"><span>{label}</span><select value={String(form[key]??'')} onChange={e=>set(key,e.target.value?Number(e.target.value):null)}><option value="">Не выбрано</option>{items.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label>;
 const dateField=(key:string,label:string,time=false)=>{
   const required=kind==='tasks'&&key==='scheduled_at';
   const invalid=required&&missingTaskTime;
   return <label className={'form-field '+(invalid?'required-missing':'')}><span>{label}{required?' *':''}</span>
     <input type={time?'datetime-local':'date'} value={String(form[key]??'').slice(0,time?16:10)}
       aria-invalid={invalid} required={required} onChange={e=>set(key,e.target.value||null)}/>
     {invalid&&<small className="field-error" role="alert">Укажите дату и время — без них задача не сохранится.</small>}
   </label>;
 };
 const number=(key:string,label:string,defaultValue=0)=>{
   const duration=kind==='tasks'&&key==='duration_minutes';
   return <label className={'form-field '+(duration&&invalidTaskDuration?'required-missing':'')}><span>{label}</span>
     <input type="number" min={duration?30:undefined} max={duration?1440:undefined}
       step={duration?15:kind==='goals'?'any':1} aria-invalid={duration&&invalidTaskDuration}
       value={Number(form[key]??defaultValue)} onChange={e=>set(key,Number(e.target.value))}/>
     {duration&&<small className={invalidTaskDuration?'field-error':'field-hint'}>От 30 минут, шаг 15 минут (30, 45, 60, 75…)</small>}
   </label>;
 };
 async function submit(e:FormEvent){
  e.preventDefault();
  if(preventSave){setError('Заполните обязательные поля задачи и проверьте длительность.');return;}
  setBusy(true);setError('');
  const payload={...form};delete payload.id;delete payload.created_at;delete payload.updated_at;
  if(kind==='tasks'){
    Object.assign(payload,priorityFlags(Number(payload.priority??4)));
    payload.color=taskColor(String(payload.color??DEFAULT_TASK_COLOR));
  }
  if(kind==='areas')payload.emoji=areaEmoji(String(payload.emoji??'📁'));
  try{await save(kind,payload,record?.id);close()}catch(err){setError(err instanceof Error?err.message:String(err))}finally{setBusy(false)}
 }
 async function doRemove(){if(!record||!window.confirm('Удалить запись без возможности отмены?'))return;setBusy(true);
  try{await remove(kind,record.id);close()}catch(err){setError(String(err));setBusy(false)}
 }
 return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><aside className="drawer" role="dialog" aria-modal="true" aria-label="Редактирование">
  <div className="drawer-head"><div><small>{record?'РЕДАКТИРОВАНИЕ':'НОВАЯ ЗАПИСЬ'}</small><h2>{record?'Изменить':'Добавить'} {labels[kind]}</h2></div><button className="icon-btn" onClick={close} aria-label="Закрыть"><X size={20}/></button></div>
  <form onSubmit={submit} className="drawer-form">
   {field('title','Название *','Название задачи или результата')}
   {kind==='areas'&&<>
     <label className="form-field"><span>Цвет направления</span><input type="color" value={String(form.color??'#4689db')} onChange={e=>set('color',e.target.value)}/></label>
     <div className="form-field"><span>Emoji-иконка направления</span>
       <div className="emoji-choices" role="group" aria-label="Выберите emoji направления">
         {AREA_EMOJIS.map(emoji=><button type="button" key={emoji} className={'emoji-choice '+(String(form.emoji??'📁')===emoji?'chosen':'')} onClick={()=>set('emoji',emoji)} aria-label={'Иконка '+emoji} aria-pressed={String(form.emoji??'📁')===emoji}>{emoji}</button>)}
       </div>
     </div>
     {field('emoji','Или вставьте свой emoji','Например, 🌞')}
   </>}
   {kind!=='areas'&&<label className="form-field"><span>{kind==='tasks'||kind==='events'?'Заметки':'Описание'}</span><textarea rows={3} value={String(form[kind==='tasks'||kind==='events'?'notes':'description']??'')} onChange={e=>set(kind==='tasks'||kind==='events'?'notes':'description',e.target.value)}/></label>}
   {kind!=='areas'&&<div className="two">{refs('area_id','Направление',store.areas)}{kind!=='projects'&&refs('project_id','Проект',store.projects)}</div>}
   {kind==='projects'&&<>{choices('status','Статус проекта',projectStatuses)}<div className="two">{dateField('start_date','Начало')}{dateField('due_date','Срок')}</div></>}
   {kind==='goals'&&<><div className="two">{dateField('period_start','Начало периода')}{dateField('period_end','Конец периода')}</div><div className="two">{number('start_value','Исходное')}{number('target_value','Цель',1)}</div><div className="two">{number('current_value','Достигнуто')}{field('unit','Единица','шт., км, ₽')}</div></>}
   {kind==='tasks'&&<>
    {refs('goal_id','Цель',store.goals)}
    <div className="two"><label className="form-field"><span>Приоритет</span><select value={Number(form.priority??4)} onChange={e=>set('priority',Number(e.target.value))}>
     <option value={1}>P1 — важно и срочно</option><option value={2}>P2 — важно</option><option value={3}>P3 — срочно</option><option value={4}>P4 — прочее</option>
    </select></label>{choices('status','Статус',statuses)}</div>
    <div className="form-field"><span>Цвет карточки задачи</span>
      <div className="task-color-choices" role="group" aria-label="Выбор из 8 цветов">
        {TASK_COLORS.map(item=><button type="button" key={item.hex} title={item.name} aria-label={item.name}
          aria-pressed={taskColor(String(form.color??DEFAULT_TASK_COLOR))===item.hex}
          className={'task-color-choice '+(taskColor(String(form.color??DEFAULT_TASK_COLOR))===item.hex?'chosen':'')}
          style={{backgroundColor:item.hex}} onClick={()=>set('color',item.hex)}>
          {taskColor(String(form.color??DEFAULT_TASK_COLOR))===item.hex&&<Check size={15}/>}
        </button>)}
      </div>
      <small className="palette-hint">Цвет фона задачи. Левая полоса всегда обозначает приоритет.</small>
    </div>
    <div className="two">{dateField('scheduled_at','Когда выполнить',true)}{dateField('due_at','Дедлайн',true)}</div>
    {number('duration_minutes','Длительность, минут',60)}
    <p className="form-help">Дата выполнения и крайний срок — разные поля. Приоритет задаёт положение в матрице Эйзенхауэра.</p>
   </>}
   {kind==='events'&&<><div className="two">{dateField('starts_at','Начало *',true)}{dateField('ends_at','Окончание *',true)}</div><label className="form-field"><span>Цвет</span><input type="color" value={String(form.color??'#f3bb28')} onChange={e=>set('color',e.target.value)}/></label></>}
   {error&&<p role="alert" className="error">{error}</p>}
   <div className="form-actions">{record&&<button type="button" className="danger-btn" disabled={busy} onClick={doRemove}><Trash2 size={15}/> Удалить</button>}
     <button type="button" className="secondary-btn cancel-task-btn" disabled={busy} onClick={close}>Отмена</button>
     <button className="primary-btn" disabled={busy||preventSave} type="submit"><Check size={16}/>{busy?'Сохраняю…':'Сохранить'}</button>
   </div>
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
export default function App(){
 const [data,setData]=useState<Store>(empty);const [page,setPage]=useState<Page>('calendar');
 const [selectedDay,setSelectedDay]=useState(dayKey(new Date()));
 const [displayMonth,setDisplayMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));
 const [period,setPeriod]=useState<DateSelection>({start:null,end:null});
 const week=weekStart(makeDay(selectedDay));
 const [editing,setEditing]=useState<Editing|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
 const [search,setSearch]=useState('');const [mobile,setMobile]=useState(false);
 const load=async()=>setData(await api.load());
 useEffect(()=>{load().catch(e=>setError(String(e))).finally(()=>setLoading(false))},[]);
 const save=async(kind:Kind,payload:Record<string,unknown>,id?:number)=>{await api.save(kind,payload,id);await load()};
 const remove=async(kind:Kind,id:number)=>{await api.remove(kind,id);await load()};
 const toggle=async(t:Task)=>{try{await save('tasks',{status:t.status==='done'?'planned':'done'},t.id)}catch(e){setError(String(e))}};
 const open=(kind:Kind,defaults:Record<string,unknown>={})=>{
  const basic=kind==='tasks'?{priority:4,status:'inbox',duration_minutes:60,color:DEFAULT_TASK_COLOR}:kind==='projects'?{status:'active'}:kind==='goals'?{start_value:0,target_value:1,current_value:0}:kind==='events'?{color:'#f3bb28'}:{color:'#4689db',emoji:'📁'};
  setEditing({kind,defaults:{...basic,...defaults}});
 };
 const active=data.tasks.filter(isOpen);const overdue=active.filter(t=>t.due_at&&t.due_at.slice(0,10)<dayKey(new Date())).length;
 const filtered=useMemo(()=>data.tasks.filter(t=>t.title.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))),[data.tasks,search]);
 const selectedTasks=active.filter(t=>t.scheduled_at?.startsWith(selectedDay)||t.due_at?.startsWith(selectedDay));
 const selectedEvents=data.events.filter(t=>t.starts_at.startsWith(selectedDay));
 const title=pages.find(x=>x.id===page)?.title||'Календарь';
 const busyDays=useMemo(()=>{
   const days=new Set<string>();
   data.tasks.filter(isOpen).forEach(t=>{if(t.scheduled_at)days.add(t.scheduled_at.slice(0,10));else if(t.due_at)days.add(t.due_at.slice(0,10))});
   data.events.forEach(e=>days.add(e.starts_at.slice(0,10)));
   return days;
 },[data]);
 function goToDay(key:string){
   setSelectedDay(key);
   const date=makeDay(key);
   setDisplayMonth(new Date(date.getFullYear(),date.getMonth(),1));
   setPeriod({start:null,end:null});
 }
 function pickMonthDate(key:string){goToDay(key);}
 function pickMonthRange(from:string,to:string){
   const normalized=normalizeRange(from,to);
   const date=makeDay(normalized.start!);
   setSelectedDay(normalized.start!);
   setDisplayMonth(new Date(date.getFullYear(),date.getMonth(),1));
   setPeriod(normalized);
 }
 const moveWeek=(difference:number)=>goToDay(dayKey(addDays(makeDay(selectedDay),difference*7)));
 const resetToday=()=>goToDay(dayKey(new Date()));
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
   <header className="topbar"><div className="hero-decoration" aria-hidden="true"></div><div className="top-title"><button className="icon-btn mobile-toggle" onClick={()=>setMobile(true)}><Menu size={21}/></button><div><small>PERSONAL MANAGEMENT <span className="hero-star">✦</span></small><h1>{title}</h1><p className="hero-subtitle">{page==='calendar'?'Ваша неделя, задачи и важные моменты':'Все важное в одном месте — от идеи до результата'}</p></div></div>
    <div className="top-actions">{page==='calendar'&&<div className="week-nav"><button className="subtle-btn" onClick={resetToday}>Сегодня</button><button className="icon-btn" onClick={()=>moveWeek(-1)}><ChevronLeft size={19}/></button><button className="icon-btn" onClick={()=>moveWeek(1)}><ChevronRight size={19}/></button><span>{period.start&&period.end?fmtDate(period.start,{day:'numeric',month:'short'})+' — '+fmtDate(period.end,{day:'numeric',month:'short',year:'numeric'}):fmtDate(week,{day:'numeric',month:'short'})+' — '+fmtDate(addDays(week,6),{day:'numeric',month:'short',year:'numeric'})}</span></div>}
     <button className="secondary-btn hide-mobile" onClick={()=>open('events',{starts_at:selectedDay+'T10:00',ends_at:selectedDay+'T11:00'})}><CalendarDays size={16}/> Событие</button>
     <button className="primary-btn" onClick={()=>open('tasks')}><Plus size={17}/> Задача</button>
    </div>
   </header>
   <section className="overview-strip" aria-label="Краткий обзор">
    <div className="overview-card"><div className="overview-symbol"><ListTodo size={18}/></div><div><small>В работе</small><strong>{active.length} <span>задач</span></strong></div></div>
    <div className="overview-card"><div className="overview-symbol"><FolderKanban size={18}/></div><div><small>Активных проектов</small><strong>{data.projects.filter(p=>p.status==='active').length} <span>проектов</span></strong></div></div>
    <div className="overview-card"><div className="overview-symbol"><Target size={18}/></div><div><small>Цели на контроле</small><strong>{data.goals.length} <span>целей</span></strong></div></div>
   </section>
   {isDemo&&<div className="demo-banner"><span><strong>Демонстрация GitHub Pages</strong> · Данные только в этом браузере, без синхронизации. Не вводите личную или конфиденциальную информацию.</span><button onClick={()=>{if(window.confirm('Сбросить демонстрационные записи?'))api.resetDemo().then(setData).catch(e=>setError(String(e)))}}>Сбросить демо</button></div>}
   {error&&<div className="error-banner" role="alert">{error}<button onClick={()=>setError('')}><X size={16}/></button></div>}
   <main className="main">
    {loading?<div className="loading">Загружаем план…</div>:<>
    {page==='calendar'&&<div className="calendar-layout"><CalendarWeek start={week} selection={period} store={data} day={selectedDay} setDay={goToDay} edit={setEditing} slot={addSlot}/><aside className="day-panel">
     <MiniMonth viewMonth={displayMonth} selectedDay={selectedDay} week={week} selection={period} busyDays={busyDays} onPick={pickMonthDate} onRange={pickMonthRange} onChangeMonth={step=>setDisplayMonth(previous=>shiftCalendarMonth(previous,step))} onClearRange={()=>setPeriod({start:null,end:null})} onToday={resetToday}/>
     <div className="day-plan-heading"><small>ПЛАН ДНЯ</small></div><h2>{fmtDate(selectedDay,{weekday:'long',day:'numeric',month:'long'})}</h2>
     <div className="day-stat"><strong>{selectedTasks.length}</strong><span>задач на выбранный день</span></div><h3>Задачи</h3>
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
    {page==='areas'&&<section className="content"><div className="content-header"><div><h2>Направления</h2><p>Постоянные сферы вашей жизни — работа, здоровье, семья, финансы и другие.</p></div><button className="primary-btn" onClick={()=>open('areas')}><Plus size={16}/> Направление</button></div><div className="cards">{data.areas.map(a=><button key={a.id} className="entity-card" onClick={()=>setEditing({kind:'areas',record:a})}><header><span className="area-dot area-emoji">{areaEmoji(a.emoji)}</span><span className="pill">Направление</span></header><h3>{a.title}</h3><p>{data.projects.filter(p=>p.area_id===a.id).length} проектов · {data.goals.filter(g=>g.area_id===a.id).length} целей</p><div className="card-meta"><span>{active.filter(t=>t.area_id===a.id).length} открытых задач</span></div></button>)}{!data.areas.length&&<div className="empty-card">Добавьте направления жизни, чтобы организовать проекты, цели и задачи.</div>}</div></section>}
    </>}
   </main>
  </div>
  {editing&&<Drawer key={editing.kind+'-'+(editing.record?.id||'new')+JSON.stringify(editing.defaults||{})} editing={editing} store={data} close={()=>setEditing(null)} save={save} remove={remove}/>}
 </div>
}
