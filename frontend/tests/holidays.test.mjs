import test from 'node:test';
import assert from 'node:assert/strict';
import {HOLIDAY_TYPES,holidayOccursOn,holidaysOn} from '../src/holidays.ts';
const task=(category,date='2027-03-15',extra={})=>({id:1,title:'Праздник',holiday_type:category,holiday_date:date,status:'planned',...extra});
for(const category of Object.keys(HOLIDAY_TYPES)){
 test('annual '+category,()=>{
  const t=task(category);
  for(const day of ['2027-03-15','2028-03-15','2050-03-15'])assert.equal(holidayOccursOn(t,day),true);
  for(const day of ['2026-03-15','2027-03-14','2028-03-16','2028-04-15'])assert.equal(holidayOccursOn(t,day),false);
  assert.equal(holidaysOn({tasks:[t]},'2028-03-15').length,1);
 });
}
test('leap day repeats on February 28 in non-leap years',()=>{
 const t=task('birthday','2024-02-29');
 for(const day of ['2024-02-29','2025-02-28','2028-02-29','2100-02-28'])assert.equal(holidayOccursOn(t,day),true);
 for(const day of ['2024-02-28','2025-03-01','2028-02-28','2025-02-29'])assert.equal(holidayOccursOn(t,day),false);
});
test('ordinary and cancelled tasks do not repeat as holidays',()=>{
 assert.equal(holidayOccursOn(task(null),'2028-03-15'),false);
 assert.equal(holidayOccursOn(task('birthday','2027-03-15',{status:'cancelled'}),'2028-03-15'),false);
});
