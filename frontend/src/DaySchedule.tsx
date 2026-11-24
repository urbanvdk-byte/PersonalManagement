import {useEffect,useMemo,useRef,useState,type CSSProperties} from 'react';
import {AlarmClock,CalendarDays,Check,ChevronLeft,ChevronRight,Plus,Repeat2,Clock3} from 'lucide-react';
import {addDays,dayKey,fmtDate,fmtTime,makeDay,weekStart} from './date';
import {expandTasks} from './recurrence';
import {areaEmoji,taskColor} from './taskPalette';
import type {Editing,EventItem,Store,Task} from './types';

type TimelineTask={kind:'task';start:number;end:number;task:Task};
type TimelineEvent={kind:'event';start:number;end:number;event:EventItem};
type Entry=TimelineTask|TimelineEvent;
const mins=(iso:string)=>{const parts=iso.slice(11,16).split(':').map(Number);return parts[0]*60+parts[1];};
const asClock=(minutes:number)=>String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
const asDuration=(minutes:number)=>minutes>=60?Math.floor(minutes/60)+' ч'+(minutes%60?' '+minutes%60+' мин':''):minutes+' мин';
const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

export default function DaySchedule({day,onDayChange,store,onEdit,onToggle,onToggleEvent,onAdd}:{
 day:string;onDayChange:(day:string)=>void;store:Store;
 onEdit:(editing:Editing)=>void;onToggle:(task:Task)=>void;onToggleEvent?:(event:EventItem)=>void;onAdd:()=>void;
}){
 const monday=weekStart(makeDay(day));
 const week=Array.from({length:7},(_,i)=>addDays(monday,i));
 const [now,setNow]=useState(()=>new Date());
 const markerRef=useRef<HTMLDivElement|null>(null);
 useEffect(()=>{
   const id=window.setInterval(()=>setNow(new Date()),30000);
   return ()=>window.clearInterval(id);
 },[]);
 const today=dayKey(now);
 const showNow=day===today;
 const currentMinute=now.getHours()*60+now.getMinutes();
 const tasks=useMemo(()=>expandTasks(store.tasks,store.occurrences||[],day,day,true),[store.tasks,store.occurrences,day]);
 const entries=useMemo(()=>{
   const taskItems:TimelineTask[]=tasks.filter(t=>t.scheduled_at).map(t=>({
     kind:'task',task:t,start:mins(t.scheduled_at!),end:mins(t.scheduled_at!)+t.duration_minutes
   }));
   const eventItems:TimelineEvent[]=store.events.filter(e=>e.starts_at.slice(0,10)===day).map(e=>({
     kind:'event',event:e,start:mins(e.starts_at),
     end:Math.max(mins(e.starts_at)+15,mins(e.ends_at))
   }));
   return ([...taskItems,...eventItems] as Entry[]).sort((a,b)=>a.start-b.start||a.end-b.end);
 },[tasks,store.events,day]);
 const dayLoad=entries.reduce((total,item)=>total+Math.max(0,item.end-item.start),0);
 const done=tasks.filter(t=>t.status==='done').length;
 const withinIndex=showNow?entries.findIndex(entry=>currentMinute>=entry.start&&currentMinute<entry.end):-1;
 const beforeIndex=showNow&&withinIndex===-1?entries.findIndex(entry=>currentMinute<entry.start):-1;
 // Center the actual current-time marker whenever this screen opens on today.
 // Do not keep re-centering during the 30-second clock updates or user scrolling.
 useEffect(()=>{
   if(!showNow)return;
   const frame=window.requestAnimationFrame(()=>{
     markerRef.current?.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'});
   });
   return ()=>window.cancelAnimationFrame(frame);
 },[day,showNow]);
 const nowMarker=(fraction?:number)=><div ref={markerRef}
   className={'schedule-now-marker '+(fraction===undefined?'standalone':'within-entry')}
   style={fraction===undefined?undefined:{top:Math.max(10,Math.min(88,fraction*100))+'%'} as CSSProperties}
   aria-label={'Текущее время '+asClock(currentMinute)}>
   <span className="schedule-now-clock">{asClock(currentMinute)}</span>
   <span className="schedule-now-stroke" aria-hidden="true"/>
 </div>;
 let cursor=entries[0]?.start??8*60;
 return <section className="schedule-page" aria-label="Расписание дня">
   <div className="schedule-toolbar">
     <p className="schedule-current-date">{fmtDate(day,{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>
     <div className="schedule-toolbar-actions">
       <button className="schedule-today" onClick={()=>onDayChange(today)}>Сегодня</button>
       <button className="schedule-nav-btn" aria-label="Предыдущий день" onClick={()=>onDayChange(dayKey(addDays(makeDay(day),-1)))}><ChevronLeft size={18}/></button>
       <button className="schedule-nav-btn" aria-label="Следующий день" onClick={()=>onDayChange(dayKey(addDays(makeDay(day),1)))}><ChevronRight size={18}/></button>
     </div>
   </div>
   <div className="schedule-week" role="group" aria-label="Выберите день недели">
     {week.map((d,i)=>{
       const key=dayKey(d);
       const active=key===day;
       const dayTasks=expandTasks(store.tasks,store.occurrences||[],key,key,true);
       const dayEvents=store.events.filter(e=>e.starts_at.slice(0,10)===key);
       const count=dayTasks.length+dayEvents.length;
       return <button key={key} className={'schedule-date '+(active?'active ':'')+(key===today?'is-today':'')}
         aria-pressed={active} aria-label={fmtDate(key,{weekday:'long',day:'numeric',month:'long'})}
         onClick={()=>onDayChange(key)}>
         <span>{weekdays[i]}</span><strong>{d.getDate()}</strong>
         <small aria-label={count+' дел'}>{Array.from({length:Math.min(3,count)},(_,n)=><i key={n}/>)}</small>
       </button>;
     })}
   </div>
   <div className="schedule-summary">
     <div><span>Запланировано</span><strong>{entries.length}</strong></div>
     <div><span>Загрузка</span><strong>{asDuration(dayLoad)}</strong></div>
     <div><span>Задачи</span><strong>{tasks.length-done} <em>/ {tasks.length}</em></strong></div>
   </div>
   <div className="schedule-timeline-head"><h3>План по времени</h3><span><Clock3 size={14}/> {day===today?'Сегодня':'Выбранный день'}</span></div>
   <div className="schedule-timeline">
    {entries.length===0?
      <>{showNow&&nowMarker()}<div className="schedule-empty"><CalendarDays size={32}/><strong>На этот день пока ничего не назначено</strong><p>Добавьте задачу или вернитесь к календарю для планирования.</p><button onClick={onAdd}><Plus size={17}/> Запланировать</button></div></>
    :entries.map((item,index)=>{
       const gap=Math.max(0,item.start-cursor);cursor=Math.max(cursor,item.end);
       const isTask=item.kind==='task';
       const task=isTask?item.task:null;
       const event=!isTask?item.event:null;
       const title=task?.title||event!.title;
       const completed=task?task.status==='done':Boolean(event?.done);
       const area=store.areas.find(a=>a.id===(task?.area_id??event?.area_id));
       const project=store.projects.find(p=>p.id===(task?.project_id??event?.project_id));
       const checks=task?(store.checklist||[]).filter(c=>c.task_id===task.id):[];
       const doneCount=checks.filter(c=>c.done).length;
       const icon=area?areaEmoji(area.emoji):isTask?'✅':'📅';
       return <div className="schedule-entry-wrap" key={isTask?'task-'+task!.id+'-'+(task!.occurrence_date||day):'event-'+event!.id}>
         {gap>=15&&<div className="schedule-gap"><span>{asClock(item.start-gap)}</span><span>Свободное время · {asDuration(gap)}</span></div>}
         {showNow&&beforeIndex===index&&nowMarker()}
         <div className={'schedule-entry'+(completed?' schedule-entry-done':'')}>
           {showNow&&withinIndex===index&&nowMarker((currentMinute-item.start)/Math.max(1,item.end-item.start))}
           <div className="schedule-time-col"><span>{asClock(item.start)}</span><small>{asClock(item.end)}</small></div>
           <div className="schedule-track-icon"><span>{icon}</span></div>
           <div className={'schedule-entry-card '+(isTask?'schedule-task':'schedule-event')}
             style={task?{'--task-outline':taskColor(task.color)} as CSSProperties:undefined}>
             <div className="schedule-card-main">
               <div className="schedule-card-meta">
                 <span>{asClock(item.start)}–{asClock(item.end)} · {asDuration(Math.max(0,item.end-item.start))}</span>
                 {task?.recurrence&&<Repeat2 size={13} aria-label="Повторяется"/>}
               </div>
               <button className="schedule-card-title" onClick={()=>onEdit({kind:isTask?'tasks':'events',record:(task||event)!})}>{title}</button>
               <div className="schedule-card-tags">
                 {project&&<span>{project.title}</span>}
                 {area&&<span>{icon} {area.title}</span>}
                 {task&&<span className={'schedule-priority p'+task.priority}>P{task.priority}</span>}
                 {checks.length>0&&<span><Check size={11}/> {doneCount}/{checks.length}</span>}
               </div>
             </div>
             <button type="button" className={'schedule-complete '+(completed?'is-done':'')}
               onClick={()=>task?onToggle(task):onToggleEvent?.(event!)}
               aria-pressed={completed} aria-label={(completed?'Отменить выполнение: ':'Выполнить: ')+title}
               title={completed?'Отменить отметку выполнения':'Отметить выполненным'}><Check size={17}/></button>
           </div>
         </div>
       </div>;
     })}
    {showNow&&entries.length>0&&withinIndex===-1&&beforeIndex===-1&&nowMarker()}
   </div>
   <button className="schedule-floating-add" onClick={onAdd} aria-label="Добавить задачу на день" title="Добавить задачу на выбранный день"><Plus size={25}/></button>
 </section>;
}
