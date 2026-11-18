/** Pure, browser-independent geometry used by pointer gestures on the calendar. */
export const MIN_TASK_MINUTES=30;
export const SNAP_MINUTES=15;
export const MINUTES_IN_DAY=1440;
export const HOUR_HEIGHT=62/1.5;

export type GestureMode='move'|'resize-start'|'resize-end';
export type CalendarPreview={taskId:number;day:string;minute:number;duration:number;mode:GestureMode;occurrenceDate?:string};

const limit=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
export const snapQuarter=(value:number)=>Math.round(value/SNAP_MINUTES)*SNAP_MINUTES;
export const fromTime=(value:string)=>Number(value.slice(11,13))*60+Number(value.slice(14,16));
export function toScheduledAt(day:string,minute:number):string{
  const adjusted=limit(snapQuarter(minute),0,MINUTES_IN_DAY-SNAP_MINUTES);
  return day+'T'+String(Math.floor(adjusted/60)).padStart(2,'0')+':'+String(adjusted%60).padStart(2,'0');
}
export function movePreview(taskId:number,day:string,pointerMinute:number,grabOffsetMinutes:number,duration:number):CalendarPreview{
  const wholeDuration=limit(snapQuarter(duration),MIN_TASK_MINUTES,MINUTES_IN_DAY);
  const minute=limit(snapQuarter(pointerMinute-grabOffsetMinutes),0,Math.max(0,MINUTES_IN_DAY-wholeDuration));
  return {taskId,day,minute,duration:wholeDuration,mode:'move'};
}
export function resizePreview(taskId:number,day:string,startMinute:number,duration:number,mode:'resize-start'|'resize-end',deltaMinutes:number):CalendarPreview{
  const delta=snapQuarter(deltaMinutes);
  const originalDuration=limit(snapQuarter(duration),MIN_TASK_MINUTES,MINUTES_IN_DAY);
  if(mode==='resize-start'){
    const topDelta=limit(delta,-startMinute,originalDuration-MIN_TASK_MINUTES);
    return {taskId,day,minute:startMinute+topDelta,duration:originalDuration-topDelta,mode};
  }
  const maximum=Math.max(MIN_TASK_MINUTES,MINUTES_IN_DAY-startMinute);
  return {taskId,day,minute:startMinute,duration:limit(originalDuration+delta,MIN_TASK_MINUTES,maximum),mode};
}
export function isPreviewChanged(originalDay:string,originalMinute:number,originalDuration:number,preview:CalendarPreview){
  return preview.day!==originalDay||preview.minute!==originalMinute||preview.duration!==originalDuration;
}
