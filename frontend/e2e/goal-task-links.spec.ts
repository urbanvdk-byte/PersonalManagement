import {test,expect} from '@playwright/test';
const KEY='personalmanagement:pages-demo:v1';

test('goal shows linked tasks, creates a linked task and records/reverses its contribution',async({page})=>{
 await page.goto('/');
 await page.locator('.nav-item',{hasText:'Цели'}).click();
 const section=page.getByRole('region',{name:'Задачи цели: Провести 4 тренировки за месяц'});
 await expect(section.getByText('Провести тренировку',{exact:true})).toBeVisible();
 await section.getByRole('button',{name:'Добавить задачу'}).click();
 const drawer=page.getByRole('dialog',{name:'Редактирование'});
 await expect(drawer.getByLabel('Цель',{exact:true})).toHaveValue('1');
 await drawer.getByLabel('Название *',{exact:true}).fill('Связанная тренировка');
 await drawer.getByRole('button',{name:'Сохранить'}).click();
 const row=section.locator('.task-row').filter({hasText:'Связанная тренировка'});
 await expect(row).toBeVisible();
 const goalValue=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).goals.find((g:any)=>g.id===1).current_value,KEY);
 await expect.poll(goalValue).toBe(1);
 await row.locator('.task-check').click();
 const contribution=page.getByRole('dialog',{name:'Вклад в цель'});
 await contribution.getByRole('spinbutton',{name:'Величина вклада'}).fill('1');
 await contribution.getByRole('button',{name:'ДА',exact:true}).click();
 await expect.poll(goalValue).toBe(2);
 await expect(row.locator('.task-check')).toHaveClass(/done/);
 await row.locator('.task-check').click();
 await expect.poll(goalValue).toBe(1);
 await page.reload();
 await page.locator('.nav-item',{hasText:'Цели'}).click();
 await expect(section.getByText('Связанная тренировка',{exact:true})).toBeVisible();
});

test('task editor can select a standalone goal even when a project is selected',async({page})=>{
 await page.goto('/');
 await page.locator('.nav-item',{hasText:'Входящие'}).click();
 await page.getByRole('button',{name:'Добавить',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'Редактирование'});
 await drawer.getByLabel('Название *',{exact:true}).fill('Задача с отдельной целью');
 await drawer.getByLabel('Проект',{exact:true}).selectOption('1');
 await drawer.getByLabel('Цель',{exact:true}).selectOption('1');
 await expect(drawer.getByLabel('Проект',{exact:true})).toHaveValue('1');
 await drawer.getByRole('button',{name:'Сохранить'}).click();
 await expect.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).tasks.find((t:any)=>t.title==='Задача с отдельной целью')?.goal_id,KEY)).toBe(1);
 await page.locator('.nav-item',{hasText:'Цели'}).click();
 await expect(page.getByRole('region',{name:'Задачи цели: Провести 4 тренировки за месяц'}).getByText('Задача с отдельной целью',{exact:true})).toBeVisible();
});
