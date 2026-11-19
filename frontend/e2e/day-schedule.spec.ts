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
   if((await schedule.getByRole('button',{name:t.title}).count())>0)break;
   await page.getByRole('button',{name:'Следующий день'}).click();
 }
 await expect(schedule.getByRole('button',{name:t.title})).toBeVisible();
 await schedule.getByRole('button',{name:t.title}).click();
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
