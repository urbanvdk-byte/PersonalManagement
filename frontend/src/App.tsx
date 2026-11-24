import { useEffect, useMemo, useState, type FormEvent, type CSSProperties } from 'react';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Download, Wifi, WifiOff, RefreshCw, AlertTriangle, FolderKanban, Inbox, ListTodo, Menu, Plus, Search, Target, Trash2, X, ArrowRight, Clock3, MoreHorizontal } from 'lucide-react';
import { api,isDemo } from './api';
import type {OfflineStatus} from './offline';
import {hasScheduledTime,isValidTaskDuration} from './taskValidation';
import MiniMonth from './MiniMonth';
import CalendarWeek from './CalendarWeek';
import DaySchedule from './DaySchedule';
import CalendarBacklog from './CalendarBacklog';
import TaskChecklist from './TaskChecklist';
import {ProjectHistory} from './ProjectExtras';
import {TASK_COLORS,DEFAULT_TASK_COLOR,AREA_EMOJIS,areaEmoji,taskColor} from './taskPalette';
import {normalizeRange,shiftCalendarMonth,type DateSelection} from './miniMonthModel';
import {RECURRENCES,expandTasks,beforeDate,transferSeriesStart} from './recurrence';
import {nextTaskDay} from './nextDay';
import { addDays, dateTimeLocal, dayKey, fmtDate, fmtTime, makeDay, priorityFlags, weekStart } from './date';
import type { Editing, Goal, Kind, Page, Project, Store, Task } from './types';

const empty:Store={areas:[],projects:[],goals:[],tasks:[],occurrences:[],checklist:[],milestones:[],activity:[]};
const pages:{id:Page;title:string;icon:typeof CalendarDays}[]=[
 {id:'calendar',title:'Календарь',icon:CalendarDays},{id:'schedule',title:'Расписание дня',icon:Clock3},
 {id:'inbox',title:'Входящие',icon:Inbox},
 {id:'tasks',title:'Все задачи',icon:ListTodo},
 {id:'projects',title:'Проекты',icon:FolderKanban},{id:'goals',title:'Цели',icon:Target},
 {id:'areas',title:'Направления',icon:Target}
];
const statuses:Record<string,string>={inbox:'Входящие',planned:'Запланировано',in_progress:'В работе',waiting:'Ожидаю',done:'Выполнено',someday:'Когда-нибудь',cancelled:'Отменено'};
const projectStatuses:Record<string,string>={active:'Активен',paused:'Пауза',done:'Завершён',archived:'Архив'};
const labels:Record<Kind,string>={areas:'направление',projects:'проект',goals:'цель',tasks:'задачу'};
const isOpen=(t:Task)=>!['done','cancelled'].includes(t.status);
const groupName=(id:number|null,items:{id:number;title:string}[])=>items.find(x=>x.id===id)?.title||'Без привязки';
function percent(goal:Goal){if(goal.done)return 100;if(goal.measurable===0)return 0;const range=goal.target_value-goal.start_value;return range===0?(goal.current_value>=goal.target_value?100:0):Math.max(0,Math.min(100,Math.round(100*(goal.current_value-goal.start_value)/range)))}

/** Prefer a goal's assigned direction; fall back to its project's directions.
 * Projects can have several directions, so display each without guessing.
 */
function goalReached(goal:Goal){return Boolean(goal.done)||(goal.measurable!==0&&percent(goal)>=100)}
function goalDirections(goal:Goal,store:Store):Store['areas']{
 const assigned=store.areas.find(a=>a.id===goal.area_id);
 if(assigned)return [assigned];
 const project=store.projects.find(p=>p.id===goal.project_id);
 if(!project)return [];
 const ids=project.area_ids?.length?project.area_ids:project.area_id?[project.area_id]:[];
 return [...new Set(ids)].map(id=>store.areas.find(a=>a.id===id))
   .filter((area):area is Store['areas'][number]=>Boolean(area));
}

