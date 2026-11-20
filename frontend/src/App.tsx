import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Download, FolderKanban, Inbox, ListTodo, Menu, Plus, Search, Target, Trash2, X, ArrowRight, Clock3, MoreHorizontal } from 'lucide-react';
import { api } from './api';
import {hasScheduledTime,isValidTaskDuration} from './taskValidation';
import MiniMonth from './MiniMonth';
import CalendarWeek from './CalendarWeek';
import DaySchedule from './DaySchedule';
import CalendarBacklog from './CalendarBacklog';
import TaskChecklist from './TaskChecklist';
import {ProjectMilestones,ProjectHistory} from './ProjectExtras';
import {TASK_COLORS,DEFAULT_TASK_COLOR,AREA_EMOJIS,areaEmoji,taskColor} from './taskPalette';
import {normalizeRange,shiftCalendarMonth,type DateSelection} from './miniMonthModel';
import {RECURRENCES,expandTasks,beforeDate,transferSeriesStart} from './recurrence';
import {nextTaskDay,nextEventDay} from './nextDay';
import { addDays, dateTimeLocal, dayKey, fmtDate, fmtTime, makeDay, priorityFlags, weekStart } from './date';
import type { Editing, EventItem, Goal, Kind, Page, Project, Store, Task } from './types';

const empty:Store={areas:[],projects:[],goals:[],tasks:[],events:[],occurrences:[],checklist:[],milestones:[],activity:[]};
const pages:{id:Page;title:string;icon:typeof CalendarDays}[]=[
 {id:'calendar',title:'Календарь',icon:CalendarDays},{id:'schedule',title:'Расписание дня',icon:Clock3},
 {id:'inbox',title:'Входящие',icon:Inbox},
 {id:'tasks',title:'Все задачи',icon:ListTodo},
 {id:'projects',title:'Проекты',icon:FolderKanban},{id:'goals',title:'Цели',icon:Target},
 {id:'areas',title:'Направления',icon:Target}
];
const statuses:Record<string,string>={inbox:'Входящие',planned:'Запланировано',in_progress:'В работе',waiting:'Ожидаю',done:'Выполнено',someday:'Когда-нибудь',cancelled:'Отменено'};
const projectStatuses:Record<string,string>={active:'Активен',paused:'Пауза',done:'Завершён',archived:'Архив'};
const labels:Record<Kind,string>={areas:'направление',projects:'проект',goals:'цель',tasks:'задачу',events:'событие'};
const isOpen=(t:Task)=>!['done','cancelled'].includes(t.status);
const groupName=(id:number|null,items:{id:number;title:string}[])=>items.find(x=>x.id===id)?.title||'Без привязки';
function percent(goal:Goal){const range=goal.target_value-goal.start_value;return range===0?(goal.current_value>=goal.target_value?100:0):Math.max(0,Math.min(100,Math.round(100*(goal.current_value-goal.start_value)/range)))}

type Scope='one'|'future'|'all';
type DrawerProps={editing:Editing;store:Store;close:()=>void;save:(kind:Kind,data:Record<string,unknown>,id?:number)=>Promise<void>;remove:(kind:Kind,id:number)=>Promise<void>;
 saveRecurring:(task:Task,changes:Record<string,unknown>,scope:Scope)=>Promise<void>;removeRecurring:(task:Task,scope:Scope)=>Promise<void>;
 reload:()=>Promise<void>;unschedule:(task:Task)=>Promise<void>};
