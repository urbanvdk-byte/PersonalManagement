import {test,expect,type Locator} from '@playwright/test';

async function revealTask(task:Locator){
  await task.scrollIntoViewIfNeeded();
  await task.evaluate(node=>{
    const scroller=node.closest('.calendar-scroll');
    if(!scroller)return;
    const bounds=node.getBoundingClientRect();
    const viewport=scroller.getBoundingClientRect();
    scroller.scrollTop+=bounds.top+bounds.height/2-(viewport.top+viewport.height/2);
  });
  await expect.poll(async()=>{
    return task.evaluate(node=>{
      const box=node.getBoundingClientRect();
      return document.elementFromPoint(box.x+Math.min(24,box.width/3),box.y+box.height/2)?.closest('.cal-item.task-block')===node;
    });
  }).toBe(true);
}


const STORAGE='personalmanagement:pages-demo:v1';
const taskTitle='Обсудить план проекта';
async function taskStart(page){
  return page.evaluate(key=>{
    const state=JSON.parse(localStorage.getItem(key)||'{}');
    return state.tasks.find(task=>task.title==='Обсудить план проекта')?.scheduled_at;
  },STORAGE);
}
async function taskDuration(page){
  return page.evaluate(key=>{
    const state=JSON.parse(localStorage.getItem(key)||'{}');
    return state.tasks.find(task=>task.title==='Обсудить план проекта')?.duration_minutes;
  },STORAGE);
}
test('mouse moves a task by two hours and persists its new schedule',async({page})=>{
  await page.goto('/');
  const task=page.locator('.cal-item.task-block',{hasText:taskTitle}).first();
  await revealTask(task);
  const box=await task.boundingBox();
  expect(box).not.toBeNull();
  const x=box!.x+Math.min(box!.width/2,35);
  const y=box!.y+box!.height/2;
  const before=await taskStart(page);
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y+82.67,{steps:12});
  await page.mouse.up();
  await expect.poll(()=>taskStart(page)).not.toBe(before);
  expect((await taskStart(page))?.slice(11,16)).toBe('12:00');
});
test('mouse bottom edge increases task duration in 15-minute steps',async({page})=>{
  await page.goto('/');
  const task=page.locator('.cal-item.task-block',{hasText:taskTitle}).first();
  await revealTask(task);
  const box=await task.boundingBox();
  expect(box).not.toBeNull();
  const x=box!.x+24;
  const y=box!.y+box!.height-2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y+10.34,{steps:8});
  await page.mouse.up();
  await expect.poll(()=>taskDuration(page)).toBe(75);
  expect((await taskStart(page))?.slice(11,16)).toBe('10:00');
});
test('mouse top edge moves start earlier while keeping the end fixed',async({page})=>{
  await page.goto('/');
  const task=page.locator('.cal-item.task-block',{hasText:taskTitle}).first();
  await revealTask(task);
  const box=await task.boundingBox();
  expect(box).not.toBeNull();
  const x=box!.x+24;
  const y=box!.y+2;
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x,y-10.34,{steps:8});
  await page.mouse.up();
  await expect.poll(()=>taskDuration(page)).toBe(75);
  expect((await taskStart(page))?.slice(11,16)).toBe('09:45');
});
test('phone long press moves task but a short tap opens editor',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage();
  await page.goto('/');
  const task=page.locator('.cal-item.task-block',{hasText:taskTitle}).first();
  await revealTask(task);
  const box=await task.boundingBox();
  expect(box).not.toBeNull();
  const x=box!.x+25;
  const y=box!.y+box!.height/2;
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await page.waitForTimeout(570);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+41.34}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(async()=>(await taskStart(page))?.slice(11,16)).toBe('11:00');
  await revealTask(task);
  const after=await task.boundingBox();
  expect(after).not.toBeNull();
  await page.touchscreen.tap(after!.x+25,after!.y+after!.height/2);
  await expect(page.getByRole('dialog')).toBeVisible();
  await context.close();
});

test('phone long press on bottom edge increases duration by one quarter hour',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage();
  await page.goto('/');
  const task=page.locator('.cal-item.task-block',{hasText:taskTitle}).first();
  await revealTask(task);
  const box=await task.boundingBox();
  expect(box).not.toBeNull();
  const x=box!.x+24;
  const y=box!.y+box!.height-2;
  const cdp=await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await page.waitForTimeout(570);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+10.34}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>taskDuration(page)).toBe(75);
  expect((await taskStart(page))?.slice(11,16)).toBe('10:00');
  await context.close();
});
