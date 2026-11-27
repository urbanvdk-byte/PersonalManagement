import {test,expect} from '@playwright/test';

test('mobile day: completing, reopening and recompleting a recurring task changes the goal only once',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 try{
  const page=await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Расписание дня',exact:true})).toBeVisible();
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
   const input=dialog.getByRole('spinbutton',{name:'Величина вклада'});
   const slider=dialog.getByRole('slider',{name:'Ползунок вклада'});
   await expect(input).toHaveAttribute('step','1');
   await expect(slider).toHaveAttribute('step','1');
   await input.fill('1.25');
   await expect(dialog.getByRole('button',{name:'ДА',exact:true})).toBeDisabled();
   await input.fill('0');
   await slider.focus();
   await slider.press('ArrowRight');
   await expect(input).toHaveValue('1');
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

for(const measurable of [0,1]){
 test('integer contribution can finish a legacy fractional remainder, measurable='+measurable,async({page})=>{
  const storage='personalmanagement:pages-demo:v1';
  await page.goto('/');
  await page.evaluate(({key,measurable})=>{
   const data=JSON.parse(localStorage.getItem(key)!);
   const goal=data.goals.find((g:any)=>g.id===2);
   Object.assign(goal,{start_value:0,target_value:100,current_value:99.25,measurable,done:0,unit:'шт.'});
   localStorage.setItem(key,JSON.stringify(data));
  },{key:storage,measurable});
  await page.reload();
  await page.locator('.nav-item',{hasText:'Расписание дня'}).click();
  await page.getByRole('button',{name:'Выполнить: Обсудить план проекта',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Вклад в цель'});
  const slider=dialog.getByRole('slider');
  const input=dialog.getByRole('spinbutton');
  await expect(slider).toHaveAttribute('max','1');
  await input.fill('1');
  await expect(dialog.getByText(measurable?'После выполнения: 100 шт.':'После выполнения: 100%',{exact:true})).toBeVisible();
  if(measurable)await expect(dialog.getByText('Текущий показатель: 99 / 100 шт.',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'ДА',exact:true}).click();
  const value=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).goals.find((g:any)=>g.id===2).current_value,storage);
  await expect.poll(value).toBe(100);
  await page.getByRole('button',{name:'Отменить выполнение: Обсудить план проекта',exact:true}).click();
  await expect.poll(value).toBe(99.25);
 });
}