type Scope='one'|'future'|'all';
type DrawerProps={editing:Editing;store:Store;close:()=>void;save:(kind:Kind,data:Record<string,unknown>,id?:number,revision?:number)=>Promise<void>;remove:(kind:Kind,id:number,revision?:number)=>Promise<void>;
 saveRecurring:(task:Task,changes:Record<string,unknown>,scope:Scope)=>Promise<void>;removeRecurring:(task:Task,scope:Scope)=>Promise<void>;
 reload:()=>Promise<void>;unschedule:(task:Task)=>Promise<void>};
function Drawer({editing,store,close,save,remove,saveRecurring,removeRecurring,reload,unschedule}:DrawerProps){
 const {kind,record,defaults}=editing;
 const taskId=kind==='tasks'&&record?(store.tasks.some(t=>t.id===record.id)?record.id:store.local_id_map?.[record.id]??record.id):null;
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
 const set=(key:string,value:unknown)=>setForm(v=>{
   const next={...v,[key]:value};
   if(key==='project_id'&&(kind==='tasks'||kind==='goals')){
     const project=store.projects.find(p=>p.id===value);
     if(project&&!next.area_id)next.area_id=project.area_id;
     if(kind==='tasks'&&next.goal_id){
       const goal=store.goals.find(g=>g.id===next.goal_id);
       if(goal?.project_id!=null&&goal.project_id!==value)next.goal_id=null;
     }
   }
   if(key==='goal_id'&&kind==='tasks'){
     const goal=store.goals.find(g=>g.id===value);
     if(goal?.project_id!=null)next.project_id=goal.project_id;
     if(goal&&!next.area_id)next.area_id=goal.area_id??store.projects.find(p=>p.id===goal.project_id)?.area_id??null;
   }
   return next;
 });
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
  const payload={...form};delete payload.id;delete payload.created_at;delete payload.updated_at;delete payload.occurrence_date;delete payload.revision;
  if(kind==='goals'&&payload.measurable===0){delete payload.start_value;delete payload.target_value;delete payload.current_value;delete payload.unit;}
  if(kind==='tasks'){
    Object.assign(payload,priorityFlags(Number(payload.priority??4)));
    payload.color=taskColor(String(payload.color??DEFAULT_TASK_COLOR));
  }
  if(kind==='areas')payload.emoji=areaEmoji(String(payload.emoji??'📁'));
  try{
    if(instance){
      const changed=Object.fromEntries(Object.entries(payload).filter(([key,value])=>value!==(record as unknown as Record<string,unknown>)[key]));
      await saveRecurring(instance,changed,scope);
    }else await save(kind,payload,record?.id,record?.revision);
    close();
  }catch(err){setError(err instanceof Error?err.message:String(err))}finally{setBusy(false)}
 }
 async function doRemove(){
  if(!record||!window.confirm(instance?'Удалить выбранные повторения?':'Удалить запись без возможности отмены?'))return;
  setBusy(true);
  try{
    if(instance)await removeRecurring(instance,scope);
    else await remove(kind,record.id,record.revision);
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
   {kind!=='areas'&&<label className="form-field"><span>{kind==='tasks'?'Заметки':'Описание'}</span><textarea rows={3} value={String(form[kind==='tasks'?'notes':'description']??'')} onChange={e=>set(kind==='tasks'?'notes':'description',e.target.value)}/></label>}
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
   {kind==='goals'&&<><div className="two">{dateField('period_start','Начало периода')}{dateField('period_end','Срок цели')}</div>
    <label className="form-field"><span><input type="checkbox" checked={form.measurable!==0} onChange={e=>set('measurable',e.target.checked?1:0)}/> Количественные показатели</span></label>
    {form.measurable!==0&&<><div className="two">{number('start_value','Исходное')}{number('target_value','Цель',1)}</div><div className="two">{number('current_value','Достигнуто')}{field('unit','Единица','шт., км, ₽')}</div></>}
    <label className="form-field"><span><input type="checkbox" checked={Boolean(form.done)} onChange={e=>set('done',e.target.checked?1:0)}/> Цель достигнута</span></label></>}
   {kind==='tasks'&&<>
    {refs('goal_id','Цель',store.goals.filter(g=>!form.project_id||g.project_id===form.project_id||g.id===form.goal_id))}
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
   {taskId!==null&&<TaskChecklist taskId={taskId} items={(store.checklist||[]).filter(item=>item.task_id===taskId)} reload={reload}/>}
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
   <button className="task-main" onClick={()=>edit({kind:'tasks',record:t})}><strong className={t.status==='done'?'strike':''}>{t.title}</strong><small>{store.goals.find(g=>g.id===t.goal_id)?.title||store.areas.find(a=>a.id===t.area_id)?.title||''}{t.due_at?' · срок '+fmtDate(t.due_at):''}{t.scheduled_at?' · '+fmtDate(t.scheduled_at)+', '+fmtTime(t.scheduled_at):' · без времени'}</small></button>
   <span className={'priority p'+t.priority}>P{t.priority}</span>
  </div>)}</div>
}

