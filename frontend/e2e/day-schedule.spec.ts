import {test,expect} from '@playwright/test';

const KEY='personalmanagement:pages-demo:v1';
test('Daily Schedule shows same tasks as weekly calendar and edits the shared task',async({page})=>{
 await page.goto('/');
 await page.locator('.nav-item',{hasText:'Расписание дня'}).click();
 const schedule=page.locator('.schedule-page');
 await expect(schedule).toBeVisible();
 await expect(schedule.locator('.schedule-date')).toHaveCount(7);
 await expect(schedule.getByRole('heading',{name:'План по времени'})).toBeVisible();
 const demo=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'{}'),KEY);
 const t=demo.tasks.find(t=>t.scheduled_at&&t.title==='Обсудить план проекта');
 expect(t).toBeDefined();
 const key=t.scheduled_at.slice(0,10);
 await page.locator('.schedule-toolbar .schedule-today').click();
 const dateButton=page.locator('.schedule-date[aria-label]');
 const target=dateButton.filter({hasText:String(Number(key.slice(8,10)))}).first();
 // The seed task may fall outside the current week; use the public adjacent-day controls.
 for(let n=0;n<21;n++){
   const current=await page.locator('.schedule-toolbar p').innerText();
   if((await schedule.getByRole('button',{name:t.title,exact:true}).count())>0)break;
   await page.getByRole('button',{name:'Следующий день'}).click();
 }
 await expect(schedule.getByRole('button',{name:t.title,exact:true})).toBeVisible();
 await schedule.getByRole('button',{name:t.title,exact:true}).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('dialog').locator('input').first()).toHaveValue(t.title);
});
test('daily schedule day pills switch dates and an add action pre-fills the chosen date',async({page})=>{
 await page.goto('/');
 await page.locator('.nav-item',{hasText:'Расписание дня'}).click();
 const dates=page.locator('.schedule-date');
 await expect(dates).toHaveCount(7);
 await dates.nth(2).click();
 await expect(dates.nth(2)).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Добавить задачу на день'}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog).toBeVisible();
 const chosen=await dialog.locator('input[type="datetime-local"]').first().inputValue();
 expect(chosen).toMatch(/^\d{4}-\d{2}-\d{2}T09:00$/);
 await expect(dialog.locator('input[type="datetime-local"]').first()).toHaveAttribute('required','');
});
test('mobile has bottom navigation to daily schedule and keeps old planner available',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 const bottom=page.getByRole('navigation',{name:'Мобильная навигация'});
 await expect(bottom).toBeVisible();
 await bottom.getByRole('button',{name:'День'}).click();
 await expect(page.locator('.schedule-page')).toBeVisible();
 const cards=page.locator('.schedule-entry-card');
 await expect(page.locator('.schedule-date')).toHaveCount(7);
 await bottom.getByRole('button',{name:'Календарь'}).click();
 await expect(page.locator('.calendar-layout')).toBeVisible();
});
test('light theme is applied to sidebar and calendar header',async({page})=>{
 await page.goto('/');
 const sidebar=page.locator('.sidebar');
 const color=await sidebar.evaluate(e=>getComputedStyle(e).backgroundColor);
 expect(color).toBe('rgb(255, 255, 255)');
 const header=await page.locator('.topbar').evaluate(e=>getComputedStyle(e).backgroundColor);
 expect(header).toBe('rgb(255, 255, 255)');
 await expect(page.locator('.day-head')).toHaveCount(7);
});

test('completed tasks and meetings stay in the day timeline and can be reopened',async({page})=>{
 await page.goto('/');
 await page.locator('.nav-item',{hasText:'Расписание дня'}).click();
 const schedule=page.locator('.schedule-page');
 for(const title of ['Обсудить план проекта','Тестовая встреча']){
   const complete=schedule.getByRole('button',{name:'Выполнить: '+title,exact:true});
   await expect(complete).toBeVisible();
   const entry=schedule.locator('.schedule-entry').filter({has:page.getByRole('button',{name:title,exact:true})});
   const time=await entry.locator('.schedule-time-col').innerText();
   await complete.click();
   if(title==='Обсудить план проекта')await page.getByRole('dialog',{name:'Вклад в цель'}).getByRole('button',{name:'НЕТ',exact:true}).click();
   const undo=schedule.getByRole('button',{name:'Отменить выполнение: '+title,exact:true});
   await expect(undo).toBeVisible();
   await expect(entry).toHaveClass(/schedule-entry-done/);
   await expect(entry.locator('.schedule-time-col')).toHaveText(time,{useInnerText:true});
   await undo.click();
   await expect(complete).toBeVisible();
 }
});

