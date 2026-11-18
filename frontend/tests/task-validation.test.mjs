import test from 'node:test';
import assert from 'node:assert/strict';
import {hasScheduledTime,isValidTaskDuration} from '../src/taskValidation.ts';

test('scheduled date and time is mandatory for new tasks',()=>{
  for(const invalid of [null,undefined,'','2026-11-18','2026-11-18T','2026-02-31T10:00','2026-11-18T24:00']){
    assert.equal(hasScheduledTime(invalid),false,String(invalid));
  }
  assert.equal(hasScheduledTime('2026-11-18T09:30'),true);
  assert.equal(hasScheduledTime('2026-11-18T09:30:00'),true);
});
test('duration starts at thirty minutes and increments in fifteen-minute steps',()=>{
  for(const valid of [30,45,60,75,90,120,1440])assert.equal(isValidTaskDuration(valid),true,String(valid));
  for(const invalid of [0,1,15,20,29,31,44,61,1441,1500,30.5,'30',null])assert.equal(isValidTaskDuration(invalid),false,String(invalid));
});
