import {test,expect} from '@playwright/test';

test('simplified navigation and header omit branding, subtitles and obsolete priorities page',async({page})=>{
 await page.goto('/');
 const nav=page.locator('.sidebar');
 await expect(nav.getByRole('button',{name:'Приоритеты'})).toHaveCount(0);
 await expect(page.locator('.brand')).toHaveCount(0);
 await expect(page.locator('.hero-subtitle')).toHaveCount(0);
 await expect(page.locator('.top-title small')).toHaveCount(0);
 await expect(page.locator('.demo-banner')).toHaveCount(0);
 await nav.getByRole('button',{name:'Входящие'}).click();
 await expect(page.locator('.content-header p')).toHaveCount(0);
 await nav.getByRole('button',{name:'Все задачи'}).click();
 await expect(page.locator('.task-priority-matrix .collapsible-priority')).toHaveCount(4);
 await expect(page.locator('.content-header p')).toHaveCount(0);
});
test('each priority group has a thin outline matching its priority color',async({page})=>{
 await page.goto('/');
 await page.locator('.sidebar').getByRole('button',{name:'Все задачи'}).click();
 for(const [i,color] of [
   [1,'rgb(220, 101, 94)'],[2,'rgb(228, 170, 58)'],
   [3,'rgb(62, 143, 204)'],[4,'rgb(156, 167, 175)']
 ] as const){
  const details=page.locator('.task-priority-matrix .collapsible-priority.m'+i);
  const style=await details.evaluate(e=>{
    const s=getComputedStyle(e);
    return {width:s.borderTopWidth,top:s.borderTopColor,left:s.borderLeftColor,right:s.borderRightColor,bottom:s.borderBottomColor};
  });
  expect(style.width).toBe('1px');
  expect([style.top,style.left,style.right,style.bottom]).toEqual([color,color,color,color]);
 }
});
test('mobile hides overview KPIs and shows compact daily schedule without repetitive labels',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.goto('/');
 await expect(page.locator('.overview-strip')).toBeHidden();
 await page.getByRole('navigation',{name:'Мобильная навигация'}).getByRole('button',{name:'День'}).click();
 await expect(page.locator('.schedule-page')).toBeVisible();
 await expect(page.locator('.schedule-eyebrow')).toHaveCount(0);
 await expect(page.locator('.schedule-toolbar h2')).toHaveCount(0);
 await expect(page.locator('.schedule-toolbar .schedule-current-date')).toBeVisible();
 for(const label of ['задач и событий','Ритм под контролем','осталось выполнить']){
   await expect(page.locator('.schedule-summary')).not.toContainText(label);
 }
 const top=page.locator('.schedule-toolbar');
 const h=await top.evaluate(e=>e.getBoundingClientRect().height);
 expect(h).toBeLessThan(60);
 await expect(page.locator('.schedule-week .schedule-date')).toHaveCount(7);
});


test('calendar backlog has full names, resizable persistent width and no duplicate daily plan',async({page})=>{
 await page.setViewportSize({width:1600,height:1000});
 await page.goto('/');
 const panel=page.locator('#calendar-backlog-panel');
 const grip=page.getByRole('separator',{name:'Ширина панели незапланированных задач'});
 await expect(grip).toBeVisible();
 await expect(panel.locator('.day-plan-heading,.day-focus,.day-load,.day-plan-task-list')).toHaveCount(0);
 const title=panel.locator('.backlog-task strong').first();
 await expect(title).toBeVisible();
 const style=await title.evaluate(e=>({whiteSpace:getComputedStyle(e).whiteSpace,overflow:getComputedStyle(e).overflow}));
 expect(style).toEqual({whiteSpace:'normal',overflow:'visible'});
 const before=(await panel.boundingBox())!.width;
 const bounds=(await grip.boundingBox())!;
 await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
 await page.mouse.down();
 await page.mouse.move(bounds.x+bounds.width/2-100,bounds.y+bounds.height/2,{steps:5});
 await page.mouse.up();
 await expect.poll(async()=>(await panel.boundingBox())!.width).toBeGreaterThan(before+70);
 const after=(await panel.boundingBox())!.width;
 await page.reload();
 await expect.poll(async()=>(await panel.boundingBox())!.width).toBeCloseTo(after,0);
 await grip.focus();
 await page.keyboard.press('ArrowRight');
 await expect.poll(async()=>(await panel.boundingBox())!.width).toBeLessThan(after);
 await page.setViewportSize({width:390,height:844});
 await expect(grip).toBeHidden();
 await expect(panel).toBeVisible();
 await expect.poll(async()=>await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
});
