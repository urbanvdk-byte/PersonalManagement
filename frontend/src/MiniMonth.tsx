import {useRef,useState,type PointerEvent as ReactPointerEvent} from 'react';
import {ChevronLeft,ChevronRight,X} from 'lucide-react';
import {dayKey,fmtDate,weekStart,addDays} from './date';
import {monthGrid,normalizeRange,withinSelectedRange,type DateSelection} from './miniMonthModel';

const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

type MiniMonthProps={
  viewMonth:Date;
  selectedDay:string;
  week:Date;
  selection:DateSelection;
  busyDays:ReadonlySet<string>;
  onPick:(key:string)=>void;
  onRange:(start:string,end:string)=>void;
  onChangeMonth:(step:number)=>void;
  onClearRange:()=>void;
  onToday:()=>void;
};
type ActivePointer={id:number;anchor:string;current:string;dragged:boolean};

export default function MiniMonth({viewMonth,selectedDay,week,selection,busyDays,onPick,onRange,onChangeMonth,onClearRange,onToday}:MiniMonthProps){
  const [preview,setPreview]=useState<DateSelection|null>(null);
  const pointer=useRef<ActivePointer|null>(null);
  const days=monthGrid(viewMonth);
  const weekStartKey=dayKey(week);
  const weekEndKey=dayKey(addDays(weekStart(week),6));
  const today=dayKey(new Date());
  const label=fmtDate(viewMonth,{month:'long',year:'numeric'});
  const visible=preview??selection;

  function dateAtPoint(x:number,y:number):string|null{
    const el=document.elementFromPoint(x,y);
    const button=el?.closest<HTMLButtonElement>('button[data-date]');
    return button?.closest('.mini-month-grid') ? button.dataset.date??null : null;
  }
  function down(e:ReactPointerEvent<HTMLDivElement>){
    if(e.button!==0)return;
    const target=(e.target as HTMLElement).closest<HTMLButtonElement>('button[data-date]');
    if(!target?.dataset.date)return;
    e.preventDefault();
    const key=target.dataset.date;
    pointer.current={id:e.pointerId,anchor:key,current:key,dragged:false};
    setPreview({start:key,end:key});
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e:ReactPointerEvent<HTMLDivElement>){
    const p=pointer.current;
    if(!p||p.id!==e.pointerId)return;
    const key=dateAtPoint(e.clientX,e.clientY);
    if(key&&key!==p.current){
      p.current=key;
      p.dragged=p.dragged||key!==p.anchor;
      setPreview(normalizeRange(p.anchor,key));
    }
  }
  function up(e:ReactPointerEvent<HTMLDivElement>){
    const p=pointer.current;
    if(!p||p.id!==e.pointerId)return;
    // The final pointer location may differ from the last move event.
    const key=dateAtPoint(e.clientX,e.clientY)??p.current;
    pointer.current=null;
    setPreview(null);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
    if(p.dragged||key!==p.anchor)onRange(p.anchor,key);
    else onPick(p.anchor);
  }
  function cancel(e:ReactPointerEvent<HTMLDivElement>){
    if(pointer.current?.id!==e.pointerId)return;
    pointer.current=null;
    setPreview(null);
    if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  }
  const text=visible.start
    ? visible.end && visible.end!==visible.start
      ? fmtDate(visible.start,{day:'numeric',month:'short'})+' — '+fmtDate(visible.end,{day:'numeric',month:'short'})
      : 'Выбрано: '+fmtDate(visible.start,{day:'numeric',month:'short'})
    : 'Зажмите день и протяните до конца периода';

  return <section className="mini-month" aria-label="Мини-календарь месяца">
    <header className="mini-month-head">
      <h3>{label.charAt(0).toUpperCase()+label.slice(1)}</h3>
      <div className="mini-month-arrows">
        <button type="button" className="mini-month-today" onClick={onToday} aria-label="Перейти к сегодняшней дате">Сегодня</button>
        <button type="button" aria-label="Предыдущий месяц" onClick={()=>onChangeMonth(-1)}><ChevronLeft size={17}/></button>
        <button type="button" aria-label="Следующий месяц" onClick={()=>onChangeMonth(1)}><ChevronRight size={17}/></button>
      </div>
    </header>
    <div className="mini-month-grid" role="group" aria-label="Дни месяца" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}>
      {weekdays.map(day=><span className="mini-weekday" key={day}>{day}</span>)}
      {days.map(day=>{
        const key=dayKey(day);
        const outside=day.getMonth()!==viewMonth.getMonth();
        const weekActive=key>=weekStartKey&&key<=weekEndKey;
        const selected=withinSelectedRange(key,visible);
        const start=visible.start===key;
        const end=visible.end===key;
        const active=selectedDay===key;
        const todayActive=today===key;
        const cls=['mini-day',outside?'outside':'',weekActive?'week-active':'',selected?'range-active':'',start?'range-start':'',end?'range-end':'',active?'date-active':'',todayActive?'date-today':''].filter(Boolean).join(' ');
        const fullDate=fmtDate(day,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
        return <button type="button" key={key} className={cls}
          onClick={e=>{if(e.detail===0){e.shiftKey&&selection.start?onRange(selection.start,key):onPick(key)}}}
          aria-label={fullDate} title={fullDate} aria-pressed={active||selected} data-date={key}>
          <span className="mini-day-number">{day.getDate()}</span>
          {busyDays.has(key)&&<span className="mini-day-dot" aria-hidden="true"/>}
        </button>;
      })}
    </div>
    <div className="mini-month-selection" aria-live="polite">
      <span>{text}</span>
      {visible.start&&<button type="button" aria-label="Сбросить период" onClick={onClearRange}><X size={14}/></button>}
    </div>
  </section>;
}
