import {test,expect} from '@playwright/test';

const STORAGE='personalmanagement:pages-demo:v1';
async function state(page){
 return page.evaluate(k=>JSON.parse(localStorage.getItem(k)||'{}'),STORAGE);
}
test('quick capture enters inbox without scheduling',async({page})=>{
 await page.goto('/');
 const input=page.getByRole('textbox',{name:'Быстрая запись задачи'});
 await input.fill('Моментальное дело');
 await input.press('Enter');
 await expect(input).toHaveValue('');
 const task=(await state(page)).tasks.find(t=>t.title==='Моментальное дело');
 expect(task).toBeDefined();expect(task.scheduled_at).toBeNull();expect(task.status).toBe('inbox');
 await expect(page.locator('.backlog-task',{hasText:'Моментальное дело'})).toHaveCount(1);
});
test('the day plan is adjacent to calendar and contains focus and workload',async({page})=>{
 await page.goto('/');
 const panel=page.locator('.day-panel');
 await expect(panel.getByText('Три главных дела')).toBeVisible();
 await expect(panel.getByText('Загрузка дня')).toBeVisible();
 await expect(page.locator('.backlog-toggle button')).toHaveAttribute('aria-expanded','true');
 await page.locator('.backlog-toggle button').click();
 await expect(page.locator('.backlog-toggle button')).toHaveAttribute('aria-expanded','false');
});
test('calendar tomorrow button preserves original time and saves it',async({page})=>{
 await page.goto('/');
 const btn=page.locator('.cal-tomorrow').first();
 await btn.scrollIntoViewIfNeeded();
 const card=btn.locator('xpath=..');
 const title=await card.locator('strong').first().innerText();
 const start=await state(page);
 const task=start.tasks.find(t=>title.includes(t.title));
 expect(task).toBeDefined();
 await btn.click();
 await expect.poll(async()=>{
    const data=await state(page);
    return data.tasks.find(t=>t.id===task.id)?.scheduled_at;
 }).not.toBe(task.scheduled_at);
 const now=await state(page);
 expect(now.tasks.find(t=>t.id===task.id).scheduled_at.slice(11,16)).toBe(task.scheduled_at.slice(11,16));
});
test('task drawer checklist and project milestone persist without changing master',async({page})=>{
 await page.goto('/');
 await page.locator('.nav-item',{hasText:'Проекты'}).click();
 await page.locator('.project-entry').first().click();
 const project=page.locator('.project-workspace');
 await expect(project).toBeVisible();
 await project.getByRole('textbox',{name:'Название нового этапа'}).fill('Новый контрольный этап');
 await project.locator('.milestone-add button').click();
 await expect(project).toContainText('Новый контрольный этап');
 const milestone=(await state(page)).milestones.find(m=>m.title==='Новый контрольный этап');
 expect(milestone).toBeDefined();
 await page.getByRole('button',{name:'Все проекты'}).click();
 await page.locator('.nav-item',{hasText:'Все задачи'}).click();
 await page.locator('.task-main').first().click();
 await page.getByRole('textbox',{name:'Новый пункт чек-листа'}).fill('Новый пункт проверки');
 await page.locator('.checklist-add button').click();
 await expect(page.locator('.checklist-editor')).toContainText('Новый пункт проверки');
 expect((await state(page)).checklist.some(x=>x.title==='Новый пункт проверки')).toBe(true);
});

