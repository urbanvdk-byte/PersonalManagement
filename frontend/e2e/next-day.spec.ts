import {test,expect} from '@playwright/test';

const KEY='personalmanagement:pages-demo:v1';
const stamp=(day:string,time:string)=>day+'T'+time;
const getStore=(page)=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'{}'),KEY);
async function injectSchedule(page,repeat=false){
 await page.goto('/');
 return page.evaluate(({key,repeat})=>{
   const data=JSON.parse(localStorage.getItem(key)||'{}');
   const d=new Date();
   d.setDate(d.getDate()-(d.getDay()+6)%7);
   const keyFor=(extra:number)=>{
     const at=new Date(d);at.setDate(at.getDate()+extra);
     return [at.getFullYear(),String(at.getMonth()+1).padStart(2,'0'),String(at.getDate()).padStart(2,'0')].join('-');
   };
   const mon=keyFor(0),tue=keyFor(1),wed=keyFor(2);
   Object.assign(data.tasks[0],{title:'Поесть',status:'planned',scheduled_at:mon+'T17:00',
     duration_minutes:60,recurrence:repeat?'daily':'',recurrence_until:null});
   const meeting=data.tasks.find(t=>t.title==='Личное время');
   Object.assign(meeting,{scheduled_at:mon+'T19:00',duration_minutes:60});
   data.occurrences=[];
   localStorage.setItem(key,JSON.stringify(data));
   return {mon,tue,wed,taskId:data.tasks[0].id,eventId:meeting.id};
 },{key:KEY,repeat});
}
test('arrow works every time: Поесть 20 -> 21 -> 22, retaining 17:00',async({page})=>{
 const dates=await injectSchedule(page);
 await page.reload();
 const btn=page.getByRole('button',{name:'Перенести на следующий день: Поесть'});
 await btn.scrollIntoViewIfNeeded();
 await btn.click();
 await expect.poll(async()=> (await getStore(page)).tasks.find(t=>t.id===dates.taskId).scheduled_at)
   .toBe(stamp(dates.tue,'17:00'));
 await btn.scrollIntoViewIfNeeded();
 await btn.click();
 await expect.poll(async()=> (await getStore(page)).tasks.find(t=>t.id===dates.taskId).scheduled_at)
   .toBe(stamp(dates.wed,'17:00'));
 await expect(btn).toHaveCount(1);
});
test('event also has arrow: moving Личное время repeatedly preserves duration',async({page})=>{
 const dates=await injectSchedule(page);
 await page.reload();
 const btn=page.getByRole('button',{name:'Перенести на следующий день: Личное время'});
 await btn.scrollIntoViewIfNeeded();
 await btn.click();
 await expect.poll(async()=> (await getStore(page)).tasks.find(e=>e.id===dates.eventId).scheduled_at)
   .toBe(stamp(dates.tue,'19:00'));
 await btn.scrollIntoViewIfNeeded();
 await btn.click();
 await expect.poll(async()=> (await getStore(page)).tasks.find(e=>e.id===dates.eventId).scheduled_at)
   .toBe(stamp(dates.wed,'19:00'));
 expect((await getStore(page)).tasks.find(e=>e.id===dates.eventId).duration_minutes).toBe(60);
});
test('daily recurrence: moving original instance twice updates only that exception',async({page})=>{
 const dates=await injectSchedule(page,true);
 await page.reload();
 let original=page.locator('.cal-item.task-block[data-occurrence-date="'+dates.mon+'"]');
 const btn=original.getByRole('button',{name:'Перенести на следующий день: Поесть'});
 await btn.scrollIntoViewIfNeeded();
 await btn.click();
 await expect.poll(async()=>{
   const data=await getStore(page);
   return data.occurrences.find(o=>o.task_id===dates.taskId&&o.occurrence_date===dates.mon)?.changes.scheduled_at;
 }).toBe(stamp(dates.tue,'17:00'));
 original=page.locator('.cal-item.task-block[data-occurrence-date="'+dates.mon+'"]');
 await original.getByRole('button',{name:'Перенести на следующий день: Поесть'}).scrollIntoViewIfNeeded();
 await original.getByRole('button',{name:'Перенести на следующий день: Поесть'}).click();
 await expect.poll(async()=>{
   const data=await getStore(page);
   return data.occurrences.find(o=>o.task_id===dates.taskId&&o.occurrence_date===dates.mon)?.changes.scheduled_at;
 }).toBe(stamp(dates.wed,'17:00'));
 const saved=await getStore(page);
 expect(saved.tasks.find(t=>t.id===dates.taskId).scheduled_at).toBe(stamp(dates.mon,'17:00'));
 expect(saved.occurrences.filter(o=>o.task_id===dates.taskId)).toHaveLength(1);
});