test('completed task remains gray in calendar and can be reopened in editor on desktop and mobile',async({page})=>{
 await page.goto('/');
 await page.locator('.nav-item',{hasText:'Расписание дня'}).click();
 const title='Обсудить план проекта';
 await page.getByRole('button',{name:'Выполнить: '+title,exact:true}).click();
 await page.getByRole('dialog',{name:'Вклад в цель'}).getByRole('button',{name:'НЕТ',exact:true}).click();
 await expect(page.getByRole('button',{name:'Отменить выполнение: '+title,exact:true})).toBeVisible();
 await page.locator('.nav-item',{hasText:'Календарь'}).click();
 const card=page.locator('.cal-item.task-block',{hasText:title});
 await expect(card).toHaveClass(/cal-item-done/);
 const original=await card.evaluate(e=>({top:e.style.top,height:e.style.height}));
 await expect.poll(()=>card.evaluate(e=>Number(getComputedStyle(e).opacity))).toBeLessThan(1);
 await card.scrollIntoViewIfNeeded();
 await card.click();
 const drawer=page.getByRole('dialog');
 await expect(drawer.getByRole('checkbox',{name:/Задача выполнена/})).toBeChecked();
 await drawer.getByRole('checkbox',{name:/Задача выполнена/}).uncheck();
 await drawer.getByRole('button',{name:'Сохранить'}).click();
 await expect(card).not.toHaveClass(/cal-item-done/);
 expect(await card.evaluate(e=>({top:e.style.top,height:e.style.height}))).toEqual(original);
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('navigation',{name:'Мобильная навигация'}).getByRole('button',{name:'День',exact:true}).click();
 await page.getByRole('button',{name:'Выполнить: '+title,exact:true}).click();
 await page.getByRole('dialog',{name:'Вклад в цель'}).getByRole('button',{name:'НЕТ',exact:true}).click();
 await page.getByRole('button',{name:title,exact:true}).click();
 await expect(drawer.getByRole('checkbox',{name:/Задача выполнена/})).toBeChecked();
 await drawer.getByRole('checkbox',{name:/Задача выполнена/}).uncheck();
 await drawer.getByRole('button',{name:'Сохранить'}).click();
 await expect(page.getByRole('button',{name:'Выполнить: '+title,exact:true})).toBeVisible();
});

test('goal contribution is applied only when confirmed and zero is allowed',async({page})=>{
 await page.goto('/');
 await page.locator('.nav-item',{hasText:'Расписание дня'}).click();
 const title='Обсудить план проекта';
 const goal=async()=>page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'{}').goals.find(g=>g.id===2).current_value,KEY);
 const before=await goal();
 const complete=page.getByRole('button',{name:'Выполнить: '+title,exact:true});
 const undo=page.getByRole('button',{name:'Отменить выполнение: '+title,exact:true});
 const modal=page.getByRole('dialog',{name:'Вклад в цель'});
 await complete.click();
 await modal.getByRole('spinbutton',{name:'Величина вклада'}).fill('2');
 await modal.getByRole('button',{name:'ДА',exact:true}).click();
 await expect(undo).toBeVisible();
 expect(await goal()).toBe(before+2);
 await undo.click();
 await complete.click();
 await modal.getByRole('spinbutton',{name:'Величина вклада'}).fill('1');
 await modal.getByRole('button',{name:'НЕТ',exact:true}).click();
 await expect(undo).toBeVisible();
 expect(await goal()).toBe(before+2);
 await undo.click();
 await complete.click();
 await modal.getByRole('button',{name:'ДА',exact:true}).click();
 await expect(undo).toBeVisible();
 expect(await goal()).toBe(before+2);
});
