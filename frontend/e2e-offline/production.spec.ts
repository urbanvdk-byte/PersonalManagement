import {test,expect,request as apiRequest} from '@playwright/test';

test('production opens offline, retains edits after reload and syncs them once',async({page,context})=>{
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Календарь'})).toBeVisible();
 await expect(page.getByText('Данные синхронизированы')).toBeVisible();
 const active=await page.evaluate(async()=>{
  const registration=await navigator.serviceWorker.ready;
  return Boolean(registration.active);
 });
 expect(active).toBe(true);

 await context.setOffline(true);
 await page.reload();
 await expect(page.getByText('Без интернета')).toBeVisible();
 const name='Офлайн задача '+Date.now();
 await page.getByRole('textbox',{name:'Быстрая запись задачи'}).fill(name);
 await page.locator('.quick-capture').getByRole('button',{name:'Добавить'}).click();
 await expect(page.getByText('1 изменений ожидают отправки')).toBeVisible();

 await page.reload();
 await expect(page.getByText('Без интернета')).toBeVisible();
 await expect(page.getByText(name)).toBeVisible();

 await context.setOffline(false);
 await expect(page.getByText('Данные синхронизированы')).toBeVisible({timeout:30_000});
 const tasks=await page.evaluate(async()=>{
  const response=await fetch('/api/bootstrap',{cache:'no-store'});
  if(!response.ok)throw Error('bootstrap '+response.status);
  return (await response.json()).tasks as Array<{title:string}>;
 });
 expect(tasks.filter(task=>task.title===name)).toHaveLength(1);
});


test('offline project, qualitative goal and task keep their relationships during ID remapping',async({page,context})=>{
 await page.goto('/');
 await expect(page.getByText('Данные синхронизированы')).toBeVisible();
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await context.setOffline(true);
 await expect(page.getByText('Без интернета')).toBeVisible();

 const project='Офлайн связанный проект '+Date.now();
 const task='Задача связанного проекта '+Date.now();
 const goal='Цель связанного проекта '+Date.now();
 await page.locator('.sidebar').getByRole('button',{name:'Проекты'}).click();
 await page.locator('.content-header').getByRole('button',{name:'Проект'}).click();
 let drawer=page.getByRole('dialog',{name:'Редактирование'});
 await drawer.locator('input').first().fill(project);
 await drawer.getByRole('button',{name:'Сохранить'}).click();
 const card=page.getByRole('button',{name:'Открыть проект '+project});
 await expect(card).toBeVisible();
 await card.click();
 const goals=page.locator('.project-workspace .project-section').filter({has:page.getByRole('heading',{name:'Цели',exact:true})});
 await goals.getByRole('textbox',{name:'Название новой цели'}).fill(goal);
 await goals.locator('input[type=date]').fill('2026-12-07');
 await goals.getByRole('button',{name:'Добавить',exact:true}).click();
 await expect(goals.getByText(goal,{exact:true})).toBeVisible();

 await page.locator('.project-workspace .project-section').filter({
  has:page.getByRole('heading',{name:'Задачи'})
 }).getByRole('button',{name:'Задача'}).click();
 drawer=page.getByRole('dialog',{name:'Редактирование'});
 await drawer.locator('input').first().fill(task);
 await drawer.locator('label.form-field').filter({has:page.locator('span').filter({hasText:/^Цель$/})}).locator('select').selectOption({label:goal});
 await drawer.getByRole('button',{name:'Сохранить'}).click();
 await expect(page.locator('.project-workspace .task-list').getByText(task).first()).toBeVisible();
 await expect(page.getByText('3 изменений ожидают отправки')).toBeVisible();

 await context.setOffline(false);
 await expect(page.getByText('Данные синхронизированы')).toBeVisible({timeout:30_000});
 const remote=await page.evaluate(async()=>{
  const response=await fetch('/api/bootstrap',{cache:'no-store'});
  if(!response.ok)throw Error('bootstrap '+response.status);
  return await response.json() as {projects:Array<{id:number;title:string}>;goals:Array<{id:number;title:string;project_id:number|null;measurable:number;period_end:string}>;tasks:Array<{id:number;title:string;project_id:number|null;goal_id:number|null}>};
 });
 const found=remote.projects.filter(x=>x.title===project);
 expect(found).toHaveLength(1);
 expect(found[0].id).toBeGreaterThan(0);
 const linked=remote.tasks.filter(x=>x.title===task);
 expect(linked).toHaveLength(1);
 expect(linked[0].project_id).toBe(found[0].id);
 const target=remote.goals.filter(x=>x.title===goal);
 expect(target).toHaveLength(1);
 expect(target[0].project_id).toBe(found[0].id);
 expect(target[0].measurable).toBe(0);
 expect(target[0].period_end).toBe('2026-12-07');
 expect(linked[0].goal_id).toBe(target[0].id);
});


