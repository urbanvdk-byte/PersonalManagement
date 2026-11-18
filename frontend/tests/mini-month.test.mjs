import test from 'node:test';
import assert from 'node:assert/strict';
import {monthGrid,calendarKey,selectMiniDate,withinSelectedRange,shiftCalendarMonth} from '../src/miniMonthModel.ts';

test('November 2026 grid starts Monday 26 October and ends Sunday 6 December',()=>{
  const cells=monthGrid(new Date(2026,10,1));
  assert.equal(cells.length,42);
  assert.equal(calendarKey(cells[0]),'2026-10-26');
  assert.equal(calendarKey(cells.at(-1)),'2026-12-06');
});
test('February 2027 grid does not include unnecessary extra weeks',()=>{
  const cells=monthGrid(new Date(2027,1,1));
  assert.equal(cells.length,28);
  assert.equal(calendarKey(cells[0]),'2027-02-01');
  assert.equal(calendarKey(cells.at(-1)),'2027-02-28');
});
test('select one day, select reversed range, then restart',()=>{
  let selection={start:null,end:null};
  selection=selectMiniDate(selection,'2026-11-20');
  assert.deepEqual(selection,{start:'2026-11-20',end:null});
  assert.equal(withinSelectedRange('2026-11-20',selection),true);
  selection=selectMiniDate(selection,'2026-11-16');
  assert.deepEqual(selection,{start:'2026-11-16',end:'2026-11-20'});
  assert.equal(withinSelectedRange('2026-11-18',selection),true);
  assert.equal(withinSelectedRange('2026-11-21',selection),false);
  selection=selectMiniDate(selection,'2026-12-02');
  assert.deepEqual(selection,{start:'2026-12-02',end:null});
});
test('cross month selection is highlighted correctly',()=>{
  let selection=selectMiniDate({start:null,end:null},'2026-11-29');
  selection=selectMiniDate(selection,'2026-12-03');
  assert.ok(withinSelectedRange('2026-12-01',selection));
  assert.ok(!withinSelectedRange('2026-11-28',selection));
});
test('month navigation handles year transition',()=>{
  assert.equal(calendarKey(shiftCalendarMonth(new Date(2026,11,1),1)),'2027-01-01');
  assert.equal(calendarKey(shiftCalendarMonth(new Date(2027,0,1),-1)),'2026-12-01');
});