test('dragging an unscheduled task onto a calendar day assigns a real time',async({page})=>{
 await page.goto('/');
 const field=page.getByRole('textbox',{name:'Быстрая запись задачи'});
 await field.fill('Задача для перетаскивания');await field.press('Enter');
 const backlog=page.locator('.backlog-task',{hasText:'Задача для перетаскивания'});
 const scroller=page.locator('.calendar-scroll');
 const track=page.locator('[data-calendar-day]').first();
 await expect(backlog).toBeVisible();
 await backlog.scrollIntoViewIfNeeded();
 const original=await state(page);
 const task=original.tasks.find(t=>t.title==='Задача для перетаскивания');
 expect(task.scheduled_at).toBeNull();
 const origin=await backlog.boundingBox(),dest=await track.boundingBox(),viewport=await scroller.boundingBox();
 expect(origin).not.toBeNull();expect(dest).not.toBeNull();expect(viewport).not.toBeNull();
 const startX=origin!.x+25,startY=origin!.y+origin!.height/2;
 console.log('START_HIT',JSON.stringify(await page.evaluate(({x,y})=>({
  hit:document.elementFromPoint(x,y)?.outerHTML.slice(0,300),
  viewport:{height:innerHeight,width:innerWidth}
 }),{x:startX,y:startY})));
 const endX=dest!.x+Math.min(20,dest!.width/3),endY=viewport!.y+viewport!.height/2;
 await page.mouse.move(startX,startY);
 await page.mouse.down();
 await page.mouse.move(endX,endY,{steps:12});
 console.log('DROP_HIT',JSON.stringify(await page.evaluate(({x,y})=>{
  const hit=document.elementFromPoint(x,y);
  const track=document.querySelector('[data-calendar-day]');
  const pane=document.querySelector('.calendar-scroll');
  return {hit:hit?.className,closest:hit?.closest('[data-calendar-day]')?.getAttribute('data-calendar-day'),
  trackRect:track?.getBoundingClientRect().toJSON(),paneRect:pane?.getBoundingClientRect().toJSON()};
 },{x:endX,y:endY})));
 await page.mouse.up();
 console.log('DROP_STATE',JSON.stringify(await page.evaluate(()=>({
  error:document.querySelector('.backlog-error')?.textContent,
  ghost:document.querySelector('.backlog-ghost')?.textContent,
  task:JSON.parse(localStorage.getItem('personalmanagement:pages-demo:v1')||'{}').tasks?.find(t=>t.title==='Задача для перетаскивания')
 }))));
 await expect.poll(async()=>(await state(page)).tasks.find(t=>t.id===task.id)?.scheduled_at).not.toBeNull();
 await expect(backlog).toHaveCount(0);
});
test('double touch on mobile moves just one appointment to tomorrow',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 const page=await context.newPage();
 await page.goto('/');
 const task=page.locator('.cal-item.task-block',{hasText:'Обсудить план проекта'}).first();
 await task.scrollIntoViewIfNeeded();
 await task.evaluate(node=>{
   const scroller=node.closest('.calendar-scroll');
   if(scroller)scroller.scrollTop=Math.max(0,scroller.scrollTop-150);
 });
 const rect=await task.boundingBox();
 expect(rect).not.toBeNull();
 const x=rect!.x+Math.min(28,rect!.width/3),y=rect!.y+rect!.height/2;
 const id=await task.evaluate(node=>Number(node.getAttribute('data-layout-column'))); // Touch target sanity check
 expect(id).not.toBeNaN();
 const cdp=await context.newCDPSession(page);
 const stateBefore=await state(page);
 const initialTask=stateBefore.tasks.find(t=>t.scheduled_at&&t.title.includes('Обсудить план проекта'));
 console.log('TAP_TARGET',JSON.stringify(await page.evaluate(({x,y})=>({
    element:document.elementFromPoint(x,y)?.outerHTML.slice(0,380),
    rect:document.querySelector('.cal-item.task-block')?.getBoundingClientRect().toJSON()
 }),{x,y})));
 for(let n=0;n<2;n++){
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.waitForTimeout(90);
 }
 console.log('TAP_STATE',JSON.stringify(await page.evaluate(()=>({
    dialog:document.querySelector('.drawer')?.textContent?.slice(0,120),
    task:JSON.parse(localStorage.getItem('personalmanagement:pages-demo:v1')||'{}').tasks?.find(t=>t.title==='Обсудить план проекта')
 }))));
 await expect.poll(async()=>(await state(page)).tasks.find(t=>t.id===initialTask?.id)?.scheduled_at).not.toBe(initialTask?.scheduled_at);
 await expect(page.locator('.drawer')).toHaveCount(0);
 await context.close();
});
