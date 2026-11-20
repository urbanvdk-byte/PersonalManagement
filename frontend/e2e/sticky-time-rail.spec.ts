import {test,expect} from '@playwright/test';

test('mobile hours and left header stay visible during horizontal day scrolling',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();
 await page.goto('/');
 const scroller=page.locator('.calendar-scroll');
 await expect(scroller).toBeVisible();
 // The app auto-centers the current day. Start from a known horizontal origin.
 await scroller.evaluate(node=>{node.scrollLeft=0;node.scrollTop=0;});
 const metrics=()=>scroller.evaluate(node=>{
   const rect=(selector:string)=>{
     const el=node.querySelector<HTMLElement>(selector);
     if(!el)throw Error('Missing '+selector);
     const r=el.getBoundingClientRect();
     return {left:r.left,right:r.right,top:r.top,width:r.width};
   };
   return {
     viewport:rect('.cal-inner'),
     scrollLeft:node.scrollLeft,scrollTop:node.scrollTop,
     left:node.getBoundingClientRect().left,
     head:rect('.cal-head > .rail-label'),
     allDay:rect('.all-day > .rail-label'),
     times:rect('.time-rail'),
     hourLabel:rect('.time-rail span'),
     day:rect('.day-head')
   };
 });
 const initial=await metrics();
 expect(initial.head.left).toBeCloseTo(initial.left,0);
 expect(initial.allDay.left).toBeCloseTo(initial.left,0);
 expect(initial.times.left).toBeCloseTo(initial.left,0);
 expect(initial.times.width).toBeGreaterThanOrEqual(60);
 await scroller.evaluate(node=>{node.scrollLeft=400;});
 await expect.poll(async()=>(await metrics()).scrollLeft).toBeGreaterThan(350);
 const halfway=await metrics();
 for(const position of ['head','allDay','times'] as const)
   expect(Math.abs(halfway[position].left-initial[position].left),position+' must stay pinned')
     .toBeLessThanOrEqual(1.1);
 expect(Math.abs(halfway.hourLabel.left-initial.hourLabel.left)).toBeLessThanOrEqual(1.1);
 expect(initial.day.left-halfway.day.left).toBeGreaterThan(350);
 // Stay fixed when scrolling to the other end too.
 await scroller.evaluate(node=>{node.scrollLeft=node.scrollWidth;});
 const end=await metrics();
 expect(end.scrollLeft).toBeGreaterThan(halfway.scrollLeft);
 for(const position of ['head','allDay','times'] as const)
   expect(Math.abs(end[position].left-initial[position].left),position+' at the end')
     .toBeLessThanOrEqual(1.1);
 // Hours should still move vertically when the calendar is scrolled in time.
 await scroller.evaluate(node=>{node.scrollTop=120;});
 const lower=await metrics();
 expect(lower.scrollTop).toBeGreaterThanOrEqual(110);
 expect(lower.hourLabel.top).toBeLessThan(end.hourLabel.top-100);
 expect(Math.abs(lower.times.left-initial.times.left)).toBeLessThanOrEqual(1.1);
 await context.close();
});
