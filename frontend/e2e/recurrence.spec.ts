import {test,expect,type Page} from '@playwright/test';

const KEY='personalmanagement:pages-demo:v1';
function localDate(d:Date){
 return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
async function createDaily(page:Page,title:string){
 await page.goto('/');
 const monday=await page.evaluate(()=>{
   const date=new Date();
   date.setDate(date.getDate()-(date.getDay()+6)%7);
   return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
 });
 await page.locator('.topbar button.primary-btn').click();
 await page.locator('.drawer input').first().fill(title);
 await page.locator('.drawer input[type="datetime-local"]').first().fill(monday+'T09:00');
 await page.getByLabel('Повторять').selectOption('daily');
 await page.locator('.drawer button[type="submit"]').click();
 await expect(page.locator('.drawer')).toHaveCount(0);
 return monday;
}
async function store(page:Page){
 return page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'{}'),KEY);
}
async function openInstance(page:Page,title:string,position:number){
 const cards=page.locator('.cal-item.task-block',{hasText:title});
 await expect(cards).toHaveCount(7);
 const card=cards.nth(position);
 await card.scrollIntoViewIfNeeded();
 await card.evaluate(node=>{
   const scroller=node.closest('.calendar-scroll');
   if(scroller)scroller.scrollTop=Math.max(0,scroller.scrollTop-155);
 });
 await card.click();
 await expect(page.locator('.drawer')).toBeVisible();
}
test('daily task renders seven virtual occurrences with one stored master',async({page})=>{
 await createDaily(page,'Серия каждый день');
 await expect(page.locator('.cal-item.task-block',{hasText:'Серия каждый день'})).toHaveCount(7);
 const state=await store(page);
 const saved=state.tasks.filter(t=>t.title==='Серия каждый день');
 expect(saved).toHaveLength(1);
 expect(saved[0].recurrence).toBe('daily');
 expect(state.occurrences).toHaveLength(0);
 await page.reload();
 await expect(page.locator('.cal-item.task-block',{hasText:'Серия каждый день'})).toHaveCount(7);
});
test('editing only one occurrence leaves other dates intact',async({page})=>{
 const monday=await createDaily(page,'Одна дата серии');
 await openInstance(page,'Одна дата серии',2);
 await expect(page.getByLabel('Область изменения повторений')).toHaveValue('one');
 await page.locator('.drawer input').first().fill('Изменено только в среду');
 await page.locator('.drawer button[type="submit"]').click();
 const data=await store(page);
 const master=data.tasks.find(t=>t.title==='Одна дата серии');
 expect(master).toBeDefined();
 expect(data.occurrences).toHaveLength(1);
 expect(data.occurrences[0].task_id).toBe(master.id);
 expect(data.occurrences[0].changes.title).toBe('Изменено только в среду');
 expect(data.tasks.filter(t=>t.title==='Одна дата серии')).toHaveLength(1);
 await expect(page.locator('.cal-item.task-block',{hasText:'Изменено только в среду'})).toHaveCount(1);
 await expect(page.locator('.cal-item.task-block',{hasText:'Одна дата серии'})).toHaveCount(6);
});
test('future edit splits the stored series instead of expanding hundreds of tasks',async({page})=>{
 await createDaily(page,'Серия с разделением');
 await openInstance(page,'Серия с разделением',2);
 await page.getByLabel('Область изменения повторений').selectOption('future');
 await page.locator('.drawer input').first().fill('Новая серия после среды');
 await page.locator('.drawer button[type="submit"]').click();
 const data=await store(page);
 const old=data.tasks.find(t=>t.title==='Серия с разделением');
 const fresh=data.tasks.find(t=>t.title==='Новая серия после среды');
 expect(old).toBeDefined();expect(fresh).toBeDefined();
 expect(old.recurrence).toBe('daily');expect(fresh.recurrence).toBe('daily');
 expect(old.recurrence_until).toBeTruthy();
 expect(data.tasks.filter(t=>t.title.includes('серия')||t.title.includes('Серия'))).toHaveLength(2);
 await expect(page.locator('.cal-item.task-block',{hasText:'Новая серия после среды'})).toHaveCount(5);
 await expect(page.locator('.cal-item.task-block',{hasText:'Серия с разделением'})).toHaveCount(2);
});
test('a single dragged repeat persists as an exception, not a master update',async({page})=>{
 await createDaily(page,'Повтор перенос');
 const cards=page.locator('.cal-item.task-block',{hasText:'Повтор перенос'});
 const card=cards.nth(2);
 await card.scrollIntoViewIfNeeded();
 await card.evaluate(node=>{
   const scroll=node.closest('.calendar-scroll');
   if(scroll)scroll.scrollTop=Math.max(0,scroll.scrollTop-155);
 });
 const rect=await card.boundingBox();
 expect(rect).not.toBeNull();
 const x=rect!.x+Math.min(30,rect!.width/3),y=rect!.y+rect!.height/2;
 await page.mouse.move(x,y);
 await page.mouse.down();
 await page.mouse.move(x,y+41.34,{steps:8});
 await page.mouse.up();
 await expect.poll(async()=>(await store(page)).occurrences?.length).toBe(1);
 const data=await store(page);
 const master=data.tasks.find(t=>t.title==='Повтор перенос');
 expect(master.scheduled_at.slice(11,16)).toBe('09:00');
 expect(data.occurrences[0].changes.scheduled_at.slice(11,16)).toBe('10:00');
});

test('a completed occurrence remains in its calendar slot and can be reopened separately',async({page})=>{
 await createDaily(page,'Серия для завершения');
 await openInstance(page,'Серия для завершения',2);
 const drawer=page.getByRole('dialog');
 await drawer.getByRole('checkbox',{name:/Задача выполнена/}).check();
 await drawer.getByRole('button',{name:'Сохранить'}).click();
 await expect(drawer).toHaveCount(0);
 const cards=page.locator('.cal-item.task-block',{hasText:'Серия для завершения'});
 await expect(cards).toHaveCount(7);
 await expect(cards.nth(2)).toHaveClass(/cal-item-done/);
 await expect(page.locator('.cal-item-done',{hasText:'Серия для завершения'})).toHaveCount(1);
 await openInstance(page,'Серия для завершения',2);
 await expect(drawer.getByRole('checkbox',{name:/Задача выполнена/})).toBeChecked();
 await drawer.getByRole('checkbox',{name:/Задача выполнена/}).uncheck();
 await drawer.getByRole('button',{name:'Сохранить'}).click();
 await expect(cards).toHaveCount(7);
 await expect(cards.nth(2)).not.toHaveClass(/cal-item-done/);
});
