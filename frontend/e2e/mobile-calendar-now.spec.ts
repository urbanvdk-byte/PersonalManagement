import {test,expect} from '@playwright/test';

const KEY='personalmanagement:pages-demo:v1';
const PINNED=new Date('2026-11-19T12:40:00');

test('mobile calendar starts centered on today and actions stay on one row',async({page})=>{
 await page.clock.install({time:PINNED});
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 const scroller=page.locator('.calendar-scroll');
 const today=page.locator('.day-head.selected');
 await expect(today).toContainText('19');
 await expect.poll(async()=>scroller.evaluate(e=>e.scrollLeft)).toBeGreaterThan(100);
 const alignment=await today.evaluate(el=>{
   const head=el.getBoundingClientRect();
   const outer=el.closest('.calendar-scroll')!.getBoundingClientRect();
   return Math.abs(head.left+head.width/2-(outer.left+outer.width/2));
 });
 expect(alignment).toBeLessThan(20);
 const top=page.locator('.topbar .top-actions');
 const todayButton=top.getByRole('button',{name:'Сегодня'});
 const taskButton=top.getByRole('button',{name:'Задача'});
 const todayBox=await todayButton.boundingBox(),taskBox=await taskButton.boundingBox();
 expect(todayBox&&taskBox).toBeTruthy();
 expect(Math.abs(todayBox!.y+todayBox!.height/2-(taskBox!.y+taskBox!.height/2))).toBeLessThan(12);
 const outer=await top.boundingBox();
 expect(taskBox!.x+taskBox!.width).toBeLessThanOrEqual(outer!.x+outer!.width+1);
 await expect(top.locator('.week-range-mobile')).toBeVisible();
 await expect(top.locator('.week-range-desktop')).toBeHidden();
});
test('day schedule hides quick capture, renders task color, marks current time and centers on it',async({page})=>{
 await page.clock.install({time:PINNED});
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 await page.evaluate(key=>{
   const db=JSON.parse(localStorage.getItem(key)||'{}');
   const base=db.tasks[0];
   for(let i=0;i<8;i++){
     db.tasks.push({...base,id:8000+i,title:'Контроль '+i,scheduled_at:
       '2026-11-19T'+String(7+i*2).padStart(2,'0')+':00',
       duration_minutes:90,priority:2,recurrence:'',occurrence_date:undefined,
       status:'planned',color:i===3?'#39aa6f':'#3466d9'});
   }
   localStorage.setItem(key,JSON.stringify(db));
 },KEY);
 await page.reload();
 await page.getByRole('navigation',{name:'Мобильная навигация'})
   .getByRole('button',{name:'День'}).click();
 await expect(page.locator('.quick-capture')).toHaveCount(0);
 await expect(page.locator('.schedule-now-marker')).toHaveCount(1);
 const marker=page.locator('.schedule-now-marker');
 await expect(marker).toHaveAttribute('aria-label','Текущее время 12:40');
 await expect.poll(async()=>marker.evaluate(e=>{
    const bounds=e.getBoundingClientRect();
    return Math.abs(bounds.top+bounds.height/2-innerHeight/2);
 })).toBeLessThan(150);
 const green=page.locator('.schedule-entry-card.schedule-task',{hasText:'Контроль 3'});
 await expect(green).toBeVisible();
 expect(await green.evaluate(e=>getComputedStyle(e).borderTopColor)).toBe('rgb(57, 170, 111)');
});
test('opening daily schedule from another selected day returns to today and its clock marker',async({page})=>{
 await page.clock.install({time:PINNED});
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 const bottom=page.getByRole('navigation',{name:'Мобильная навигация'});
 await bottom.getByRole('button',{name:'День'}).click();
 await page.getByRole('button',{name:'Следующий день'}).click();
 await expect(page.locator('.schedule-now-marker')).toHaveCount(0);
 await bottom.getByRole('button',{name:'Календарь'}).click();
 await bottom.getByRole('button',{name:'День'}).click();
 await expect(page.locator('.schedule-current-date')).toContainText('19');
 await expect(page.locator('.schedule-now-marker')).toHaveCount(1);
});