const priorityMeta=[
 ['Важно и срочно','Дела, требующие внимания в первую очередь'],
 ['Важно, не срочно','Работа над главными целями'],
 ['Срочно, не важно','Можно делегировать или упростить'],
 ['Не важно, не срочно','Остальные задачи']
] as const;
function GroupedTaskList({tasks,store,edit,toggle,message='Здесь пока нет задач'}:Parameters<typeof TaskList>[0]){
 if(!tasks.length)return <div className="empty">{message}</div>;
 const groups=new Map<number|null,Task[]>();
 for(const task of tasks){
   const projectId=task.project_id??store.goals.find(g=>g.id===task.goal_id)?.project_id??null;
   groups.set(projectId,[...(groups.get(projectId)||[]),task]);
 }
 return <div className="grouped-task-list">{Array.from(groups.entries()).map(([id,items])=>{
   const project=store.projects.find(p=>p.id===id);
   const directions=(project?.area_ids?.length?project.area_ids:project?.area_id?[project.area_id]:[]).map(a=>store.areas.find(x=>x.id===a)).filter(Boolean);
   const goalIds=Array.from(new Set(items.map(t=>t.goal_id??null)));
   return <details key={id??'none'} className="task-project-group" open>
     <summary><ChevronRight size={14}/><span>{directions.map(a=>areaEmoji(a?.emoji)).join(' ')||'📁'}</span><strong>{project?.title||'Без проекта'}</strong><small>{items.length}</small></summary>
     {goalIds.map(goalId=>{const goal=store.goals.find(g=>g.id===goalId);return <div key={goalId??'none'} className="task-goal-group">
       {goal&&<button type="button" className="task-goal-heading" onClick={()=>edit({kind:'goals',record:goal})}><Target size={13}/>{goal.title}</button>}
       <TaskList tasks={items.filter(t=>(t.goal_id??null)===goalId)} store={store} edit={edit} toggle={toggle}/>
     </div>})}
   </details>
 })}</div>;
}

