import type {Store,Task} from './types';
import {areaEmoji} from './taskPalette.ts';
export const HOLIDAY_TYPES={birthday:'🎂 День рождения',public:'🎉 Государственный праздник',anniversary:'✨ Годовщина',event:'🎈 Событие',other:'🪩 Прочее'} as const;
export type HolidayType=keyof typeof HOLIDAY_TYPES;
export const isHolidayType=(value:unknown):value is HolidayType=>typeof value==='string'&&Object.prototype.hasOwnProperty.call(HOLIDAY_TYPES,value);
export const isHoliday=(task:Task)=>isHolidayType(task.holiday_type);
export function validHolidayDate(value:unknown):boolean{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))return false;
 const date=new Date(value+'T00:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function holidayLabel(task:Task,store:Store){
 const category=isHolidayType(task.holiday_type)?HOLIDAY_TYPES[task.holiday_type].split(' ')[0]:'';
 const area=store.areas.find(a=>a.id===task.area_id);
 return category+(area?areaEmoji(area.emoji):'')+' '+task.title;
}
/** All holiday categories repeat annually from the original date. */
export function holidayOccursOn(task:Task,day:string):boolean{
 const first=task.holiday_date;
 if(!isHoliday(task)||task.status==='cancelled'||!first||!validHolidayDate(first)||!validHolidayDate(day)||day<first)return false;
 const monthDay=first.slice(5);
 if(day.slice(5)===monthDay)return true;
 // Match the existing yearly recurrence convention for leap-day anniversaries.
 const year=Number(day.slice(0,4));
 const leap=year%4===0&&(year%100!==0||year%400===0);
 return monthDay==='02-29'&&!leap&&day.slice(5)==='02-28';
}
export function holidaysOn(store:Store,day:string){
 return store.tasks.filter(t=>holidayOccursOn(t,day)).sort((a,b)=>a.title.localeCompare(b.title,'ru')||a.id-b.id);
}