function Drawer({editing,store,close,save,remove,saveRecurring,removeRecurring,reload,unschedule}:DrawerProps){
 const {kind,record,defaults}=editing;
 const [form,setForm]=useState<Record<string,unknown>>({...defaults,...record});
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const instance=kind==='tasks'&&(record as Task|undefined)?.occurrence_date?record as Task:null;
 const [scope,setScope]=useState<Scope>(instance?'one':'all');
 const scheduleRequired=kind==='tasks'&&Boolean(editing.requireSchedule||form.recurrence);
 const hasTimeInput=kind==='tasks'&&form.scheduled_at!==null&&form.scheduled_at!==undefined&&form.scheduled_at!=='';
 const missingTaskTime=kind==='tasks'&&(scheduleRequired||hasTimeInput)&&!hasScheduledTime(form.scheduled_at);
 const invalidTaskDuration=kind==='tasks'&&!isValidTaskDuration(form.duration_minutes??60);
 const missingTitle=!String(form.title??'').trim();
 const preventSave=missingTitle||missingTaskTime||invalidTaskDuration;
 const set=(key:string,value:unknown)=>setForm(v=>({...v,[key]:value}));
 const field=(key:string,label:string,placeholder='')=><label className={'form-field '+(key==='title'&&missingTitle?'required-missing':'')}><span>{label}</span><input value={String(form[key]??'')} placeholder={placeholder} aria-invalid={key==='title'&&missingTitle} onChange={e=>set(key,e.target.value)}/></label>;
 const choices=(key:string,label:string,opts:Record<string,string>)=><label className="form-field"><span>{label}</span><select value={String(form[key]??Object.keys(opts)[0])} onChange={e=>set(key,e.target.value)}>{Object.entries(opts).map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>;
 const refs=(key:string,label:string,items:{id:number;title:string}[])=><label className="form-field"><span>{label}</span><select value={String(form[key]??'')} onChange={e=>set(key,e.target.value?Number(e.target.value):null)}><option value="">Не выбрано</option>{items.map(x=><option key={x.id} value={x.id}>{x.title}</option>)}</select></label>;
 const dateField=(key:string,label:string,time=false)=>{
   const required=kind==='tasks'&&key==='scheduled_at'&&scheduleRequired;
   const invalid=kind==='tasks'&&key==='scheduled_at'&&missingTaskTime;
   return <label className={'form-field '+(invalid?'required-missing':'')}><span>{label}{required?' *':''}</span>
     <input type={time?'datetime-local':'date'} value={String(form[key]??'').slice(0,time?16:10)}
       aria-invalid={invalid} required={required} onChange={e=>set(key,e.target.value||null)}/>
     {invalid&&<small className="field-error" role="alert">Укажите корректные дату и время — это обязательно для календаря и повторений.</small>}
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
  const payload={...form};delete payload.id;delete payload.created_at;delete payload.updated_at;delete payload.occurrence_date;
  if(kind==='tasks'){
    Object.assign(payload,priorityFlags(Number(payload.priority??4)));
    payload.color=taskColor(String(payload.color??DEFAULT_TASK_COLOR));
  }
  if(kind==='areas')payload.emoji=areaEmoji(String(payload.emoji??'📁'));
  try{
    if(instance){
      const changed=Object.fromEntries(Object.entries(payload).filter(([key,value])=>value!==(record as unknown as Record<string,unknown>)[key]));
      await saveRecurring(instance,changed,scope);
    }else await save(kind,payload,record?.id);
    close();
  }catch(err){setError(err instanceof Error?err.message:String(err))}finally{setBusy(false)}
 }
 async function doRemove(){
  if(!record||!window.confirm(instance?'Удалить выбранные повторения?':'Удалить запись без возможности отмены?'))return;
  setBusy(true);
  try{
    if(instance)await removeRecurring(instance,scope);
    else await remove(kind,record.id);
    close();
  }catch(err){setError(String(err));setBusy(false)}
 }
 return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><aside className="drawer" role="dialog" aria-modal="true" aria-label="Редактирование">
  <div className="drawer-head"><div><small>{record?'РЕДАКТИРОВАНИЕ':'НОВАЯ ЗАПИСЬ'}</small><h2>{record?'Изменить':'Добавить'} {labels[kind]}</h2></div><button className="icon-btn" onClick={close} aria-label="Закрыть"><X size={20}/></button></div>
  <form onSubmit={submit} className="drawer-form">
   {field('title','Название *','Название задачи или результата')}
   {kind==='areas'&&<>
     <div className="form-field"><span>Emoji-иконка направления</span>
       <div className="emoji-choices" role="group" aria-label="Выберите emoji направления">
         {AREA_EMOJIS.map(emoji=><button type="button" key={emoji} className={'emoji-choice '+(String(form.emoji??'📁')===emoji?'chosen':'')} onClick={()=>set('emoji',emoji)} aria-label={'Иконка '+emoji} aria-pressed={String(form.emoji??'📁')===emoji}>{emoji}</button>)}
       </div>
     </div>
     {field('emoji','Или вставьте свой emoji','Например, 🌞')}
   </>}
   {kind!=='areas'&&<label className="form-field"><span>{kind==='tasks'||kind==='events'?'Заметки':'Описание'}</span><textarea rows={3} value={String(form[kind==='tasks'||kind==='events'?'notes':'description']??'')} onChange={e=>set(kind==='tasks'||kind==='events'?'notes':'description',e.target.value)}/></label>}
   {kind!=='areas'&&kind!=='projects'&&<div className="two">{refs('area_id','Направление',store.areas)}{refs('project_id','Проект',store.projects)}</div>}
   {kind==='projects'&&<>
     <div className="form-field"><span>Направления проекта (можно несколько)</span>
       <div className="project-areas-picker">
         {store.areas.map(a=>{
           const ids=Array.isArray(form.area_ids)?form.area_ids as number[]:
             form.area_id?[Number(form.area_id)]:[];
           return <label key={a.id}><input type="checkbox" checked={ids.includes(a.id)} onChange={e=>{
             const next=e.target.checked?[...ids,a.id]:ids.filter(id=>id!==a.id);
             setForm(prev=>({...prev,area_ids:next,area_id:next[0]??null}));
           }}/><span>{areaEmoji(a.emoji)} {a.title}</span></label>;
         })}
         {!store.areas.length&&<small>Направлений пока нет. Проект можно создать без них.</small>}
       </div>
     </div>
     {choices('status','Статус проекта',projectStatuses)}
     <div className="two">{dateField('start_date','Начало')}{dateField('due_date','Срок')}</div>
   </>}
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
    {instance&&<label className="form-field"><span>К каким повторениям применить изменения?</span>
      <select aria-label="Область изменения повторений" value={scope} onChange={e=>setScope(e.target.value as Scope)}>
        <option value="one">Только это повторение</option>
        <option value="future">Это и следующие</option>
        <option value="all">Вся серия</option>
      </select>
    </label>}
    {(!instance||scope!=='one')&&<>
      {choices('recurrence','Повторять',RECURRENCES)}
      {String(form.recurrence??'')!==''&&dateField('recurrence_until','Повторять до (необязательно)')}
    </>}
    <p className="form-help">{editing.requireSchedule?'Для задачи из календаря укажите дату и время.':'Можно оставить время пустым: задача сохранится в списке и не появится в календаре.'} Повторяющиеся задачи всегда требуют даты. Крайний срок и запланированное время — разные поля.</p>
   </>}
   {kind==='tasks'&&record&&<TaskChecklist taskId={record.id} items={(store.checklist||[]).filter(item=>item.task_id===record.id)} reload={reload}/>}
   {kind==='events'&&<><div className="two">{dateField('starts_at','Начало *',true)}{dateField('ends_at','Окончание *',true)}</div><label className="form-field"><span>Цвет</span><input type="color" value={String(form.color??'#f3bb28')} onChange={e=>set('color',e.target.value)}/></label></>}
   {error&&<p role="alert" className="error">{error}</p>}
   <div className="form-actions">{kind==='tasks'&&record&&(record as Task).scheduled_at&&!(record as Task).recurrence&&
     <button type="button" className="secondary-btn" disabled={busy} onClick={()=>void unschedule(record as Task).then(close).catch(err=>setError(String(err)))}>
       Убрать из календаря
     </button>}
     {record&&<button type="button" className="danger-btn" disabled={busy} onClick={doRemove}><Trash2 size={15}/> Удалить</button>}
     <button type="button" className="secondary-btn cancel-task-btn" disabled={busy} onClick={close}>Отмена</button>
     <button className="primary-btn" disabled={busy||preventSave} type="submit"><Check size={16}/>{busy?'Сохраняю…':'Сохранить'}</button>
   </div>
  </form></aside></div>
}
function TaskList({tasks,store,edit,toggle,message='Здесь пока нет задач'}:{tasks:Task[];store:Store;edit:(e:Editing)=>void;toggle:(task:Task)=>void;message?:string}){
 if(!tasks.length)return <div className="empty">{message}</div>;
 return <div className="task-list">{tasks.map(t=><div className="task-row" key={t.id}>
   <button className={'task-check '+(t.status==='done'?'done':'')} onClick={()=>toggle(t)} aria-label="Отметить выполненным">{t.status==='done'&&<Check size={13}/>}</button>
   <button className="task-main" onClick={()=>edit({kind:'tasks',record:t})}><strong className={t.status==='done'?'strike':''}>{t.title}</strong><small>{groupName(t.project_id,store.projects)}{t.due_at?' · срок '+fmtDate(t.due_at):''}{t.scheduled_at?' · '+fmtDate(t.scheduled_at)+', '+fmtTime(t.scheduled_at):' · без времени'}</small></button>
   <span className={'priority p'+t.priority}>P{t.priority}</span>
  </div>)}</div>
}

