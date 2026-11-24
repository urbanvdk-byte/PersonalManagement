import {test,expect} from '@playwright/test';

const KEY='personalmanagement:pages-demo:v1';
type VisualBox={name:string;start:number;end:number;left:number;right:number;width:number;columns:number};
function overlaps(a:VisualBox,b:VisualBox){
  return a.start<b.end&&b.start<a.end;
}
function checkHorizontalSeparation(boxes:VisualBox[]){
  for(let a=0;a<boxes.length;a++){
    for(let b=a+1;b<boxes.length;b++){
      if(!overlaps(boxes[a],boxes[b]))continue;
      expect(
        boxes[a].right<=boxes[b].left+1 ||
        boxes[b].right<=boxes[a].left+1,
        'Overlapping appointments must be placed side-by-side: '+boxes[a].name+' and '+boxes[b].name
      ).toBe(true);
    }
  }
}
async function layoutBoxes(page,day:string,titles:string[],intervals:Record<string,[number,number]>):Promise<VisualBox[]>{
 const track=page.locator('[data-calendar-day="'+day+'"]');
 await expect(track).toBeVisible();
 return Promise.all(titles.map(async(name)=>{
   const block=track.locator('.cal-item',{hasText:name}).first();
   await expect(block).toHaveCount(1);
   const bounds=await block.boundingBox();
   expect(bounds).not.toBeNull();
   const columns=Number(await block.getAttribute('data-layout-columns'));
   return {name,start:intervals[name][0],end:intervals[name][1],
     left:bounds!.x,right:bounds!.x+bounds!.width,width:bounds!.width,columns};
 }));
}
test('simultaneous tasks and a meeting form readable, non-overlapping columns',async({page})=>{
 await page.goto('/');
 const day=await page.evaluate(key=>{
   const store=JSON.parse(localStorage.getItem(key)||'{}');
   const first=store.tasks[0];
   const day=first.scheduled_at.slice(0,10);
   const extra=['Пересечение А','Пересечение Б'];
   let max=Math.max(...store.tasks.map(t=>t.id));
   for(const name of extra){
     store.tasks.push({...first,id:++max,title:name,scheduled_at:day+'T10:00',duration_minutes:60});
   }
   store.tasks.push({...first,id:++max,title:'Пересечение встреча',scheduled_at:day+'T10:00',duration_minutes:60});
   localStorage.setItem(key,JSON.stringify(store));
   return day;
 },KEY);
 await page.reload();
 const titles=['Обсудить план проекта','Пересечение А','Пересечение Б','Пересечение встреча'];
 const intervals=Object.fromEntries(titles.map(name=>[name,[600,660]]));
 const boxes=await layoutBoxes(page,day,titles,intervals);
 expect(boxes.map(b=>b.columns)).toEqual([4,4,4,4]);
 for(const box of boxes)expect(box.width).toBeGreaterThanOrEqual(90);
 checkHorizontalSeparation(boxes);
});
test('partial collisions share lanes, later independent task uses full day width',async({page})=>{
 await page.goto('/');
 const day=await page.evaluate(key=>{
   const store=JSON.parse(localStorage.getItem(key)||'{}');
   const first=store.tasks[0];const day=first.scheduled_at.slice(0,10);
   let max=Math.max(...store.tasks.map(t=>t.id));
   store.tasks.push({...first,id:++max,title:'Частично 10:30',scheduled_at:day+'T10:30',duration_minutes:60});
   store.tasks.push({...first,id:++max,title:'Частично 11:00',scheduled_at:day+'T11:00',duration_minutes:60});
   store.tasks.push({...first,id:++max,title:'Отдельно 20:00',scheduled_at:day+'T20:00',duration_minutes:60});
   localStorage.setItem(key,JSON.stringify(store));
   return day;
 },KEY);
 await page.reload();
 const titles=['Обсудить план проекта','Частично 10:30','Частично 11:00','Отдельно 20:00'];
 const intervals={
   'Обсудить план проекта':[600,660],
   'Частично 10:30':[630,690],
   'Частично 11:00':[660,720],
   'Отдельно 20:00':[1200,1260]
 };
 const boxes=await layoutBoxes(page,day,titles,intervals);
 checkHorizontalSeparation(boxes);
 expect(boxes.slice(0,3).map(b=>b.columns)).toEqual([2,2,2]);
 expect(boxes[3].columns).toBe(1);
 expect(boxes[3].width).toBeGreaterThan(boxes[0].width*1.8);
});
