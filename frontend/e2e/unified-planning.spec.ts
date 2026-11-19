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