test('approved branding assets load, hide on mobile, and define home-screen icon',async({page})=>{
 await page.goto('/');
 const logo=page.locator('.pm-sidebar-logo img');
 await expect(logo).toBeVisible();
 await expect.poll(()=>logo.evaluate((node:HTMLImageElement)=>node.naturalWidth)).toBe(192);
 const html=await page.locator('head').innerHTML();
 expect(html).toContain('favicon-v2-32.png');
 expect(html).toContain('manifest-v2.webmanifest');
 const manifest=await page.evaluate(async()=>{
  const url=document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
  if(!url)throw Error('Missing app manifest');
  const response=await fetch(url);
  if(!response.ok)throw Error('Manifest not served');
  return await response.json() as {display:string;icons:Array<{src:string;sizes:string}>};
 });
 expect(manifest.display).toBe('standalone');
 expect(manifest.icons.some(item=>item.src.includes('brand-icon-v2-192.png')&&item.sizes==='192x192')).toBe(true);
 expect(manifest.icons.some(item=>item.src.includes('brand-icon-v2-512.png')&&item.sizes==='512x512')).toBe(true);
 for(const size of [32,192,512]){
  const path=size===32?'favicon-v2-32.png':`brand-icon-v2-${size}.png`;
  const image=await page.evaluate(async(path:string)=>{
   const image=new Image();
   image.src=new URL(path,document.baseURI).href;
   await image.decode();
   return {width:image.naturalWidth,height:image.naturalHeight};
  },path);
  expect(image).toEqual({width:size,height:size});
 }
 // Chrome may fetch the install manifest and icons without Basic Auth.
 const guest=await apiRequest.newContext();
 try{
  for(const path of ['manifest-v2.webmanifest','favicon-v2-32.png','brand-icon-v2-192.png','brand-icon-v2-512.png']){
   const res=await guest.get('http://127.0.0.1:3000/'+path,{headers:{Authorization:'Bearer invalid-public-asset-check'}});
   expect(res.status(),path+' should be public to Android Chrome').toBe(200);
   expect((await res.body()).length).toBeGreaterThan(100);
  }
  const privateData=await guest.get('http://127.0.0.1:3000/api/bootstrap',{headers:{Authorization:'Bearer invalid-public-asset-check'}});
  expect(privateData.status(),'Private API must require password').toBe(401);
 } finally {
  await guest.dispose();
 }
 await page.setViewportSize({width:390,height:844});
 await expect(logo).toBeHidden();
});


test('checklist survives offline creation, ID remapping and edits in an open task drawer',async({page,context})=>{
 await page.goto('/');
 await expect(page.getByText('Данные синхронизированы')).toBeVisible();
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await context.setOffline(true);
 await expect(page.getByText('Без интернета')).toBeVisible();
 const title='Чек-лист задачи '+Date.now();
 const item='Технологии управления '+Date.now();
 const second='Второй пункт '+Date.now();
 await page.getByRole('textbox',{name:'Быстрая запись задачи'}).fill(title);
 await page.locator('.quick-capture').getByRole('button',{name:'Добавить'}).click();
 await page.locator('.sidebar').getByRole('button',{name:'Входящие',exact:true}).click();
 await page.locator('.task-main').filter({hasText:title}).click();
 const drawer=page.getByRole('dialog',{name:'Редактирование'});
 const checklist=drawer.locator('.checklist-editor');
 const add=async(text:string)=>{
  await checklist.getByRole('textbox',{name:'Новый пункт чек-листа'}).fill(text);
  await checklist.getByRole('button',{name:'Добавить',exact:true}).click();
  await expect(checklist.getByRole('checkbox',{name:text,exact:true})).toBeVisible();
 };
 await add(item);
 await checklist.getByRole('checkbox',{name:item,exact:true}).check();
 await expect(checklist.getByRole('checkbox',{name:item,exact:true})).toBeChecked();
 await add(second);
 await checklist.getByRole('button',{name:'Удалить пункт '+second}).click();
 await expect(checklist.getByRole('checkbox',{name:second,exact:true})).toHaveCount(0);
 await context.setOffline(false);
 await expect(page.getByText('Данные синхронизированы')).toBeVisible({timeout:30_000});
 await expect(drawer).toBeVisible();
 await expect(checklist.getByRole('checkbox',{name:item,exact:true})).toBeChecked();
 await add(second);
 await checklist.getByRole('checkbox',{name:item,exact:true}).uncheck();
 await expect(checklist.getByRole('checkbox',{name:item,exact:true})).not.toBeChecked();
 await expect(page.getByText('Данные синхронизированы')).toBeVisible({timeout:30_000});
 const remote=await page.evaluate(async()=>await (await fetch('/api/bootstrap',{cache:'no-store'})).json());
 const task=remote.tasks.find(t=>t.title===title);
 expect(task.id).toBeGreaterThan(0);
 const items=remote.checklist.filter(c=>c.task_id===task.id);
 expect(items.map(c=>c.title).sort()).toEqual([item,second].sort());
 expect(items.find(c=>c.title===item).done).toBe(0);
});
