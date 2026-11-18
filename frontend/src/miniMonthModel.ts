/** Calendar-only date helpers; date strings are YYYY-MM-DD local dates. */
export type DateSelection={start:string|null;end:string|null};
const two=(v:number)=>String(v).padStart(2,'0');
export const calendarKey=(d:Date)=>d.getFullYear()+'-'+two(d.getMonth()+1)+'-'+two(d.getDate());
const dateFromKey=(s:string)=>{const [y,m,d]=s.slice(0,10).split('-').map(Number);return new Date(y,m-1,d)};

export function monthGrid(viewMonth:Date):Date[]{
  const first=new Date(viewMonth.getFullYear(),viewMonth.getMonth(),1);
  const start=new Date(first);
  start.setDate(first.getDate()-(first.getDay()+6)%7);
  const last=new Date(first.getFullYear(),first.getMonth()+1,0);
  const dayCount=Math.round((last.getTime()-start.getTime())/86400000)+1;
  const total=Math.ceil(dayCount/7)*7;
  return Array.from({length:total},(_,i)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+i));
}
export function normalizeRange(a:string,b:string):DateSelection {
  return {start:a<=b?a:b,end:a<=b?b:a};
}
export function selectMiniDate(previous:DateSelection,clicked:string):DateSelection {
  if(!previous.start||previous.end)return {start:clicked,end:null};
  return normalizeRange(previous.start,clicked);
}
export function withinSelectedRange(key:string,selection:DateSelection):boolean{
  if(!selection.start)return false;
  return key>=selection.start&&key<=(selection.end??selection.start);
}
export function selectedCalendarDays(week:Date,selection:DateSelection):Date[]{
  if(!selection.start||!selection.end)return Array.from({length:7},(_,i)=>new Date(week.getFullYear(),week.getMonth(),week.getDate()+i));
  const first=dateFromKey(selection.start);
  const last=dateFromKey(selection.end);
  const result:Date[]=[];
  for(let day=new Date(first);day<=last;day.setDate(day.getDate()+1)){
    result.push(new Date(day));
    // Protect the UI from pathological multi-year selections.
    if(result.length>=90)break;
  }
  return result;
}
export function shiftCalendarMonth(month:Date,step:number):Date{
  return new Date(month.getFullYear(),month.getMonth()+step,1);
}
