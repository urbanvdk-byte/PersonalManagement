import {useEffect,useRef,useState,type CSSProperties,type PointerEvent as ReactPointerEvent} from 'react';
import {CalendarClock,Plus} from 'lucide-react';
import {HOUR_HEIGHT,toScheduledAt} from './calendarInteraction';
import {PRIORITY_COLORS} from './taskPalette';
import type {Task} from './types';

type Drag={pointerId:number;task:Task;x:number;y:number;active:boolean};
export default function CalendarBacklog({tasks,onSchedule,onOpen}:{
 tasks:Task[];onSchedule:(task:Task,when:string)=>Promise<void>;onOpen:(task:Task)=>void;
}){
 const [active,setActive]=useState<{title:string;x:number;y:number;when:string}|null>(null);
 const [error,setError]=useState('');
 const drag=useRef<Drag|null>(null);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const detach=useRef<(()=>void)|null>(null);
 const preview=useRef<{day:string;when:string}|null>(null);
 const clearTimer=()=>{if(timer.current){clearTimeout(timer.current);timer.current=null;}};
 function stop(){
   clearTimer();detach.current?.();detach.current=null;
   drag.current=null;preview.current=null;setActive(null);
 }
 useEffect(()=>()=>{clearTimeout(timer.current??undefined);detach.current?.();},[]);
 function targetAt(x:number,y:number){
   const tracks=document.querySelectorAll<HTMLElement>('.calendar-scroll [data-calendar-day]');
   for(const track of tracks){
     const scroller=track.closest<HTMLElement>('.calendar-scroll');
     if(!scroller)continue;
     const rect=track.getBoundingClientRect(),scroll=scroller.getBoundingClientRect();
     if(y<scroll.top+40||y>scroll.bottom)return null;
     if(x<Math.max(rect.left,scroll.left)||x>Math.min(rect.right,scroll.right))continue;
     const minute=Math.max(0,Math.min(1440-30,Math.floor((y-rect.top)/HOUR_HEIGHT*4)*15));
     const day=track.dataset.calendarDay!;
     return {day,when:toScheduledAt(day,minute)};
   }
   return null;
 }
 function begin(e:ReactPointerEvent<HTMLDivElement>,task:Task){
   if(e.button!==0||e.pointerType==='mouse')return;
   stop();
   const pointerId=e.pointerId;
   drag.current={pointerId,task,x:e.clientX,y:e.clientY,active:false};
   setError('');
   timer.current=setTimeout(()=>{
     if(drag.current?.pointerId===pointerId)drag.current.active=true;
   },420);
   const move=(event:PointerEvent)=>{
     const p=drag.current;if(!p||p.pointerId!==event.pointerId)return;
     const distance=Math.hypot(event.clientX-p.x,event.clientY-p.y);
     if(!p.active){
       if(event.pointerType==='mouse'&&distance>5){p.active=true;clearTimer();}
       else if(event.pointerType!=='mouse'&&distance>12){stop();return;}
     }
     if(!p.active)return;
     const destination=targetAt(event.clientX,event.clientY);
     preview.current=destination;
     setActive({title:p.task.title,x:event.clientX,y:event.clientY,when:destination?.when||''});
   };
   const end=(event:PointerEvent)=>{
     const p=drag.current;if(!p||p.pointerId!==event.pointerId)return;
     const wasActive=p.active;
     const destination=targetAt(event.clientX,event.clientY)||preview.current;
     stop();
     if(!wasActive){onOpen(p.task);return;}
     if(!destination){setError('Перетащите задачу внутрь часовой сетки календаря.');return;}
     void onSchedule(p.task,destination.when).catch(err=>setError(err instanceof Error?err.message:String(err)));
   };
   const cancel=(event:PointerEvent)=>{if(drag.current?.pointerId===event.pointerId)stop();};
   window.addEventListener('pointermove',move,true);
   window.addEventListener('pointerup',end,true);
   window.addEventListener('pointercancel',cancel,true);
   detach.current=()=>{
     window.removeEventListener('pointermove',move,true);
     window.removeEventListener('pointerup',end,true);
     window.removeEventListener('pointercancel',cancel,true);
   };
 }
 return <section className="backlog-panel" aria-label="Незапланированные задачи">
  <header><div><strong><CalendarClock size={16}/> Без времени</strong><small>Перетащите задачу в сетку</small></div><span>{tasks.length}</span></header>
  <div className="backlog-items">
   {tasks.length===0?<p className="backlog-empty">Все задачи распределены по времени.</p>:
    tasks.slice().sort((a,b)=>a.priority-b.priority).map(t=>
     <div key={t.id} className="backlog-task" role="button" tabIndex={0} draggable
       style={{borderLeftColor:PRIORITY_COLORS[t.priority-1]}}
       onDragStart={e=>{
         e.dataTransfer.setData('application/x-pm-task',String(t.id));
         e.dataTransfer.setData('text/plain',String(t.id));
         e.dataTransfer.effectAllowed='move';
       }}
       onClick={()=>onOpen(t)}
       onPointerDown={e=>begin(e,t)}
       onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onOpen(t);}}}
       title="Зажмите и перенесите в календарь. На телефоне удерживайте перед переносом.">
       <strong>{t.title}</strong><span>P{t.priority}</span>
     </div>
    )}
  </div>
  {error&&<small className="backlog-error" role="alert">{error}</small>}
  {active&&<div className="backlog-ghost" style={{left:active.x+10,top:active.y+10} as CSSProperties}>
    <Plus size={13}/>{active.title}{active.when&&<small>{active.when.slice(11,16)}</small>}
  </div>}
 </section>;
}
