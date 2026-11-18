/** Local-calendar helpers; no UTC conversion (avoids adjacent-day drift). */
export type DateSelection = {start: string | null; end: string | null};

const two = (n:number) => String(n).padStart(2, '0');
export const calendarKey = (d:Date) => `${d.getFullYear()}-${two(d.getMonth()+1)}-${two(d.getDate())}`;

export function monthGrid(viewMonth:Date): Date[] {
  const first = new Date(viewMonth.getFullYear(),viewMonth.getMonth(),1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay()+6)%7));
  const last = new Date(first.getFullYear(),first.getMonth()+1,0);
  const days = ((last.getTime() - start.getTime()) / 86400000);
  // Work in local calendar dates, not milliseconds (DST transitions).
  const lastOffset = Math.round(days);
  const total = Math.ceil((lastOffset+1)/7)*7;
  return Array.from({length:total},(_,i)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+i));
}

export function selectMiniDate(previous:DateSelection, clicked:string):DateSelection {
  // First click starts, second finishes (even across months), third restarts.
  if (!previous.start || previous.end) return {start:clicked,end:null};
  if (previous.start === clicked) return {start:clicked,end:clicked};
  return clicked < previous.start
    ? {start:clicked,end:previous.start}
    : {start:previous.start,end:clicked};
}

export function withinSelectedRange(key:string,selection:DateSelection):boolean {
  if (!selection.start) return false;
  const low=selection.start;
  const high=selection.end??selection.start;
  return key>=low && key<=high;
}

export function shiftCalendarMonth(month:Date,step:number):Date {
  return new Date(month.getFullYear(),month.getMonth()+step,1);
}
