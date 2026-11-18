import test from 'node:test';
import assert from 'node:assert/strict';
import {isOccurrenceDate,expandTasks,beforeDate,transferSeriesStart} from '../src/recurrence.ts';
const base={id:1,title:'Повтор',status:'planned',scheduled_at:'2026-01-31T09:00',duration_minutes:60,recurrence:'monthly',recurrence_until:null};
test('monthly end-of-month clamps to the last day without drifting',()=>{
 const task={...base};
 for(const key of ['2026-01-31','2026-02-28','2026-03-31','2026-04-30','2026-05-31'])
  assert.equal(isOccurrenceDate(task,key),true,key);
 assert.equal(isOccurrenceDate(task,'2026-03-28'),false);
 const dates=expandTasks([task],[],'2026-02-01','2026-05-31');
 assert.deepEqual(dates.map(t=>t.occurrence_date),['2026-02-28','2026-03-31','2026-04-30','2026-05-31']);
});
test('yearly February 29 occurs on February 28 in non-leap years',()=>{
 const task={...base,scheduled_at:'2024-02-29T11:00',recurrence:'yearly'};
 for(const key of ['2025-02-28','2026-02-28','2027-02-28','2028-02-29'])
  assert.ok(isOccurrenceDate(task,key),key);
 assert.ok(!isOccurrenceDate(task,'2028-02-28'));
});
test('weekly repeat stays on weekday and daily repeat has every day',()=>{
 const task={...base,scheduled_at:'2026-11-16T10:00',recurrence:'weekly'};
 assert.deepEqual(expandTasks([task],[],'2026-11-16','2026-12-01').map(t=>t.occurrence_date),
 ['2026-11-16','2026-11-23','2026-11-30']);
 const everyday={...task,recurrence:'daily'};
 assert.equal(expandTasks([everyday],[],'2026-11-16','2026-11-22').length,7);
});
test('per-occurrence completion, cancellation and relocation never affect other days',()=>{
 const task={...base,scheduled_at:'2026-11-16T10:00',recurrence:'daily'};
 const exceptions=[
  {task_id:1,occurrence_date:'2026-11-17',changes:{status:'done'}},
  {task_id:1,occurrence_date:'2026-11-18',changes:{scheduled_at:'2026-11-21T12:00',duration_minutes:30}},
  {task_id:1,occurrence_date:'2026-11-19',changes:{status:'cancelled'}}
 ];
 const view=expandTasks([task],exceptions,'2026-11-16','2026-11-22');
 assert.ok(!view.some(t=>t.occurrence_date==='2026-11-17'));
 assert.ok(!view.some(t=>t.occurrence_date==='2026-11-19'));
 assert.equal(view.find(t=>t.occurrence_date==='2026-11-18')?.scheduled_at,'2026-11-21T12:00');
 assert.ok(view.some(t=>t.occurrence_date==='2026-11-20'));
 assert.ok(view.some(t=>t.occurrence_date==='2026-11-21'));
 const movedOutside=expandTasks([task],exceptions,'2026-11-21','2026-11-22');
 assert.ok(movedOutside.some(t=>t.occurrence_date==='2026-11-18'));
});
test('until date limits series; split helpers retain local time and date',()=>{
 const task={...base,recurrence:'daily',scheduled_at:'2026-11-16T10:00',recurrence_until:'2026-11-19'};
 assert.equal(expandTasks([task],[],'2026-11-16','2026-11-22').length,4);
 assert.equal(beforeDate('2027-01-01'),'2026-12-31');
 assert.equal(transferSeriesStart(task,'2026-11-18','2026-11-18T15:30'),'2026-11-16T15:30');
});
