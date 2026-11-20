import {test,expect} from '@playwright/test';

const STORAGE='personalmanagement:pages-demo:v1';
const areaIcon=(card,name:string)=>card.getByRole('img',{name:'Направление: '+name});

test('goal cards show their own direction emoji without a colored badge',async({page})=>{
 await page.goto('/');
 await page.locator('.nav-item',{hasText:'Цели'}).click();
 const goal=page.locator('.goal-card').filter({hasText:'Провести 4 тренировки за месяц'});
 await expect(areaIcon(goal,'Здоровье')).toHaveText('🏃');
 await expect(goal.locator('.goal-direction-emoji')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 await expect(goal.getByRole('heading',{name:'Провести 4 тренировки за месяц'})).toBeVisible();
});

test('goal without a direct direction uses its project directions, including multiple',async({page})=>{
 await page.goto('/');
 await page.evaluate(key=>{
   const data=JSON.parse(localStorage.getItem(key)||'{}');
   data.goals[0].area_id=null;
   data.goals[0].project_id=1;
   data.projects[0].area_ids=[1,3];
   localStorage.setItem(key,JSON.stringify(data));
 },STORAGE);
 await page.reload();
 await page.locator('.nav-item',{hasText:'Цели'}).click();
 const card=page.locator('.goal-card').filter({hasText:'Провести 4 тренировки за месяц'});
 await expect(areaIcon(card,'Работа')).toHaveText('💼');
 await expect(areaIcon(card,'Дом и быт')).toHaveText('🏠');
});

test('goal without a direction or associated project shows no emoji and remains editable',async({page})=>{
 await page.goto('/');
 await page.evaluate(key=>{
   const data=JSON.parse(localStorage.getItem(key)||'{}');
   data.goals[0].area_id=null;
   data.goals[0].project_id=null;
   localStorage.setItem(key,JSON.stringify(data));
 },STORAGE);
 await page.reload();
 await page.locator('.nav-item',{hasText:'Цели'}).click();
 const card=page.locator('.goal-card').filter({hasText:'Провести 4 тренировки за месяц'});
 await expect(card.locator('.goal-direction-emoji')).toHaveCount(0);
 await card.click();
 await expect(page.locator('.drawer')).toBeVisible();
 await expect(page.locator('.drawer')).toContainText('Провести 4 тренировки за месяц');
});

test('goal direction emoji stays visible in mobile cards',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();
 await page.goto('/');
 await page.getByRole('button',{name:'Другие разделы'}).click();
 await page.locator('.nav-item',{hasText:'Цели'}).click();
 const goal=page.locator('.goal-card').filter({hasText:'Провести 4 тренировки за месяц'});
 await goal.scrollIntoViewIfNeeded();
 await expect(areaIcon(goal,'Здоровье')).toBeVisible();
 await context.close();
});
