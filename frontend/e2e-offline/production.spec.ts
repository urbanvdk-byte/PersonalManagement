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
