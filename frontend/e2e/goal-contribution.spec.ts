import {test,expect} from '@playwright/test';

test('mobile day: completing, reopening and recompleting a recurring task changes the goal only once',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 try{
  const page=await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'День',exact:true})).toBeVisible();
  const storage='personalmanagement:pages-demo:v1';
  await page.evaluate(key=>{
   const data=JSON.parse(localStorage.getItem(key)!);
   const now=new Date();
   const pad=(n:number)=>String(n).padStart(2,'0');
   const day=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
   const task={...data.tasks[0],id:9999,title:'Тренировка для проверки вклада',goal_id:9999,project_id:null,area_id:null,status:'planned',scheduled_at:day+'T10:00',recurrence:'daily',recurrence_until:null,revision:1};
   const goal={...data.goals[0],id:9999,title:'100 тренировок',start_value:0,target_value:100,current_value:24,unit:'тренировок',measurable:1,done:0,revision:1};
   data.tasks=[task];data.goals=[goal];data.occurrences=[];data.goal_contributions=[];
   localStorage.setItem(key,JSON.stringify(data));
  },storage);
  await page.reload();
  const value=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).goals[0].current_value,storage);
  const complete=page.getByRole('button',{name:'Выполнить: Тренировка для проверки вклада',exact:true});
  const reopen=page.getByRole('button',{name:'Отменить выполнение: Тренировка для проверки вклада',exact:true});
  const dialog=page.getByRole('dialog',{name:'Вклад в цель'});
  for(let i=0;i<2;i++){
   await complete.click();
   await expect(dialog).toBeVisible();
   await dialog.getByRole('spinbutton',{name:'Величина вклада'}).fill('1');
   await dialog.getByRole('button',{name:'ДА',exact:true}).click();
   await expect.poll(value).toBe(25);
   await expect(reopen).toBeVisible();
   if(i===0){
    await reopen.click();
    await expect.poll(value).toBe(24);
    await expect(complete).toBeVisible();
   }
  }
  const entries=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).goal_contributions,storage);
  expect(entries).toHaveLength(1);
  expect(entries[0].delta).toBe(1);
 }finally{await context.close();}
});
