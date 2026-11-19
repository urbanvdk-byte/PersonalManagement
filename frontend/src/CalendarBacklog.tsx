import {useRef,useState,type CSSProperties,type PointerEvent as ReactPointerEvent} from 'react';
import {CalendarClock,Plus} from 'lucide-react';
import {HOUR_HEIGHT,toScheduledAt} from './calendarInteraction';
import {PRIORITY_COLORS} from './taskPalette';
import type {Task} from './types';

type Drag={pointerId:number;task:Task;x:number;y:number;active:boolean};
export default function CalendarBacklog({tasks,onSchedule,onOpen}:{
 tasks:Task[];onSchedule:(task:Task,when:string)=>Promise<void>;
 onOpen:(task:Task)=>void;
}){
 const [active,setActive]=useState<{title:string;x:number;y:number;day:string;when:string}|null>(null);
 const [error,setError]=useState('');
 const drag=useRef<Drag|null>(null);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const preview=useRef<{day:string;when:string}|null>(null);
 const clear=()=>{if(timer.current){clearTimeout(timer.current);timer.current=null;}};
 function targetAt(x:number,y:number){
   const node=document.elementFromPoint(x,y);
   const track=node?.closest<HTMLElement>('[data-calendar-day]');
   const scroller=track?.closest<HTMLElement>('.calendar-scroll');
   if(!track||!scroller)return null;
   const rect=track.getBoundingClientRect();
   const scroll=scroller.getBoundingClientRect();
   if(x<rect.left||x>rect.right||y<scroll.top+40||y>scroll.bottom)return null;
   const minute=Math.max(0,Math.min(1440-30,Math.floor((y-rect.top)/HOUR_HEIGHT*4)*15));
   const day=track.dataset.calendarDay!;
   return {day,when:toScheduledAt(day,minute)};
 }
 function start(e:ReactPointerEvent<HTMLDivElement>,task:Task){
   if(e.button!==0)return;
   drag.current={pointerId:e.pointerId,task,x:e.clientX,y:e.clientY,active:false};
   preview.current=null;
   e.currentTarget.setPointerCapture(e.pointerId);
   if(e.pointerType!=='mouse')timer.current=setTimeout(()=>{
     if(drag.current?.pointerId===e.pointerId)drag.current.active=true;
   },420);
 }
 function move(e:ReactPointerEvent<HTMLDivElement>){
   const p=drag.current;
   if(!p||p.pointerId!==e.pointerId)return;
   const dist=Math.hypot(e.clientX-p.x,e.clientY-p.y);
   if(!p.active){
     if(e.pointerType==='mouse'&&dist>5){p.active=true;clear();}
     else if(e.pointerType!=='mouse'&&dist>12){clear();drag.current=null;return;}
   }
   if(!p.active)return;
   const destination=targetAt(e.clientX,e.clientY);
   preview.current=destination;
   setActive({title:p.task.title,x:e.clientX,y:e.clientY,
     day:destination?.day||'',when:destination?.when||''});
 }
 function finish(e:ReactPointerEvent<HTMLDivElement>){
   const p=drag.current;
   if(!p||p.pointerId!==e.pointerId)return;
   clear();drag.current=null;setActive(null);
   if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
   if(!p.active){onOpen(p.task);return;}
   const target=targetAt(e.clientX,e.clientY)||preview.current;
   preview.current=null;
   if(!target){setError('Перетащите задачу внутрь часовой сетки календаря.');return;}
   setError('');
   void onSchedule(p.task,target.when).catch(err=>setError(err instanceof Error?err.message:String(err)));
 }
 return <section className="backlog-panel" aria-label="Незапланированные задачи">
  <header><div><strong><CalendarClock size={16}/> Без времени</strong><small>Перетащите задачу в сетку</small></div><span>{tasks.length}</span></header>
  <div className="backlog-items">
   {tasks.length===0?<p className="backlog-empty">Все задачи распределены по времени.</p>:
    tasks.slice().sort((a,b)=>a.priority-b.priority).map(t=>
     <div key={t.id} className="backlog-task" role="button" tabIndex={0}
       style={{borderLeftColor:PRIORITY_COLORS[t.priority-1]}}
       onPointerDown={e=>start(e,t)} onPointerMove={move} onPointerUp={finish}
       onPointerCancel={()=>{drag.current=null;clear();setActive(null);}}
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
