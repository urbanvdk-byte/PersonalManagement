import {addDays,dateTimeLocal,dayKey,makeDay} from './date';
import type {Task,TaskOccurrence} from './types';

export const RECURRENCES={ '':'Не повторяется',daily:'Каждый день',weekly:'Каждую неделю',monthly:'Каждый месяц',yearly:'Каждый год'} as const;
export type Recurrence=keyof typeof RECURRENCES;
const leap=(year:number)=>year%4===0&&(year%100!==0||year%400===0);
const lastDay=(year:number,month:number)=>new Date(year,month,0).getDate();
function daysBetween(first:Date,second:Date){
 return Math.round((Date.UTC(second.getFullYear(),second.getMonth(),second.getDate())-
   Date.UTC(first.getFullYear(),first.getMonth(),first.getDate()))/86400000);
}
export function isOccurrenceDate(task:Task,key:string):boolean{
 if(!task.scheduled_at)return false;
 const first=task.scheduled_at.slice(0,10);
 if(key<first||task.recurrence_until&&key>task.recurrence_until)return false;
 if(!task.recurrence)return key===first;
 const start=makeDay(first),at=makeDay(key);
 if(dayKey(at)!==key)return false;
 const difference=daysBetween(start,at);
 if(difference<0)return false;
 switch(task.recurrence){
  case 'daily':return true;
  case 'weekly':return difference%7===0;
  case 'monthly':return at.getDate()===Math.min(start.getDate(),lastDay(at.getFullYear(),at.getMonth()+1));
  case 'yearly':{
    if(at.getMonth()!==start.getMonth())return false;
    const date=start.getMonth()===1&&start.getDate()===29&&!leap(at.getFullYear())?28:start.getDate();
    return at.getDate()===date;
  }
  default:return key===first;
 }
}
function makeInstance(task:Task,key:string,changes:Record<string,unknown>={}):Task{
 const scheduled_at=key+task.scheduled_at!.slice(10);
 return {...task,scheduled_at,occurrence_date:key,...changes};
}
/** Virtual calendar instances. Exceptions are sparse rows, never bulk-generated. */
export function expandTasks(tasks:readonly Task[],occurrences:readonly TaskOccurrence[],
 start:string,end:string):Task[]{
 const exceptions=new Map<string,TaskOccurrence>();
 for(const exception of occurrences)exceptions.set(exception.task_id+'@'+exception.occurrence_date,exception);
 const result:Task[]=[];
 for(const task of tasks){
  if(!task.scheduled_at)continue;
  if(!task.recurrence){
   const key=task.scheduled_at.slice(0,10);
   if(key>=start&&key<=end)result.push(task);
   continue;
  }
  const from=start>task.scheduled_at.slice(0,10)?start:task.scheduled_at.slice(0,10);
  for(let at=makeDay(from),limit=0;dayKey(at)<=end&&limit++<370;at=addDays(at,1)){
   const key=dayKey(at);
   if(!isOccurrenceDate(task,key))continue;
   const exception=exceptions.get(task.id+'@'+key);
   if(exception?.changes?.status==='cancelled'||exception?.changes?.status==='done')continue;
   const view=makeInstance(task,key,exception?.changes||{});
   if(view.scheduled_at?.slice(0,10)>=start&&view.scheduled_at.slice(0,10)<=end)result.push(view);
  }
  // A moved occurrence must appear at the new date even when its original date
  // falls outside the visible range. Avoid duplicate from the loop above.
  for(const exception of occurrences){
   if(exception.task_id!==task.id||!isOccurrenceDate(task,exception.occurrence_date))continue;
   const scheduled=String(exception.changes?.scheduled_at||'');
   if(!scheduled||scheduled.slice(0,10)<start||scheduled.slice(0,10)>end)continue;
   if(exception.occurrence_date>=from&&exception.occurrence_date<=end)continue;
   if(['cancelled','done'].includes(String(exception.changes?.status||'')))continue;
   result.push(makeInstance(task,exception.occurrence_date,exception.changes));
  }
 }
 return result.filter(task=>task.status!=='done'&&task.status!=='cancelled');
}
export function occurrenceAt(task:Task,key:string,occurrences:readonly TaskOccurrence[]):Task{
 const exception=occurrences.find(x=>x.task_id===task.id&&x.occurrence_date===key);
 return makeInstance(task,key,exception?.changes||{});
}
export function beforeDate(key:string):string{return dayKey(addDays(makeDay(key),-1));}
export function transferSeriesStart(task:Task,occurrence:string,scheduledAt:string):string {
 // Whole series edits keep its original anchor date but change the clock time.
 return task.scheduled_at!.slice(0,10)+scheduledAt.slice(10);
}
