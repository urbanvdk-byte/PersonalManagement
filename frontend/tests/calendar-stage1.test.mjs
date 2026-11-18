import test from 'node:test';
import assert from 'node:assert/strict';
import {monthGrid,calendarKey,normalizeRange,withinSelectedRange,selectedCalendarDays} from '../src/miniMonthModel.ts';

test('date range normalized forward and backward',()=>{
  assert.deepEqual(normalizeRange('2026-11-20','2026-11-08'),{start:'2026-11-08',end:'2026-11-20'});
  assert.equal(withinSelectedRange('2026-11-16',normalizeRange('2026-11-20','2026-11-08')),true);
});
test('drag selection changes visible grid from week to whole selected period',()=>{
  const week=new Date(2026,10,16);
  const days=selectedCalendarDays(week,normalizeRange('2026-11-08','2026-11-20'));
  assert.equal(days.length,13);
  assert.equal(calendarKey(days[0]),'2026-11-08');
  assert.equal(calendarKey(days.at(-1)),'2026-11-20');
  assert.equal(selectedCalendarDays(week,{start:null,end:null}).length,7);
});
test('month grid includes Monday through Sunday',()=>{
  const days=monthGrid(new Date(2026,10,1));
  assert.equal(calendarKey(days[0]),'2026-10-26');
  assert.equal(calendarKey(days.at(-1)),'2026-12-06');
});
