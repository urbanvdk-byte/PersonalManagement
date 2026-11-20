import {test,expect} from '@playwright/test';

test('mobile bottom navigation uses Inbox in the fourth slot and opens incoming tasks',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();
 await page.goto('/');
 const nav=page.getByRole('navigation',{name:'Мобильная навигация'});
 await expect(nav).toBeVisible();
 await expect(nav.locator('button')).toHaveCount(5);
 await expect(nav.locator('button').nth(3)).toContainText('Входящие');
 await expect(nav.locator('button').filter({hasText:'Проекты'})).toHaveCount(0);
 await nav.getByRole('button',{name:'Входящие'}).click();
 await expect(nav.getByRole('button',{name:'Входящие'})).toHaveAttribute('aria-current','page');
 await expect(page.locator('main h2')).toHaveText('Входящие');
 await expect(page.locator('main')).toContainText('Разобрать покупки на неделю');
 await context.close();
});
