import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {dayKey} from './date';
import {selectedCalendarDays,type DateSelection} from './miniMonthModel';
import {PRIORITY_COLORS,taskColor,areaEmoji} from './taskPalette';
import type {Editing,Store} from './types';

export const HOUR_HEIGHT=62/1.5;
const START=0;
const END=24;
const isOpen=(status:string)=>status!=='done'&&status!=='cancelled';

type Props={
  start:Date;selection:DateSelection;store:Store;day:string;
  setDay:(date:string)=>void;edit:(item:Editing)=>void;slot:(date:Date)=>void;
};

export default function CalendarWeek({start,selection,store,day,setDay,edit,slot}:Props){
 const days=selectedCalendarDays(start,selection);
 const hours=Array.from({length:END-START},(_,i)=>i+START);
 const [now,setNow]=useState(()=>new Date());
 const scrollRef=useRef<HTMLDivElement|null>(null);
 useEffect(()=>{
   const id=window.setInterval(()=>setNow(new Date()),30000);
   return ()=>window.clearInterval(id);
 },[]);
 useEffect(()=>{
   if(!scrollRef.current)return;
   const hour=new Date().getHours();
   scrollRef.current.scrollTop=Math.max(0,((hour>=7?hour-2:7)-START)*HOUR_HEIGHT);
 },[]);
 const nowKey=dayKey(now);
 const nowMinutes=now.getHours()*60+now.getMinutes()+now.getSeconds()/60;
 const rangeOn=Boolean(selection.start&&selection.end);
 const columns:CSSProperties={gridTemplateColumns:'64px repeat('+days.length+', minmax(0,1fr))'};
 const innerWidth=Math.max(900,64+days.length*130);
 return <div ref={scrollRef} className="calendar-scroll"><div className="cal-inner" style={{minWidth:innerWidth}}>
  <div className="cal-row cal-head" style={columns}><div className="rail-label">МЕСТН.</div>{days.map(d=>{
    const key=dayKey(d);
    return <button className={'day-head '+(day===key?'selected ':'')+(rangeOn?'in-range':'')} key={key} onClick={()=>setDay(key)}><small>{d.toLocaleDateString('ru-RU',{weekday:'short'}).toUpperCase()}</small><strong className={key===nowKey?'today':''}>{d.getDate()}</strong></button>;
  })}</div>
  <div className="cal-row all-day" style={columns}><div className="rail-label">Весь день</div>{days.map(d=><div className={'allday-cell '+(rangeOn?'in-range':'')} key={dayKey(d)}>{store.tasks.filter(t=>isOpen(t.status)&&!t.scheduled_at&&t.due_at?.startsWith(dayKey(d))).slice(0,3).map(t=><button key={t.id} onClick={()=>edit({kind:'tasks',record:t})}>{t.title}</button>)}</div>)}</div>
  <div className="cal-row cal-body" style={columns}>
   <div className="time-rail">{hours.map(h=><span key={h} style={{top:(h-START)*HOUR_HEIGHT-6}}>{String(h).padStart(2,'0')}:00</span>)}</div>
   {days.map(d=>{
    const key=dayKey(d);
    const tasks=store.tasks.filter(t=>isOpen(t.status)&&t.scheduled_at?.startsWith(key)).map(t=>({
      id:t.id,kind:'tasks' as const,title:t.title,start:t.scheduled_at!,minutes:t.duration_minutes,
      priorityColor:PRIORITY_COLORS[t.priority-1]||PRIORITY_COLORS[3],fill:taskColor(t.color),
      emoji:t.area_id?areaEmoji(store.areas.find(area=>area.id===t.area_id)?.emoji):null,record:t
    }));
    const events=store.events.filter(e=>e.starts_at.startsWith(key)).map(e=>({
      id:e.id,kind:'events' as const,title:e.title,start:e.starts_at,
      minutes:Math.max(15,(new Date(e.ends_at).getTime()-new Date(e.starts_at).getTime())/60000),
      priorityColor:e.color,fill:e.color,emoji:null,record:e
    }));
    return <div key={key} className={'day-track '+(day===key?'active ':'')+(rangeOn?'in-range':'')}
      style={{height:(END-START)*HOUR_HEIGHT,'--hour-height':HOUR_HEIGHT+'px'} as CSSProperties}
      onClick={e=>{
        if(e.target!==e.currentTarget)return;
        const rect=e.currentTarget.getBoundingClientRect();
        const minute=Math.max(0,Math.min((END-START)*60-30,Math.floor(((e.clientY-rect.top)/HOUR_HEIGHT)*2)*30));
        const date=new Date(d);date.setHours(START,minute,0,0);slot(date);
      }}>
      {[...tasks,...events].map(b=>{
        const t=new Date(b.start);const minutes=t.getHours()*60+t.getMinutes();
        if(minutes>=END*60||minutes+b.minutes<=START*60)return null;
        const top=Math.max(0,(minutes-START*60)*HOUR_HEIGHT/60);
        const height=Math.max(18,Math.min(b.minutes*HOUR_HEIGHT/60,(END-START)*HOUR_HEIGHT-top));
        return <button key={b.kind+b.id} className={'cal-item '+(b.kind==='tasks'?'task-block':'event-block')}
          style={{top,height,borderLeftColor:b.priorityColor,backgroundColor:b.fill+'35'}}
          onClick={e=>{e.stopPropagation();edit({kind:b.kind,record:b.record})}} title={b.title}>
          <strong>{b.title}</strong><small>{b.start.slice(11,16)}</small>
          {b.emoji&&<span className="cal-area-emoji" aria-label="Направление">{b.emoji}</span>}
        </button>;
      })}
      {key===nowKey&&<div className="now-line" style={{top:nowMinutes*HOUR_HEIGHT/60}} aria-label={'Текущее время '+String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0')}/>}
    </div>;
   })}
  </div>
 </div></div>;
}