const priorityMeta=[
 ['Важно и срочно','Дела, требующие внимания в первую очередь'],
 ['Важно, не срочно','Работа над главными целями'],
 ['Срочно, не важно','Можно делегировать или упростить'],
 ['Не важно, не срочно','Остальные задачи']
] as const;
function PriorityGroups({tasks,store,edit,toggle,add}:{tasks:Task[];store:Store;
 edit:(e:Editing)=>void;toggle:(task:Task)=>void;add:(priority:number)=>void}){
 const completed=tasks.filter(task=>task.status==='done');
 const cancelled=tasks.filter(task=>task.status==='cancelled');
 return <div className="priority-groups">
  <div className="matrix task-priority-matrix">
   {priorityMeta.map(([title,hint],index)=>{
     const priority=index+1;
     const items=tasks.filter(task=>isOpen(task)&&task.priority===priority);
     return <details className={'matrix-cell collapsible-priority m'+priority}
       key={priority} open={priority<=2?true:undefined}>
       <summary className="priority-summary">
        <span className={'priority p'+priority}>P{priority}</span>
        <span className="priority-summary-text"><strong>{title}</strong><small>{hint}</small></span>
        <span className="priority-count">{items.length}</span>
        <ChevronRight className="priority-chevron" size={18}/>
       </summary>
       <div className="priority-content">
         <TaskList tasks={items} store={store} edit={edit} toggle={toggle}
           message="В этом приоритете задач нет"/>
         <button className="matrix-add" onClick={()=>add(priority)}><Plus size={15}/> Добавить задачу P{priority}</button>
       </div>
     </details>;
   })}
  </div>
  <details className="completed-group">
    <summary className="priority-summary"><Check size={19}/><span className="priority-summary-text"><strong>Выполненные</strong><small>История завершённых задач</small></span><span className="priority-count">{completed.length}</span><ChevronRight className="priority-chevron" size={18}/></summary>
    <TaskList tasks={completed} store={store} edit={edit} toggle={toggle} message="Выполненных задач пока нет"/>
  </details>
  {cancelled.length>0&&<details className="completed-group cancelled-group">
    <summary className="priority-summary"><X size={19}/><span className="priority-summary-text"><strong>Отменённые</strong></span><span className="priority-count">{cancelled.length}</span><ChevronRight className="priority-chevron" size={18}/></summary>
    <TaskList tasks={cancelled} store={store} edit={edit} toggle={toggle}/>
  </details>}
 </div>;
}
function ProjectWorkspace({project,store,reload,onBack,onEdit,onCreate,onOpenTask,onToggle,onOpenGoal,onOpenEvent}:{
 project:Project;store:Store;reload:()=>Promise<void>;onBack:()=>void;onEdit:()=>void;
 onCreate:(kind:'tasks'|'goals'|'events')=>void;onOpenTask:(task:Task)=>void;
 onToggle:(task:Task)=>void;onOpenGoal:(goal:Goal)=>void;onOpenEvent:(event:EventItem)=>void;
}){
 const tasks=store.tasks.filter(t=>t.project_id===project.id);
 const goals=store.goals.filter(g=>g.project_id===project.id);
 const events=store.events.filter(e=>e.project_id===project.id);
 const done=tasks.filter(t=>t.status==='done').length;
 const nextTask=[...tasks].filter(t=>isOpen(t)).sort((a,b)=>a.priority-b.priority||
   (a.scheduled_at||'9999').localeCompare(b.scheduled_at||'9999'))[0];
 const assigned=(project.area_ids?.length?project.area_ids:project.area_id?[project.area_id]:[])
   .map(id=>store.areas.find(a=>a.id===id)).filter((a):a is Store['areas'][number]=>Boolean(a));
 return <section className="content project-workspace">
   <div className="project-back-row">
    <button className="secondary-btn" onClick={onBack}><ChevronLeft size={17}/> Все проекты</button>
    <button className="secondary-btn" onClick={onEdit}>Редактировать проект</button>
   </div>
   <div className="project-hero">
     <div className="project-hero-title"><FolderKanban size={26}/><div><small>ПРОЕКТ · {projectStatuses[project.status]||project.status}</small><h2>{project.title}</h2></div></div>
     <p>{project.description||'Описание проекта пока не заполнено.'}</p>
     <div className="project-area-tags">{assigned.map(a=><span className="project-area-tag" key={a.id}>{areaEmoji(a.emoji)} {a.title}</span>)}{!assigned.length&&<span className="project-area-tag subdued">Без направления</span>}</div>
     <div className="project-progress"><span>{done} из {tasks.length} задач выполнено</span><strong>{tasks.length?Math.round(done/tasks.length*100):0}%</strong></div>
     <div className="progress"><div style={{width:tasks.length?done/tasks.length*100+'%':'0%'}}/></div>
     {nextTask&&<button className="project-next" onClick={()=>onOpenTask(nextTask)}><ArrowRight size={16}/> Следующий шаг: <strong>{nextTask.title}</strong></button>}
     <div className="project-dates"><span>Начало: {project.start_date?fmtDate(project.start_date):'не указано'}</span><span>Срок: {project.due_date?fmtDate(project.due_date):'не указан'}</span></div>
   </div>
   <div className="project-sections">
     <ProjectMilestones projectId={project.id} items={(store.milestones||[]).filter(item=>item.project_id===project.id)} reload={reload}/>
     <section className="project-section">
       <header><div><h3>Задачи</h3><small>{tasks.length} задач, {tasks.length-done} не выполнены</small></div><button className="secondary-btn" onClick={()=>onCreate('tasks')}><Plus size={15}/> Задача</button></header>
       <TaskList tasks={[...tasks].sort((a,b)=>a.priority-b.priority)} store={store}
         edit={e=>onOpenTask(e.record as Task)} toggle={onToggle} message="Связанных задач пока нет"/>
     </section>
     <section className="project-section">
       <header><div><h3>Цели</h3><small>{goals.length} связанных целей</small></div><button className="secondary-btn" onClick={()=>onCreate('goals')}><Plus size={15}/> Цель</button></header>
       {goals.length?goals.map(goal=><button key={goal.id} className="project-linked-row" onClick={()=>onOpenGoal(goal)}><span><strong>{goal.title}</strong><small>{goal.current_value} / {goal.target_value} {goal.unit}</small></span><span>{percent(goal)}%</span></button>):<div className="empty">Целей пока нет</div>}
     </section>
     <section className="project-section">
       <header><div><h3>События</h3><small>{events.length} связанных событий</small></div><button className="secondary-btn" onClick={()=>onCreate('events')}><Plus size={15}/> Событие</button></header>
       {events.length?events.map(e=><button key={e.id} className="project-linked-row" onClick={()=>onOpenEvent(e)}><span><strong>{e.title}</strong><small>{fmtDate(e.starts_at)} · {fmtTime(e.starts_at)}–{fmtTime(e.ends_at)}</small></span><CalendarDays size={17}/></button>):<div className="empty">Событий пока нет</div>}
     </section>
     <ProjectHistory items={(store.activity||[]).filter(item=>item.project_id===project.id)}/>
   </div>
 </section>;
}
export default function App(){
 const [data,setData]=useState<Store>(empty);const [page,setPage]=useState<Page>('calendar');
 const [selectedDay,setSelectedDay]=useState(dayKey(new Date()));
 const [displayMonth,setDisplayMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));
 const [period,setPeriod]=useState<DateSelection>({start:null,end:null});
 const week=weekStart(makeDay(selectedDay));
 const [editing,setEditing]=useState<Editing|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
 const [search,setSearch]=useState('');const [mobile,setMobile]=useState(false);
 const [selectedProjectId,setSelectedProjectId]=useState<number|null>(null);
 const [quickTitle,setQuickTitle]=useState('');
 const [quickBusy,setQuickBusy]=useState(false);
 const [backlogOpen,setBacklogOpen]=useState(true);
 const load=async()=>setData(await api.load());
 useEffect(()=>{load().catch(e=>setError(String(e))).finally(()=>setLoading(false))},[]);
 const save=async(kind:Kind,payload:Record<string,unknown>,id?:number)=>{await api.save(kind,payload,id);await load()};
 const saveRecurring=async(task:Task,changes:Record<string,unknown>,scope:Scope)=>{
   if(!task.occurrence_date){await save('tasks',changes,task.id);return;}
   if(scope==='one')await api.saveOccurrence(task.id,task.occurrence_date,changes);
   if(scope==='future'){
     const master=data.tasks.find(x=>x.id===task.id)!;
     if(task.occurrence_date===master.scheduled_at?.slice(0,10))await api.save('tasks',changes,task.id);
     else await api.splitSeries(task.id,task.occurrence_date,changes);
   }
   if(scope==='all'){
     const delta={...changes};
     if(typeof delta.scheduled_at==='string'){
       const master=data.tasks.find(x=>x.id===task.id)!;
       delta.scheduled_at=transferSeriesStart(master,task.occurrence_date,delta.scheduled_at);
     }
     await api.save('tasks',delta,task.id);
   }
   await load();
 };
 const removeRecurring=async(task:Task,scope:Scope)=>{
   if(!task.occurrence_date){await remove('tasks',task.id);return;}
   if(scope==='one')await api.saveOccurrence(task.id,task.occurrence_date,{status:'cancelled'});
   if(scope==='future')await api.save('tasks',{recurrence_until:beforeDate(task.occurrence_date)},task.id);
   if(scope==='all')await api.remove('tasks',task.id);
   await load();
 };
 const moveOrResizeTask=async(task:Task,changes:Record<string,unknown>)=>{
   try{
     if(task.occurrence_date)await saveRecurring(task,changes,'one');
     else await save('tasks',changes,task.id);
   }catch(e){setError(e instanceof Error?e.message:String(e));throw e}
 };
 const unschedule=async(t:Task)=>{
   if(t.recurrence)throw Error('Повторяющуюся задачу нельзя снять с расписания целиком: измените правило серии.');
   await save('tasks',{scheduled_at:null,status:'inbox'},t.id);
 };
 const tomorrowTask=async(t:Task)=>{
   await moveOrResizeTask(t,nextTaskDay(t));
 };
 const tomorrowEvent=async(event:EventItem)=>{
   await save('events',nextEventDay(event),event.id);
 };
 const quickCapture=async(e:FormEvent)=>{
   e.preventDefault();
   const title=quickTitle.trim();
   if(!title)return;
   setQuickBusy(true);
   try{await save('tasks',{title,status:'inbox',priority:4,important:0,urgent:0});setQuickTitle('');}
   catch(err){setError(err instanceof Error?err.message:String(err))}
   finally{setQuickBusy(false)}
 };
 const remove=async(kind:Kind,id:number)=>{await api.remove(kind,id);await load()};
 const toggle=async(t:Task)=>{
  try{
    if(t.occurrence_date)await saveRecurring(t,{status:t.status==='done'?'planned':'done'},'one');
    else await save('tasks',{status:t.status==='done'?'planned':'done'},t.id);
  }catch(e){setError(String(e))}
 };
 const open=(kind:Kind,defaults:Record<string,unknown>={})=>{
  const basic=kind==='tasks'?{priority:4,status:'inbox',duration_minutes:60,color:DEFAULT_TASK_COLOR,recurrence:'',recurrence_until:null}:
    kind==='projects'?{status:'active',area_ids:[]}:kind==='goals'?{start_value:0,target_value:1,current_value:0}:
    kind==='events'?{color:'#f3bb28'}:{emoji:'📁'};
  setEditing({kind,defaults:{...basic,...defaults},requireSchedule:kind==='tasks'&&(page==='calendar'||page==='schedule')});
 };
 const active=data.tasks.filter(isOpen);const overdue=active.filter(t=>t.due_at&&t.due_at.slice(0,10)<dayKey(new Date())).length;
 const selectedProject=data.projects.find(p=>p.id===selectedProjectId);
 const filtered=useMemo(()=>data.tasks.filter(t=>t.title.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))),[data.tasks,search]);
 const selectedTasks=expandTasks(active,data.occurrences||[],selectedDay,selectedDay);
 const topThree=[...selectedTasks].sort((a,b)=>a.priority-b.priority||
   String(a.scheduled_at).localeCompare(String(b.scheduled_at))).slice(0,3);
 const dayEvents=data.events.filter(e=>e.starts_at.startsWith(selectedDay));
 const dayMinutes=selectedTasks.reduce((sum,t)=>sum+t.duration_minutes,0)+
   dayEvents.reduce((sum,e)=>sum+Math.max(0,(new Date(e.ends_at).getTime()-new Date(e.starts_at).getTime())/60000),0);
 const lateTasks=active.filter(t=>t.due_at&&t.due_at.slice(0,10)<selectedDay&&!selectedTasks.some(x=>x.id===t.id));
 const selectedEvents=data.events.filter(t=>t.starts_at.startsWith(selectedDay));
 const title=pages.find(x=>x.id===page)?.title||'Календарь';
 const busyDays=useMemo(()=>{
   const days=new Set<string>();
   const first=dayKey(new Date(displayMonth.getFullYear(),displayMonth.getMonth(),1));
   const last=dayKey(new Date(displayMonth.getFullYear(),displayMonth.getMonth()+1,0));
   expandTasks(data.tasks.filter(isOpen),data.occurrences||[],first,last).forEach(t=>{if(t.scheduled_at)days.add(t.scheduled_at.slice(0,10))});
   data.events.forEach(e=>days.add(e.starts_at.slice(0,10)));
   return days;
 },[data,displayMonth]);
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
   <div className="nav-caption">ПЛАНИРОВАНИЕ</div>
   <nav>{pages.map(p=><button key={p.id} className={'nav-item '+(page===p.id?'selected':'')} onClick={()=>{if(p.id==='schedule')goToDay(dayKey(new Date()));setPage(p.id);setSelectedProjectId(null);setMobile(false)}}><p.icon size={18}/>{p.title}{p.id==='inbox'&&data.tasks.filter(t=>t.status==='inbox').length>0&&<em>{data.tasks.filter(t=>t.status==='inbox').length}</em>}</button>)}</nav>
   <div className="sidebar-foot"><div>Открытых задач <strong>{active.length}</strong></div><div>Просроченных <strong>{overdue}</strong></div><button className="export-link" onClick={()=>api.download().catch(e=>setError(String(e)))}><Download size={15}/> Выгрузить данные JSON</button></div>
  </aside>
  {mobile&&<button className="nav-mask" onClick={()=>setMobile(false)} aria-label="Закрыть навигацию"/>}
  <div className="workspace">
   <header className="topbar"><div className="top-title"><button className="icon-btn mobile-toggle" onClick={()=>setMobile(true)}><Menu size={21}/></button><div><h1>{title}</h1></div></div>
    <div className="top-actions">{(page==='calendar'||page==='schedule')&&<div className="week-nav"><button className="subtle-btn" onClick={resetToday}>Сегодня</button><button className="icon-btn" onClick={()=>moveWeek(-1)}><ChevronLeft size={19}/></button><button className="icon-btn" onClick={()=>moveWeek(1)}><ChevronRight size={19}/></button><span className="week-range-desktop">{period.start&&period.end?fmtDate(period.start,{day:'numeric',month:'short'})+' — '+fmtDate(period.end,{day:'numeric',month:'short',year:'numeric'}):fmtDate(week,{day:'numeric',month:'short'})+' — '+fmtDate(addDays(week,6),{day:'numeric',month:'short',year:'numeric'})}</span><span className="week-range-mobile">{period.start&&period.end?fmtDate(period.start,{day:'numeric'})+'–'+fmtDate(period.end,{day:'numeric',month:'short'}):fmtDate(week,{day:'numeric'})+'–'+fmtDate(addDays(week,6),{day:'numeric',month:'short'})}</span></div>}
     <button className="secondary-btn hide-mobile" onClick={()=>open('events',{starts_at:selectedDay+'T10:00',ends_at:selectedDay+'T11:00'})}><CalendarDays size={16}/> Событие</button>
     <button className="primary-btn" onClick={()=>open('tasks')}><Plus size={17}/> Задача</button>
    </div>
   </header>
   <section className="overview-strip" aria-label="Краткий обзор">
    <div className="overview-card"><div className="overview-symbol"><ListTodo size={18}/></div><div><small>В работе</small><strong>{active.length} <span>задач</span></strong></div></div>
    <div className="overview-card"><div className="overview-symbol"><FolderKanban size={18}/></div><div><small>Активных проектов</small><strong>{data.projects.filter(p=>p.status==='active').length} <span>проектов</span></strong></div></div>
    <div className="overview-card"><div className="overview-symbol"><Target size={18}/></div><div><small>Цели на контроле</small><strong>{data.goals.length} <span>целей</span></strong></div></div>
   </section>
   {page!=='schedule'&&<form className="quick-capture" onSubmit={quickCapture} aria-label="Быстро добавить задачу">
     <Plus size={19}/>
     <input aria-label="Быстрая запись задачи" placeholder="Запишите дело и нажмите Enter — без даты, в задачи"
       value={quickTitle} onChange={e=>setQuickTitle(e.target.value)} maxLength={250}/>
     <button type="submit" disabled={!quickTitle.trim()||quickBusy}>Добавить</button>
   </form>}
   {error&&<div className="error-banner" role="alert">{error}<button onClick={()=>setError('')}><X size={16}/></button></div>}
   <main className="main">
    {loading?<div className="loading">Загружаем план…</div>:<>
    {page==='schedule'&&<DaySchedule day={selectedDay} onDayChange={goToDay} store={data}
       onEdit={setEditing} onToggle={toggle}
       onAdd={()=>open('tasks',{scheduled_at:selectedDay+'T09:00',status:'planned'})}/>}
    {page==='calendar'&&<div className="calendar-layout"><CalendarWeek start={week} selection={period} store={data} day={selectedDay} setDay={goToDay} edit={setEditing} slot={addSlot} updateTask={moveOrResizeTask} onTomorrow={tomorrowTask} onTomorrowEvent={tomorrowEvent}
      onDropTask={async(taskId,when)=>{
        const task=data.tasks.find(t=>t.id===taskId);
        if(!task||task.scheduled_at)throw Error('Задача для переноса не найдена');
        await moveOrResizeTask(task,{scheduled_at:when,status:'planned'});
      }}/><aside className="day-panel">
     <MiniMonth viewMonth={displayMonth} selectedDay={selectedDay} week={week} selection={period} busyDays={busyDays} onPick={pickMonthDate} onRange={pickMonthRange} onChangeMonth={step=>setDisplayMonth(previous=>shiftCalendarMonth(previous,step))} onClearRange={()=>setPeriod({start:null,end:null})} onToday={resetToday}/>
     <div className="backlog-toggle"><button aria-expanded={backlogOpen} onClick={()=>setBacklogOpen(!backlogOpen)}>
       {backlogOpen?'▾':'▸'} Незапланированные <span>{active.filter(t=>!t.scheduled_at).length}</span>
     </button></div>
     {backlogOpen&&<CalendarBacklog tasks={active.filter(t=>!t.scheduled_at)}
        onSchedule={async(task,when)=>{await moveOrResizeTask(task,{scheduled_at:when,status:'planned'});}}
        onOpen={task=>setEditing({kind:'tasks',record:task})}/>}
     <div className="day-plan-heading"><small>ПЛАН ДНЯ</small></div><h2>{fmtDate(selectedDay,{weekday:'long',day:'numeric',month:'long'})}</h2>
     <div className="day-stat"><strong>{selectedTasks.length}</strong><span>задач на выбранный день</span></div>
     <section className="day-focus"><h3>Три главных дела</h3>
       {topThree.length?topThree.map((t,i)=><div className="day-focus-row" key={t.id+'-'+t.occurrence_date}>
         <span>{i+1}</span><button onClick={()=>setEditing({kind:'tasks',record:t})}>{t.title}</button>
         <small>P{t.priority}</small>
       </div>):<p className="tip">Запланируйте задачи — здесь появятся три главных по приоритету.</p>}
     </section>
     <div className="day-load"><div><strong>Загрузка дня</strong><span>{Math.round(dayMinutes/60*10)/10} из 8 ч</span></div>
       <div className="day-load-track"><span style={{width:Math.min(100,dayMinutes/480*100)+'%',background:dayMinutes>480?'#e36542':'#ff963b'}}/></div>
       {dayMinutes>480&&<small>На день назначено больше 8 часов задач и событий.</small>}
     </div>
     {lateTasks.length>0&&<details className="late-tasks"><summary>Просроченные · {lateTasks.length}</summary>
       {lateTasks.slice(0,5).map(t=><div key={t.id}><span>{t.title}</span>
         <button onClick={()=>void tomorrowTask(t).catch(e=>setError(String(e)))}>На завтра</button></div>)}
     </details>}
     <h3>Задачи</h3>
     <div className="day-plan-task-list">{selectedTasks.map(t=><div key={t.id+'-'+t.occurrence_date} className="day-plan-task">
       <button className="day-plan-title" onClick={()=>setEditing({kind:'tasks',record:t})}>{t.title}</button>
       <button title="Перенести на завтра" aria-label={'На завтра: '+t.title}
          onClick={()=>void tomorrowTask(t).catch(e=>setError(String(e)))}><ArrowRight size={14}/> Завтра</button>
     </div>)}{!selectedTasks.length&&<p className="tip">На этот день задач пока нет</p>}</div>
     {selectedEvents.length>0&&<><h3>События</h3>{selectedEvents.map(e=><button className="event-row" key={e.id} onClick={()=>setEditing({kind:'events',record:e})}><span style={{background:e.color}}/><div><strong>{e.title}</strong><small>{fmtTime(e.starts_at)}–{fmtTime(e.ends_at)}</small></div></button>)}</>}
     <button className="inline-add" onClick={()=>open('tasks',{scheduled_at:selectedDay+'T10:00',status:'planned'})}><Plus size={16}/> Добавить в этот день</button>
     <p className="tip">Нажмите на свободную ячейку календаря, чтобы назначить время задаче.</p>
    </aside></div>}
    {page==='inbox'&&<section className="content narrow"><div className="content-header"><div><h2>Входящие</h2></div><button className="primary-btn" onClick={()=>open('tasks')}><Plus size={16}/> Добавить</button></div><TaskList tasks={filtered.filter(t=>t.status==='inbox')} store={data} edit={setEditing} toggle={toggle} message="Входящие пусты"/></section>}
    {page==='tasks'&&<section className="content task-groups-page">
      <div className="content-header"><div><h2>Все задачи</h2></div>
        <button className="primary-btn" onClick={()=>open('tasks')}><Plus size={16}/> Добавить задачу</button>
      </div>
      <label className="search"><Search size={18}/><input placeholder="Поиск по названию" aria-label="Поиск задач" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      <PriorityGroups tasks={filtered} store={data} edit={setEditing} toggle={toggle}
        add={priority=>open('tasks',{priority})}/>
    </section>}
    {page==='projects'&&(selectedProject?
      <ProjectWorkspace project={selectedProject} store={data} reload={load}
        onBack={()=>setSelectedProjectId(null)}
        onEdit={()=>setEditing({kind:'projects',record:selectedProject})}
        onCreate={kind=>open(kind,{project_id:selectedProject.id,
          ...(kind==='events'?{starts_at:selectedDay+'T10:00',ends_at:selectedDay+'T11:00'}:{})})}
        onOpenTask={record=>setEditing({kind:'tasks',record})}
        onToggle={toggle}
        onOpenGoal={record=>setEditing({kind:'goals',record})}
        onOpenEvent={record=>setEditing({kind:'events',record})}/> :
      <section className="content"><div className="content-header"><div><h2>Проекты</h2></div><button className="primary-btn" onClick={()=>open('projects')}><Plus size={16}/> Проект</button></div>
        <div className="cards">{data.projects.map(p=>{
          const tasks=data.tasks.filter(t=>t.project_id===p.id);
          const done=tasks.filter(t=>t.status==='done').length;
          const linkedIds=p.area_ids?.length?p.area_ids:p.area_id?[p.area_id]:[];
          return <button className="entity-card project-entry" key={p.id}
            onClick={()=>setSelectedProjectId(p.id)}
            aria-label={'Открыть проект '+p.title}>
            <header><FolderKanban size={21}/><span className="pill">{projectStatuses[p.status]||p.status}</span></header>
            <h3>{p.title}</h3><p>{p.description||'Проект без описания'}</p>
            <div className="project-entry-areas">{linkedIds.map(id=>{
              const area=data.areas.find(a=>a.id===id);
              return area?<span key={id}>{areaEmoji(area.emoji)} {area.title}</span>:null;
            })}</div>
            <div className="card-meta"><span>{done}/{tasks.length} задач</span><span>{p.due_date?fmtDate(p.due_date):'Без срока'}</span></div>
            <div className="progress"><div style={{width:tasks.length?done/tasks.length*100+'%':'0%'}}/></div>
            <small>{data.goals.filter(g=>g.project_id===p.id).length} целей · {data.events.filter(e=>e.project_id===p.id).length} событий</small>
          </button>;
        })}
        {!data.projects.length&&<div className="empty-card">Создайте первый проект, затем привязывайте задачи, цели, события и направления.</div>}
        </div>
      </section>)}
    {page==='goals'&&<section className="content"><div className="content-header"><div><h2>Измеримые цели</h2></div><button className="primary-btn" onClick={()=>open('goals')}><Plus size={16}/> Цель</button></div><div className="cards">{data.goals.map(g=><button key={g.id} className="entity-card" onClick={()=>setEditing({kind:'goals',record:g})}><header><Target size={21}/><span className="pill">{percent(g)}%</span></header><h3>{g.title}</h3><p>{groupName(g.project_id,data.projects)}</p><div className="goal-value">{g.current_value} <small>/ {g.target_value} {g.unit}</small></div><div className="progress"><div style={{width:percent(g)+'%'}}/></div><div className="card-meta"><span>{g.period_start?fmtDate(g.period_start):'Без начала'}</span><span>{g.period_end?fmtDate(g.period_end):'Без конца'}</span></div></button>)}{!data.goals.length&&<div className="empty-card">Создайте первую измеримую цель: показатель, период и ожидаемый результат.</div>}</div></section>}
    {page==='areas'&&<section className="content"><div className="content-header"><div><h2>Направления</h2></div><button className="primary-btn" onClick={()=>open('areas')}><Plus size={16}/> Направление</button></div><div className="cards">{data.areas.map(a=><button key={a.id} className="entity-card" onClick={()=>setEditing({kind:'areas',record:a})}><header><span className="area-dot area-emoji">{areaEmoji(a.emoji)}</span></header><h3>{a.title}</h3><p>{data.projects.filter(p=>p.area_ids?.includes(a.id)||p.area_id===a.id).length} проектов · {data.goals.filter(g=>g.area_id===a.id).length} целей</p><div className="card-meta"><span>{active.filter(t=>t.area_id===a.id).length} открытых задач</span></div></button>)}{!data.areas.length&&<div className="empty-card">Добавьте направления жизни, чтобы организовать проекты, цели и задачи.</div>}</div></section>}
    </>}
   </main>
  </div>
  <nav className="mobile-bottom-nav" aria-label="Мобильная навигация">
     {[
       {id:'calendar' as Page,title:'Календарь',icon:CalendarDays},
       {id:'schedule' as Page,title:'День',icon:Clock3},
       {id:'tasks' as Page,title:'Задачи',icon:ListTodo},
       {id:'inbox' as Page,title:'Входящие',icon:Inbox}
     ].map(link=><button key={link.id} aria-current={page===link.id?'page':undefined}
       className={page===link.id?'active':''}
       onClick={()=>{if(link.id==='schedule')goToDay(dayKey(new Date()));setPage(link.id);setSelectedProjectId(null);setMobile(false);}}>
       <link.icon size={21}/><span>{link.title}</span>
     </button>)}
     <button aria-label="Другие разделы" onClick={()=>setMobile(true)}><MoreHorizontal size={21}/><span>Ещё</span></button>
  </nav>
  {editing&&<Drawer key={editing.kind+'-'+(editing.record?.id||'new')+'-'+((editing.record as Task|undefined)?.occurrence_date||'')+JSON.stringify(editing.defaults||{})} editing={editing} store={data} close={()=>setEditing(null)} save={save} remove={remove} saveRecurring={saveRecurring} removeRecurring={removeRecurring} reload={load} unschedule={unschedule}/>} 
 </div>
}
