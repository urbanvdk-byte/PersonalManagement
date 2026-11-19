import {useEffect,useRef,useState,type CSSProperties,type PointerEvent as ReactPointerEvent} from 'react';
import {ArrowRight} from 'lucide-react';
import {dayKey,makeDay} from './date';
import {layoutTimedItems} from './calendarLayout';
import {selectedCalendarDays,type DateSelection} from './miniMonthModel';
import {expandTasks} from './recurrence';
import {PRIORITY_COLORS,taskColor,areaEmoji} from './taskPalette';
import {HOUR_HEIGHT,fromTime,movePreview,resizePreview,toScheduledAt,isPreviewChanged,type CalendarPreview,type GestureMode} from './calendarInteraction';
import type {Editing,Store,Task} from './types';

const START=0;
const END=24;
const LONG_PRESS_MS=420;
const isOpen=(status:string)=>status!=='done'&&status!=='cancelled';

type Props={
  start:Date;selection:DateSelection;store:Store;day:string;
  setDay:(date:string)=>void;edit:(item:Editing)=>void;slot:(date:Date)=>void;
  updateTask:(task:Task,changes:Record<string,unknown>)=>Promise<void>;
  onTomorrow:(task:Task)=>Promise<void>;
  onDropTask:(taskId:number,when:string)=>Promise<void>;
};
type Gesture={
  pointerId:number;task:Task;mode:GestureMode;
  x:number;y:number;day:string;minute:number;duration:number;offsetMinutes:number;
  active:boolean;moved:boolean;preview:CalendarPreview;
};

