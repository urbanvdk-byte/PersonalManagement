import {test,expect} from '@playwright/test';

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


test('offline project and its task keep their relationship during ID remapping',async({page,context})=>{
 await page.goto('/');
 await expect(page.getByText('Данные синхронизированы')).toBeVisible();
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await context.setOffline(true);
 await expect(page.getByText('Без интернета')).toBeVisible();

 const project='Офлайн связанный проект '+Date.now();
 const task='Задача связанного проекта '+Date.now();
 await page.locator('.sidebar').getByRole('button',{name:'Проекты'}).click();
 await page.locator('.content-header').getByRole('button',{name:'Проект'}).click();
 let drawer=page.getByRole('dialog',{name:'Редактирование'});
 await drawer.locator('input').first().fill(project);
 await drawer.getByRole('button',{name:'Сохранить'}).click();
 const card=page.getByRole('button',{name:'Открыть проект '+project});
 await expect(card).toBeVisible();
 await card.click();

 await page.locator('.project-workspace .project-section').filter({
  has:page.getByRole('heading',{name:'Задачи'})
 }).getByRole('button',{name:'Задача'}).click();
 drawer=page.getByRole('dialog',{name:'Редактирование'});
 await drawer.locator('input').first().fill(task);
 await drawer.getByRole('button',{name:'Сохранить'}).click();
 await expect(page.locator('.project-workspace .task-list').getByText(task).first()).toBeVisible();
 await expect(page.getByText('2 изменений ожидают отправки')).toBeVisible();

 await context.setOffline(false);
 await expect(page.getByText('Данные синхронизированы')).toBeVisible({timeout:30_000});
 const remote=await page.evaluate(async()=>{
  const response=await fetch('/api/bootstrap',{cache:'no-store'});
  if(!response.ok)throw Error('bootstrap '+response.status);
  return await response.json() as {projects:Array<{id:number;title:string}>;tasks:Array<{id:number;title:string;project_id:number|null}>};
 });
 const found=remote.projects.filter(x=>x.title===project);
 expect(found).toHaveLength(1);
 expect(found[0].id).toBeGreaterThan(0);
 const linked=remote.tasks.filter(x=>x.title===task);
 expect(linked).toHaveLength(1);
 expect(linked[0].project_id).toBe(found[0].id);
});
