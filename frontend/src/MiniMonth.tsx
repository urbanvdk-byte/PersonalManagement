import {ChevronLeft,ChevronRight,X} from 'lucide-react';
import {dayKey,fmtDate,weekStart,addDays} from './date';
import {monthGrid,withinSelectedRange,type DateSelection} from './miniMonthModel';

const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

type MiniMonthProps = {
  viewMonth:Date;
  selectedDay:string;
  week:Date;
  selection:DateSelection;
  busyDays:ReadonlySet<string>;
  onPick:(key:string)=>void;
  onChangeMonth:(step:number)=>void;
  onClearRange:()=>void;
};

export default function MiniMonth({viewMonth,selectedDay,week,selection,busyDays,onPick,onChangeMonth,onClearRange}:MiniMonthProps){
  const days=monthGrid(viewMonth);
  const weekStartKey=dayKey(week);
  const weekEndKey=dayKey(addDays(weekStart(week),6));
  const today=dayKey(new Date());
  const label=fmtDate(viewMonth,{month:'long',year:'numeric'});
  const rangeText=selection.start
    ? selection.end
      ? `${fmtDate(selection.start,{day:'numeric',month:'short'})} — ${fmtDate(selection.end,{day:'numeric',month:'short'})}`
      : `Начало периода: ${fmtDate(selection.start,{day:'numeric',month:'short'})}`
    : 'Нажмите день, затем второй день для выбора периода';
  return <section className="mini-month" aria-label="Мини-календарь месяца">
    <header className="mini-month-head">
      <h3>{label.charAt(0).toUpperCase()+label.slice(1)}</h3>
      <div className="mini-month-arrows">
        <button type="button" aria-label="Предыдущий месяц" title="Предыдущий месяц" onClick={()=>onChangeMonth(-1)}><ChevronLeft size={17}/></button>
        <button type="button" aria-label="Следующий месяц" title="Следующий месяц" onClick={()=>onChangeMonth(1)}><ChevronRight size={17}/></button>
      </div>
    </header>
    <div className="mini-month-grid" role="group" aria-label="Дни месяца">
      {weekdays.map(d=><span className="mini-weekday" key={d}>{d}</span>)}
      {days.map(d=>{
        const key=dayKey(d);
        const isOutside=d.getMonth()!==viewMonth.getMonth();
        const isWeek=key>=weekStartKey&&key<=weekEndKey;
        const inRange=withinSelectedRange(key,selection);
        const isStart=selection.start===key;
        const isEnd=selection.end===key;
        const isActive=selectedDay===key;
        const isToday=today===key;
        const cls=['mini-day',isOutside?'outside':'',isWeek?'week-active':'',inRange?'range-active':'',isStart?'range-start':'',isEnd?'range-end':'',isActive?'date-active':'',isToday?'date-today':''].filter(Boolean).join(' ');
        const fullDate=fmtDate(d,{weekday:'long',day:'numeric',month:'long',year:'numeric'});
        return <button type="button" key={key} className={cls} onClick={()=>onPick(key)}
          title={fullDate} aria-label={fullDate} aria-pressed={isActive} data-date={key}>
          <span className="mini-day-number">{d.getDate()}</span>
          {busyDays.has(key)&&<span className="mini-day-dot" aria-hidden="true"/>}
        </button>;
      })}
    </div>
    <div className="mini-month-selection" aria-live="polite">
      <span>{rangeText}</span>
      {selection.start&&<button type="button" aria-label="Сбросить период" title="Сбросить период" onClick={onClearRange}><X size={14}/></button>}
    </div>
  </section>;
}