export default function CalendarWeek({start,selection,store,day,setDay,edit,slot,updateTask,onTomorrow,onDropTask}:Props){
 const days=selectedCalendarDays(start,selection);
 const hours=Array.from({length:END-START},(_,i)=>i+START);
 const [now,setNow]=useState(()=>new Date());
 const [preview,setPreview]=useState<CalendarPreview|null>(null);
 const [saving,setSaving]=useState(false);
 const scrollRef=useRef<HTMLDivElement|null>(null);
 const gesture=useRef<Gesture|null>(null);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const lastTap=useRef<{key:string;at:number}|null>(null);
 const touchClickUntil=useRef(0);
 const suppressGridUntil=useRef(0);
 const tapTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const previewRef=useRef<CalendarPreview|null>(null);
 const busy=useRef(false);

 const clearTimer=()=>{if(timer.current!==null){clearTimeout(timer.current);timer.current=null;}};
 const showPreview=(value:CalendarPreview|null)=>{previewRef.current=value;setPreview(value);};

 useEffect(()=>{
   const id=window.setInterval(()=>setNow(new Date()),30000);
   return ()=>window.clearInterval(id);
 },[]);
 useEffect(()=>{
   if(!scrollRef.current)return;
   const hour=new Date().getHours();
   scrollRef.current.scrollTop=Math.max(0,((hour>=7?hour-2:7)-START)*HOUR_HEIGHT);
 },[]);
 // The desktop calendar starts at the week's first day; on narrow screens
 // keep the selected (initially today's) date at the center of the viewport.
 const visibleDaysKey=days.map(dayKey).join('|');
 useEffect(()=>{
   if(!window.matchMedia('(max-width: 760px)').matches)return;
   const frame=window.requestAnimationFrame(()=>{
     const scroller=scrollRef.current;
     if(!scroller)return;
     const keys=visibleDaysKey.split('|');
     const selected=keys.indexOf(day);
     const index=selected>=0?selected:keys.indexOf(dayKey(new Date()));
     const columns=scroller.querySelectorAll<HTMLElement>('.day-head');
     const target=index>=0?columns[index]:null;
     if(!target)return;
     const track=target.getBoundingClientRect();
     const viewport=scroller.getBoundingClientRect();
     scroller.scrollLeft+=track.left+track.width/2-(viewport.left+viewport.width/2);
   });
   return ()=>window.cancelAnimationFrame(frame);
 },[day,visibleDaysKey]);
 useEffect(()=>()=>{if(timer.current!==null)clearTimeout(timer.current);if(tapTimer.current!==null)clearTimeout(tapTimer.current);},[]);

 const nowKey=dayKey(now);
 const nowMinutes=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
 const rangeOn=Boolean(selection.start&&selection.end);
 const expanded=expandTasks(store.tasks,store.occurrences||[],dayKey(days[0]),dayKey(days[days.length-1]));
 // Timed events and tasks participate in the same collision layout, just
 // like Google Calendar. Each date gets enough horizontal space for its
 // busiest time slot, with horizontal scrolling instead of hidden titles.
 const dayLayouts=days.map(d=>{
   const key=dayKey(d);
   const tasks=expanded.filter(t=>isOpen(t.status)&&t.scheduled_at?.startsWith(key)).map(t=>({
     id:t.id,kind:'tasks' as const,title:t.title,start:t.scheduled_at!,minutes:t.duration_minutes,
     priorityColor:PRIORITY_COLORS[t.priority-1]||PRIORITY_COLORS[3],fill:taskColor(t.color),
     emoji:t.area_id?areaEmoji(store.areas.find(a=>a.id===t.area_id)?.emoji):null,record:t
   }));
   const events=store.events.filter(e=>e.starts_at.startsWith(key)).map(e=>({
     id:e.id,kind:'events' as const,title:e.title,start:e.starts_at,
     minutes:Math.max(15,(new Date(e.ends_at).getTime()-new Date(e.starts_at).getTime())/60000),
     priorityColor:e.color,fill:e.color,emoji:null,record:e
   }));
   const placement=layoutTimedItems([...tasks,...events].map(b=>({
     id:b.kind+'-'+b.id+(b.kind==='tasks'?'@'+(b.record.occurrence_date||''):''),
     start:fromTime(b.start),
     end:fromTime(b.start)+b.minutes
   })));
   return {key,tasks,events,placement};
 });
 const widths=dayLayouts.map(info=>Math.max(132,info.placement.maxColumns*102));
 const columns:CSSProperties={gridTemplateColumns:'64px '+widths.map(w=>'minmax('+w+'px,1fr)').join(' ')};
 const innerWidth=Math.max(970,64+widths.reduce((sum,width)=>sum+width,0));

 function trackAt(x:number):{key:string;rect:DOMRect}|null{
   const tracks=scrollRef.current?.querySelectorAll<HTMLElement>('[data-calendar-day]');
   if(!tracks?.length)return null;
   let best:{key:string;rect:DOMRect;distance:number}|null=null;
   tracks.forEach(node=>{
     const rect=node.getBoundingClientRect();
     const distance=x<rect.left?rect.left-x:x>rect.right?x-rect.right:0;
     if(!best||distance<best.distance)best={key:node.dataset.calendarDay!,rect,distance};
   });
   if(!best)return null;
   const selected=best as {key:string;rect:DOMRect;distance:number};
   return {key:selected.key,rect:selected.rect};
 }
 function autoScroll(x:number,y:number){
   const scroller=scrollRef.current;
   if(!scroller)return;
   const box=scroller.getBoundingClientRect();
   const edge=35;
   if(y<box.top+edge)scroller.scrollTop-=14;
   else if(y>box.bottom-edge)scroller.scrollTop+=14;
   if(x<box.left+edge)scroller.scrollLeft-=18;
   else if(x>box.right-edge)scroller.scrollLeft+=18;
 }
 function project(g:Gesture,x:number,y:number):CalendarPreview{
   if(g.mode==='move'){
     const target=trackAt(x);
     if(!target)return g.preview;
     const pointerMinute=(y-target.rect.top)/HOUR_HEIGHT*60;
     return {...movePreview(g.task.id,target.key,pointerMinute,g.offsetMinutes,g.duration),
       ...(g.task.occurrence_date?{occurrenceDate:g.task.occurrence_date}:{})};
   }
   const delta=(y-g.y)/HOUR_HEIGHT*60;
   return {...resizePreview(g.task.id,g.day,g.minute,g.duration,g.mode,delta),
     ...(g.task.occurrence_date?{occurrenceDate:g.task.occurrence_date}:{})};
 }
 function press(e:ReactPointerEvent<HTMLDivElement>,task:Task,mode:GestureMode){
   if(busy.current||e.button!==0||!task.scheduled_at)return;
   e.stopPropagation();
   e.preventDefault();
   clearTimer();
   const minute=fromTime(task.scheduled_at);
   const rect=e.currentTarget.getBoundingClientRect();
   const offsetMinutes=Math.max(0,Math.min(task.duration_minutes,(e.clientY-rect.top)/HOUR_HEIGHT*60));
   const original:CalendarPreview={
     taskId:task.id,day:task.scheduled_at.slice(0,10),minute,
     duration:task.duration_minutes,mode,
     ...(task.occurrence_date?{occurrenceDate:task.occurrence_date}:{})
   };
   gesture.current={
     pointerId:e.pointerId,task,mode,x:e.clientX,y:e.clientY,
     day:original.day,minute,duration:task.duration_minutes,offsetMinutes,
     active:false,moved:false,preview:original
   };
   e.currentTarget.setPointerCapture(e.pointerId);
   if(e.pointerType==='touch'||e.pointerType==='pen'){
     const id=e.pointerId;
     timer.current=setTimeout(()=>{
       const g=gesture.current;
       if(g?.pointerId!==id)return;
       g.active=true;
       showPreview(g.preview);
       timer.current=null;
     },LONG_PRESS_MS);
   }
 }
 function move(e:ReactPointerEvent<HTMLDivElement>){
   const g=gesture.current;
   if(!g||g.pointerId!==e.pointerId)return;
   e.stopPropagation();
   const distance=Math.hypot(e.clientX-g.x,e.clientY-g.y);
   if(!g.active){
     if(e.pointerType==='mouse'&&distance>=5){
       g.active=true;clearTimer();
     }else if((e.pointerType==='touch'||e.pointerType==='pen')&&distance>12){
       // A swipe before the long press is not a calendar edit.
       clearTimer();gesture.current=null;showPreview(null);
       if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
       return;
     }else return;
   }
   if(distance>3)g.moved=true;
   if(!g.moved)return;
   e.preventDefault();
   // Calculate from the pre-scroll geometry. Auto-scrolling first can add
   // an unintended 15-minute jump to a touch drag near the screen edge.
   const next=project(g,e.clientX,e.clientY);
   g.preview=next;
   showPreview(next);
   autoScroll(e.clientX,e.clientY);
 }
 async function release(e:ReactPointerEvent<HTMLDivElement>){
   const g=gesture.current;
   if(!g||g.pointerId!==e.pointerId)return;
   e.stopPropagation();e.preventDefault();
   clearTimer();
   gesture.current=null;
   if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
   if(!g.active){
     if(e.pointerType==='touch')touchClickUntil.current=Date.now()+500;
     if(e.pointerType==='touch'&&g.mode==='move'){
       const key=g.task.id+'@'+(g.task.occurrence_date||'');
       const at=Date.now();
       if(lastTap.current?.key===key&&at-lastTap.current.at<350){
         if(tapTimer.current)clearTimeout(tapTimer.current);
         tapTimer.current=null;lastTap.current=null;
         // The task disappears from its original slot after the move.
         // Suppress the synthetic click on that now-empty calendar cell.
         suppressGridUntil.current=Date.now()+1000;
         void onTomorrow(g.task).catch(()=>{});
       }else{
         lastTap.current={key,at};
         if(tapTimer.current)clearTimeout(tapTimer.current);
         tapTimer.current=setTimeout(()=>{
           if(lastTap.current?.key===key)edit({kind:'tasks',record:g.task});
           lastTap.current=null;tapTimer.current=null;
         },355);
       }
     }else edit({kind:'tasks',record:g.task});
     return;
   }
   // Commit exactly the preview the user saw. Re-projecting after an edge
   // scroll may alter the time without any further pointer movement.
   const result=g.preview;
   if(!g.moved||!isPreviewChanged(g.day,g.minute,g.duration,result)){
     showPreview(null);
     return;
   }
   showPreview(result);
   const updates:Record<string,unknown>={};
   if(g.mode==='move'||g.mode==='resize-start'){
     updates.scheduled_at=toScheduledAt(result.day,result.minute);
   }
   if(g.mode!=='move'||result.duration!==g.duration){
     updates.duration_minutes=result.duration;
   }
   busy.current=true;setSaving(true);
   try{
     await updateTask(g.task,updates);
   }finally{
     busy.current=false;setSaving(false);showPreview(null);
   }
 }
 function cancel(e:ReactPointerEvent<HTMLDivElement>){
   if(gesture.current?.pointerId!==e.pointerId)return;
   clearTimer();gesture.current=null;showPreview(null);
 }
 return <div ref={scrollRef} className="calendar-scroll" aria-label="Календарная сетка: перетаскивайте задачи или меняйте длительность за край">
  <div className="cal-inner" style={{minWidth:innerWidth}}>
   <div className="cal-row cal-head" style={columns}><div className="rail-label">МЕСТН.</div>{days.map(d=>{
     const key=dayKey(d);
     return <button className={'day-head '+(day===key?'selected ':'')+(rangeOn?'in-range':'')} key={key} onClick={()=>setDay(key)}><small>{d.toLocaleDateString('ru-RU',{weekday:'short'}).toUpperCase()}</small><strong className={key===nowKey?'today':''}>{d.getDate()}</strong></button>;
   })}</div>
   <div className="cal-row all-day" style={columns}><div className="rail-label">Весь день</div>{days.map(d=><div className={'allday-cell '+(rangeOn?'in-range':'')} key={dayKey(d)}/>)}</div>
   <div className="cal-row cal-body" style={columns}>
    <div className="time-rail">{hours.map(h=><span key={h} style={{top:(h-START)*HOUR_HEIGHT-6}}>{String(h).padStart(2,'0')}:00</span>)}</div>
    {dayLayouts.map(({key,tasks,events,placement})=>{
      const pending=preview?.day===key?store.tasks.find(t=>t.id===preview.taskId):null;
      return <div key={key} data-calendar-day={key}
        className={'day-track '+(day===key?'active ':'')+(rangeOn?'in-range':'')+(pending?' gesture-target':'')}
        style={{height:(END-START)*HOUR_HEIGHT,'--hour-height':HOUR_HEIGHT+'px'} as CSSProperties}
        onDragOver={e=>{if(e.dataTransfer.types.includes('application/x-pm-task'))e.preventDefault();}}
        onDrop={e=>{
          const raw=e.dataTransfer.getData('application/x-pm-task');
          if(!/^\d+$/.test(raw))return;
          e.preventDefault();e.stopPropagation();
          const rect=e.currentTarget.getBoundingClientRect();
          const minutes=Math.max(0,Math.min(1410,Math.floor((e.clientY-rect.top)/HOUR_HEIGHT*4)*15));
          void onDropTask(Number(raw),toScheduledAt(key,minutes)).catch(()=>{});
        }}
        onClick={e=>{
          if(Date.now()<suppressGridUntil.current)return;
          if(e.target!==e.currentTarget)return;
          const rect=e.currentTarget.getBoundingClientRect();
          const minute=Math.max(0,Math.min((END-START)*60-30,Math.floor(((e.clientY-rect.top)/HOUR_HEIGHT)*2)*30));
          const date=makeDay(key);date.setHours(START,minute,0,0);slot(date);
        }}>
        {[...tasks,...events].map(b=>{
          const t=new Date(b.start);const minute=t.getHours()*60+t.getMinutes();
          if(minute>=END*60||minute+b.minutes<=START*60)return null;
          const top=Math.max(0,(minute-START*60)*HOUR_HEIGHT/60);
          const height=Math.max(18,Math.min(b.minutes*HOUR_HEIGHT/60,(END-START)*HOUR_HEIGHT-top));
          const task=b.kind==='tasks';
          const location=placement.placements.get(b.kind+'-'+b.id+(task?'@'+(b.record.occurrence_date||''):''));
          const gestureTask=task&&preview?.taskId===b.id&&preview?.occurrenceDate===b.record.occurrence_date;
          return <div role="button" tabIndex={0} key={b.kind+b.id+(task?b.record.occurrence_date||'':'')}
            className={'cal-item '+(task?'task-block':'event-block')+(task&&b.minutes<60?' compact-task':'')+(gestureTask?' gesture-source':'')}
            style={{
              top,height,borderLeftColor:b.priorityColor,backgroundColor:b.fill+'35',
              left:'calc('+(location?.leftPercent??0)+'% + 3px)',
              width:'calc('+(location?.widthPercent??100)+'% - 6px)',
              right:'auto'
            }}
            data-layout-column={location?.column??0}
            data-layout-columns={location?.columns??1}
            data-layout-span={location?.span??1}
            onPointerDown={task?e=>{
              const side=(e.target as HTMLElement).closest<HTMLElement>('[data-resize]')?.dataset.resize;
              const mode:GestureMode=side==='start'?'resize-start':side==='end'?'resize-end':'move';
              press(e,b.record as Task,mode);
            }:undefined}
            onPointerMove={task?move:undefined}
            onPointerUp={task?e=>{void release(e).catch(()=>{showPreview(null);busy.current=false;setSaving(false);})}:undefined}
            onPointerCancel={task?cancel:undefined}
            onLostPointerCapture={task?e=>{if(gesture.current?.pointerId===e.pointerId)cancel(e)}:undefined}
            onClick={e=>{
              e.stopPropagation();
              if(task){if(e.detail===0&&Date.now()>touchClickUntil.current)edit({kind:'tasks',record:b.record as Task});}
              else edit({kind:'events',record:b.record});
            }}
            onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();edit({kind:b.kind,record:b.record});}}}
            title={(task&&b.record.recurrence?'↻ ':'')+b.title+' · '+b.start.slice(11,16)}
            aria-label={b.title+' · '+b.start.slice(11,16)}>
            <strong>{task&&b.record.recurrence?'↻ ':''}{b.title}</strong>
            {!(task&&b.minutes<60)&&<small>{b.start.slice(11,16)}</small>}
            {b.emoji&&<span className="cal-area-emoji" aria-label="Направление">{b.emoji}</span>}
            {task&&<button type="button" className="cal-tomorrow" title="Перенести на завтра"
              aria-label={'Перенести на завтра: '+b.title}
              onPointerDown={e=>e.stopPropagation()}
              onPointerUp={e=>e.stopPropagation()}
              onClick={e=>{e.stopPropagation();void onTomorrow(b.record as Task).catch(()=>{});}}>
              <ArrowRight size={12}/>
            </button>}
            {task&&<>
              <span className="calendar-resize-edge top-edge" data-resize="start" aria-hidden="true"/>
              <span className="calendar-resize-edge bottom-edge" data-resize="end" aria-hidden="true"/>
            </>}
          </div>;
        })}
        {pending&&preview&&<div className={'task-preview '+(preview.duration<60?'compact-task':'')}
          style={{
            top:preview.minute*HOUR_HEIGHT/60,
            height:Math.max(18,preview.duration*HOUR_HEIGHT/60),
            borderLeftColor:PRIORITY_COLORS[pending.priority-1]||PRIORITY_COLORS[3],
            backgroundColor:taskColor(pending.color)+'a8'
          }} aria-hidden="true">
          <strong>{pending.title}</strong>
          <small>{toScheduledAt(key,preview.minute).slice(11,16)} · {preview.duration} мин</small>
          {pending.area_id&&<span className="cal-area-emoji">{areaEmoji(store.areas.find(a=>a.id===pending.area_id)?.emoji)}</span>}
        </div>}
        {key===nowKey&&<div className="now-line" style={{top:nowMinutes*HOUR_HEIGHT/60}}
          aria-label={'Текущее время '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')}/>}
      </div>;
    })}
   </div>
  </div>
  {(preview||saving)&&<div className="calendar-gesture-status" role="status">
    {saving?'Сохраняю…':preview?.mode==='move'?'Перенос: '+preview.day+' '+toScheduledAt(preview.day,preview.minute).slice(11,16):
      'Длительность: '+preview?.duration+' минут'}
  </div>}
 </div>;
}