function PriorityGroups({tasks,store,edit,toggle,add}:{tasks:Task[];store:Store;
 edit:(e:Editing)=>void;toggle:(task:Task)=>void;add:(priority:number)=>void}){
 const completed=tasks.filter(task=>task.status==='done');
 const cancelled=tasks.filter(task=>task.status==='cancelled');
 const unassignedGoals=store.goals.filter(goal=>!store.tasks.some(t=>t.goal_id===goal.id));
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
         <GroupedTaskList tasks={items} store={store} edit={edit} toggle={toggle}
           message="В этом приоритете задач нет"/>
         <button className="matrix-add" onClick={()=>add(priority)}><Plus size={15}/> Добавить задачу P{priority}</button>
       </div>
     </details>;
   })}
  </div>
  <details className="completed-group">
    <summary className="priority-summary"><Check size={19}/><span className="priority-summary-text"><strong>Выполненные</strong><small>История завершённых задач</small></span><span className="priority-count">{completed.length}</span><ChevronRight className="priority-chevron" size={18}/></summary>
    <GroupedTaskList tasks={completed} store={store} edit={edit} toggle={toggle} message="Выполненных задач пока нет"/>
  </details>
  {unassignedGoals.length>0&&<details className="completed-group goals-without-tasks" open>
    <summary className="priority-summary"><Target size={19}/><span className="priority-summary-text"><strong>Цели без задач</strong><small>Цели, для которых ещё не назначены задачи</small></span><span className="priority-count">{unassignedGoals.length}</span><ChevronRight className="priority-chevron" size={18}/></summary>
    {unassignedGoals.map(goal=><button type="button" key={goal.id} className="project-linked-row" onClick={()=>edit({kind:'goals',record:goal})}><span><strong>{goalDirections(goal,store).map(a=>areaEmoji(a.emoji)).join(' ')} {goal.title}</strong><small>{store.projects.find(p=>p.id===goal.project_id)?.title||'Без проекта'}{goal.period_end?' · До '+fmtDate(goal.period_end):''}</small></span><span>{goalReached(goal)?'Достигнута':goal.measurable!==0?percent(goal)+'%':'В работе'}</span></button>)}
  </details>}
  {cancelled.length>0&&<details className="completed-group cancelled-group">
    <summary className="priority-summary"><X size={19}/><span className="priority-summary-text"><strong>Отменённые</strong></span><span className="priority-count">{cancelled.length}</span><ChevronRight className="priority-chevron" size={18}/></summary>
    <GroupedTaskList tasks={cancelled} store={store} edit={edit} toggle={toggle}/>
  </details>}
 </div>;
}
function ProjectWorkspace({project,store,reload,onBack,onEdit,onCreate,onOpenTask,onToggle,onOpenGoal}:{
 project:Project;store:Store;reload:()=>Promise<void>;onBack:()=>void;onEdit:()=>void;
 onCreate:(kind:'tasks'|'goals')=>void;onOpenTask:(task:Task)=>void;
 onToggle:(task:Task)=>void;onOpenGoal:(goal:Goal)=>void;
}){
 const tasks=store.tasks.filter(t=>t.project_id===project.id);
 const goals=store.goals.filter(g=>g.project_id===project.id);
 const [goalTitle,setGoalTitle]=useState('');
 const [goalDue,setGoalDue]=useState('');
 const [goalBusy,setGoalBusy]=useState(false);
 const [goalError,setGoalError]=useState('');
 const goalAction=async(action:()=>Promise<void>)=>{
   setGoalBusy(true);setGoalError('');
   try{await action();await reload();}catch(e){setGoalError(String(e));}finally{setGoalBusy(false);}
 };
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
     <section className="project-section">
       <header><div><h3>Задачи</h3><small>{tasks.length} задач, {tasks.length-done} не выполнены</small></div><button className="secondary-btn" onClick={()=>onCreate('tasks')}><Plus size={15}/> Задача</button></header>
       <TaskList tasks={[...tasks].sort((a,b)=>a.priority-b.priority)} store={store}
         edit={e=>onOpenTask(e.record as Task)} toggle={onToggle} message="Связанных задач пока нет"/>
     </section>
     <section className="project-section">
       <header><div><h3>Цели</h3><small>{goals.filter(goalReached).length} из {goals.length} достигнуты</small></div><button className="secondary-btn" onClick={()=>onCreate('goals')}><Plus size={15}/> Цель</button></header>
       {goals.length?goals.map(goal=><div key={goal.id} className="project-goal-row">
         <input type="checkbox" aria-label={'Цель достигнута: '+goal.title} checked={Boolean(goal.done)} disabled={goalBusy} onChange={e=>void goalAction(()=>api.save('goals',{done:e.target.checked?1:0},goal.id,goal.revision))}/>
         <button className="project-linked-row" onClick={()=>onOpenGoal(goal)}><span><strong className={goal.done?'strike':''}>{goal.title}</strong><small>{goal.period_end?'До '+fmtDate(goal.period_end):'Без срока'}{goal.measurable!==0?' · '+goal.current_value+' / '+goal.target_value+' '+goal.unit:''}</small></span>{goal.measurable!==0&&<span>{percent(goal)}%</span>}</button>
       </div>):<div className="empty">Целей пока нет</div>}
       <form className="milestone-add" onSubmit={e=>{e.preventDefault();if(!goalTitle.trim()||!goalDue)return;void goalAction(async()=>{await api.save('goals',{title:goalTitle.trim(),project_id:project.id,area_id:project.area_id,period_end:goalDue,measurable:0,done:0});setGoalTitle('');setGoalDue('');});}}>
         <input aria-label="Название новой цели" placeholder="Цель" value={goalTitle} onChange={e=>setGoalTitle(e.target.value)}/>
         <input type="date" aria-label="Срок цели" value={goalDue} onChange={e=>setGoalDue(e.target.value)} required/>
         <button type="submit" disabled={goalBusy||!goalTitle.trim()||!goalDue}><Plus size={14}/> Добавить</button>
       </form>{goalError&&<small role="alert" className="field-error">{goalError}</small>}
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
 const [backlogWidth,setBacklogWidth]=useState(()=>{
   try{
     const value=Number(localStorage.getItem('pm.calendar.backlog.width'));
     return value>=260&&value<=640?value:340;
   }catch{return 340}
 });
 useEffect(()=>{try{localStorage.setItem('pm.calendar.backlog.width',String(backlogWidth))}catch{}},[backlogWidth]);
 const resizeBacklog=(grip:HTMLElement,width:number)=>{
   const layout=grip.parentElement;
   if(!layout)return;
   const max=Math.max(260,Math.min(640,Math.floor(layout.clientWidth*.48)));
   setBacklogWidth(Math.max(260,Math.min(max,Math.round(width))));
 };
 const [offlineStatus,setOfflineStatus]=useState<OfflineStatus>({mode:'ready',pending:0,message:'',lastSync:null});
 const load=async()=>setData(await api.load());
 useEffect(()=>{load().catch(e=>setError(String(e))).finally(()=>setLoading(false))},[]);
 useEffect(()=>{
   if(!isDemo)return;
   const sync=(event:StorageEvent)=>{
     if(event.key==='personalmanagement:pages-demo:v1')void load().catch(e=>setError(String(e)));
   };
   window.addEventListener('storage',sync);
   return ()=>window.removeEventListener('storage',sync);
 },[]);
 useEffect(()=>{
  if(isDemo)return;
  const status=(event:Event)=>setOfflineStatus((event as CustomEvent<OfflineStatus>).detail);
  const refresh=()=>void load().catch(e=>setError(String(e)));
  window.addEventListener('personalmanagement:offline-status',status);
  window.addEventListener('personalmanagement:offline-change',refresh);
  void api.offline.status().then(setOfflineStatus).catch(e=>setError(String(e)));
  return ()=>{
   window.removeEventListener('personalmanagement:offline-status',status);
   window.removeEventListener('personalmanagement:offline-change',refresh);
  };
 },[]);
 const save=async(kind:Kind,payload:Record<string,unknown>,id?:number,revision?:number)=>{await api.save(kind,payload,id,revision);await load()};
 const saveRecurring=async(task:Task,changes:Record<string,unknown>,scope:Scope)=>{
   if(!task.occurrence_date){await save('tasks',changes,task.id,task.revision);return;}
   if(scope==='one')await api.saveOccurrence(task.id,task.occurrence_date,changes,task.revision);
   if(scope==='future'){
     const master=data.tasks.find(x=>x.id===task.id)!;
     if(task.occurrence_date===master.scheduled_at?.slice(0,10))await api.save('tasks',changes,task.id,task.revision);
     else await api.splitSeries(task.id,task.occurrence_date,changes,task.revision);
   }
   if(scope==='all'){
     const delta={...changes};
     if(typeof delta.scheduled_at==='string'){
       const master=data.tasks.find(x=>x.id===task.id)!;
       delta.scheduled_at=transferSeriesStart(master,task.occurrence_date,delta.scheduled_at);
     }
     await api.save('tasks',delta,task.id,task.revision);
   }
   await load();
 };
 const removeRecurring=async(task:Task,scope:Scope)=>{
   if(!task.occurrence_date){await remove('tasks',task.id,task.revision);return;}
   if(scope==='one')await api.saveOccurrence(task.id,task.occurrence_date,{status:'cancelled'},task.revision);
   if(scope==='future')await api.save('tasks',{recurrence_until:beforeDate(task.occurrence_date)},task.id,task.revision);
   if(scope==='all')await api.remove('tasks',task.id,task.revision);
   await load();
 };
 const moveOrResizeTask=async(task:Task,changes:Record<string,unknown>)=>{
   try{
     if(task.occurrence_date)await saveRecurring(task,changes,'one');
     else await save('tasks',changes,task.id,task.revision);
   }catch(e){setError(e instanceof Error?e.message:String(e));throw e}
 };
 const unschedule=async(t:Task)=>{
   if(t.recurrence)throw Error('Повторяющуюся задачу нельзя снять с расписания целиком: измените правило серии.');
   await save('tasks',{scheduled_at:null,status:'inbox'},t.id,t.revision);
 };
 const tomorrowTask=async(t:Task)=>{
   await moveOrResizeTask(t,nextTaskDay(t));
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
 const remove=async(kind:Kind,id:number,revision?:number)=>{await api.remove(kind,id,revision);await load()};
 const toggle=async(t:Task)=>{
  try{
    if(t.occurrence_date)await saveRecurring(t,{status:t.status==='done'?'planned':'done'},'one');
    else await save('tasks',{status:t.status==='done'?'planned':'done'},t.id,t.revision);
  }catch(e){setError(String(e))}
 };
 const open=(kind:Kind,defaults:Record<string,unknown>={})=>{
  const basic=kind==='tasks'?{priority:4,status:'inbox',duration_minutes:60,color:DEFAULT_TASK_COLOR,recurrence:'',recurrence_until:null}:
    kind==='projects'?{status:'active',area_ids:[]}:kind==='goals'?{start_value:0,target_value:1,current_value:0}:
    {emoji:'📁'};
  setEditing({kind,defaults:{...basic,...defaults},requireSchedule:kind==='tasks'&&(page==='calendar'||page==='schedule')});
 };
 const active=data.tasks.filter(isOpen);const overdue=active.filter(t=>t.due_at&&t.due_at.slice(0,10)<dayKey(new Date())).length;
 const selectedProject=data.projects.find(p=>p.id===selectedProjectId);
 const filtered=useMemo(()=>data.tasks.filter(t=>t.title.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru'))),[data.tasks,search]);
 const title=pages.find(x=>x.id===page)?.title||'Календарь';
 const busyDays=useMemo(()=>{
   const days=new Set<string>();
   const first=dayKey(new Date(displayMonth.getFullYear(),displayMonth.getMonth(),1));
   const last=dayKey(new Date(displayMonth.getFullYear(),displayMonth.getMonth()+1,0));
   expandTasks(data.tasks.filter(isOpen),data.occurrences||[],first,last).forEach(t=>{if(t.scheduled_at)days.add(t.scheduled_at.slice(0,10))});
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
   <div className="pm-sidebar-logo"><img src={import.meta.env.BASE_URL+'brand-icon-v2-192.png'} alt="PersonalManagement" width="36" height="36"/></div>
   <div className="nav-caption">ПЛАНИРОВАНИЕ</div>
   <nav>{pages.map(p=><button key={p.id} className={'nav-item '+(page===p.id?'selected':'')} onClick={()=>{if(p.id==='schedule')goToDay(dayKey(new Date()));setPage(p.id);setSelectedProjectId(null);setMobile(false)}}><p.icon size={18}/>{p.title}{p.id==='inbox'&&data.tasks.filter(t=>t.status==='inbox').length>0&&<em>{data.tasks.filter(t=>t.status==='inbox').length}</em>}</button>)}</nav>
   <div className="sidebar-foot"><div>Открытых задач <strong>{active.length}</strong></div><div>Просроченных <strong>{overdue}</strong></div><button className="export-link" onClick={()=>api.download().catch(e=>setError(String(e)))}><Download size={15}/> Выгрузить данные JSON</button></div>
  </aside>
  {mobile&&<button className="nav-mask" onClick={()=>setMobile(false)} aria-label="Закрыть навигацию"/>}
  <div className="workspace">
   <header className="topbar"><div className="top-title"><button className="icon-btn mobile-toggle" onClick={()=>setMobile(true)}><Menu size={21}/></button><div><h1>{title}</h1></div></div>
    <div className="top-actions">{(page==='calendar'||page==='schedule')&&<div className="week-nav"><button className="subtle-btn" onClick={resetToday}>Сегодня</button><button className="icon-btn" onClick={()=>moveWeek(-1)}><ChevronLeft size={19}/></button><button className="icon-btn" onClick={()=>moveWeek(1)}><ChevronRight size={19}/></button><span className="week-range-desktop">{period.start&&period.end?fmtDate(period.start,{day:'numeric',month:'short'})+' — '+fmtDate(period.end,{day:'numeric',month:'short',year:'numeric'}):fmtDate(week,{day:'numeric',month:'short'})+' — '+fmtDate(addDays(week,6),{day:'numeric',month:'short',year:'numeric'})}</span><span className="week-range-mobile">{period.start&&period.end?fmtDate(period.start,{day:'numeric'})+'–'+fmtDate(period.end,{day:'numeric',month:'short'}):fmtDate(week,{day:'numeric'})+'–'+fmtDate(addDays(week,6),{day:'numeric',month:'short'})}</span></div>}
     <button className="primary-btn" onClick={()=>open('tasks')}><Plus size={17}/> Задача</button>
    </div>
   </header>
   {!isDemo&&<section className={'offline-notice offline-'+offlineStatus.mode} role="status" aria-label="Состояние синхронизации">
    <div className="offline-notice-main">
     {offlineStatus.mode==='offline'?<WifiOff size={17}/>:
      offlineStatus.mode==='syncing'?<RefreshCw size={17}/>:
      offlineStatus.mode==='ready'?<Wifi size={17}/>:<AlertTriangle size={17}/>}
     <div><strong>{offlineStatus.mode==='offline'?'Без интернета':
      offlineStatus.mode==='syncing'?'Синхронизация':
      offlineStatus.mode==='conflict'?'Конфликт изменений':
      offlineStatus.mode==='auth'?'Проверьте авторизацию':
      offlineStatus.mode==='error'?'Ошибка синхронизации':'Данные синхронизированы'}</strong>
      <small>{offlineStatus.pending?offlineStatus.pending+' изменений ожидают отправки':
       offlineStatus.mode==='offline'?'Работаем с копией на устройстве':'Все изменения на сервере'}</small>
      {offlineStatus.message&&offlineStatus.mode!=='ready'&&<small>{offlineStatus.message}</small>}
     </div>
    </div>
    <div className="offline-notice-actions">
     {offlineStatus.mode==='conflict'&&<button type="button" onClick={()=>
      void api.offline.keepLocalConflict().catch(e=>setError(String(e)))}>Оставить мои изменения</button>}
     {(offlineStatus.mode==='conflict'||offlineStatus.mode==='error')&&<button type="button" onClick={()=>{
      if(window.confirm('Отменить ВСЕ изменения, не переданные на сервер? Сначала выгрузите локальные данные JSON.'))
       void api.offline.discardAllPending().catch(e=>setError(String(e)));
     }}>Отменить локальные изменения</button>}
     {offlineStatus.pending>0&&<button type="button" disabled={offlineStatus.mode==='offline'||offlineStatus.mode==='syncing'}
      onClick={()=>void api.offline.syncNow().catch(e=>setError(String(e)))}>Повторить синхронизацию</button>}
    </div>
   </section>}
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
    {page==='calendar'&&<div className="calendar-layout" style={{'--backlog-width':backlogWidth+'px'} as CSSProperties}><CalendarWeek start={week} selection={period} store={data} day={selectedDay} setDay={goToDay} edit={setEditing} slot={addSlot} updateTask={moveOrResizeTask} onTomorrow={tomorrowTask}
      onDropTask={async(taskId,when)=>{
        const task=data.tasks.find(t=>t.id===taskId);
        if(!task||task.scheduled_at)throw Error('Задача для переноса не найдена');
        await moveOrResizeTask(task,{scheduled_at:when,status:'planned'});
      }}/>
     <div className="backlog-resizer" role="separator" tabIndex={0} aria-orientation="vertical"
       aria-label="Ширина панели незапланированных задач" aria-controls="calendar-backlog-panel"
       aria-valuemin={260} aria-valuemax={640} aria-valuenow={backlogWidth}
       title="Потяните влево или вправо; двойной щелчок — исходная ширина"
       onPointerDown={e=>{if(e.button===0){e.preventDefault();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId)}}}
       onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId)){const bounds=e.currentTarget.parentElement!.getBoundingClientRect();resizeBacklog(e.currentTarget,bounds.right-e.clientX-5)}}}
       onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId)}}
       onDoubleClick={()=>setBacklogWidth(340)}
       onKeyDown={e=>{
         if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
         e.preventDefault();
         const width=e.currentTarget.parentElement?.querySelector('.day-panel')?.getBoundingClientRect().width??backlogWidth;
         resizeBacklog(e.currentTarget,e.key==='Home'?260:e.key==='End'?640:width+(e.key==='ArrowLeft'?20:-20));
       }}/>
     <aside className="day-panel" id="calendar-backlog-panel">
     <MiniMonth viewMonth={displayMonth} selectedDay={selectedDay} week={week} selection={period} busyDays={busyDays} onPick={pickMonthDate} onRange={pickMonthRange} onChangeMonth={step=>setDisplayMonth(previous=>shiftCalendarMonth(previous,step))} onClearRange={()=>setPeriod({start:null,end:null})} onToday={resetToday}/>
     <div className="backlog-toggle"><button aria-expanded={backlogOpen} onClick={()=>setBacklogOpen(!backlogOpen)}>
       {backlogOpen?'▾':'▸'} Незапланированные <span>{active.filter(t=>!t.scheduled_at).length}</span>
     </button></div>
     {backlogOpen&&<CalendarBacklog tasks={active.filter(t=>!t.scheduled_at)}
        onSchedule={async(task,when)=>{await moveOrResizeTask(task,{scheduled_at:when,status:'planned'});}}
        onOpen={task=>setEditing({kind:'tasks',record:task})}/>}
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
        onCreate={kind=>open(kind,{project_id:selectedProject.id,area_id:selectedProject.area_id})}
        onOpenTask={record=>setEditing({kind:'tasks',record})}
        onToggle={toggle}
        onOpenGoal={record=>setEditing({kind:'goals',record})}/> :
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
            <small>{data.goals.filter(g=>g.project_id===p.id).length} целей</small>
          </button>;
        })}
        {!data.projects.length&&<div className="empty-card">Создайте первый проект, затем привязывайте задачи, цели и направления.</div>}
        </div>
      </section>)}
    {page==='goals'&&<section className="content"><div className="content-header"><div><h2>Цели</h2></div><button className="primary-btn" onClick={()=>open('goals')}><Plus size={16}/> Цель</button></div><div className="cards">{data.goals.map(g=><button key={g.id} data-goal-id={g.id} className="entity-card goal-card" onClick={()=>setEditing({kind:'goals',record:g})}><header><Target size={21}/><span className="pill">{g.measurable===0?(g.done?'Достигнута':'В работе'):percent(g)+'%'}</span></header><div className="goal-title">{goalDirections(g,data).length>0&&<span className="goal-direction-icons">{goalDirections(g,data).map(a=><span key={a.id} className="goal-direction-emoji" role="img" aria-label={'Направление: '+a.title} title={'Направление: '+a.title}>{areaEmoji(a.emoji)}</span>)}</span>}<h3>{g.title}</h3></div><p>{groupName(g.project_id,data.projects)}</p>{g.measurable!==0&&<><div className="goal-value">{g.current_value} <small>/ {g.target_value} {g.unit}</small></div><div className="progress"><div style={{width:percent(g)+'%'}}/></div></>}<div className="card-meta"><span>{g.period_start?fmtDate(g.period_start):'Без начала'}</span><span>{g.period_end?fmtDate(g.period_end):'Без конца'}</span></div></button>)}{!data.goals.length&&<div className="empty-card">Создайте первую цель проекта или направления.</div>}</div></section>}
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
