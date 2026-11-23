import test from 'node:test';
import assert from 'node:assert/strict';
import {nextScheduledDay,nextTaskDay,nextEventDay,nextOverdueTask} from '../src/nextDay.ts';

test('second and third clicks advance relative to the appointment, not today',()=>{
 const first={scheduled_at:'2026-11-20T17:00'};
 const second=nextTaskDay(first);
 assert.deepEqual(second,{scheduled_at:'2026-11-21T17:00',status:'planned'});
 const third=nextTaskDay(second);
 assert.deepEqual(third,{scheduled_at:'2026-11-22T17:00',status:'planned'});
 const fourth=nextTaskDay(third);
 assert.equal(fourth.scheduled_at,'2026-11-23T17:00');
});
test('calendar-day increments cross month and year without UTC offset shifts',()=>{
 assert.equal(nextScheduledDay('2026-11-30T08:15'),'2026-12-01T08:15');
 assert.equal(nextScheduledDay('2026-12-31T23:45'),'2027-01-01T23:45');
 assert.equal(nextScheduledDay('2028-02-28T10:30'),'2028-02-29T10:30');
 assert.equal(nextScheduledDay('2028-02-29T10:30'),'2028-03-01T10:30');
 assert.equal(nextScheduledDay('2026-03-28T09:00'),'2026-03-29T09:00');
 assert.throws(()=>nextTaskDay({scheduled_at:null}),/дата задачи/);
 assert.throws(()=>nextScheduledDay('2026-02-30T17:00'),/Некорректная/);
});
test('events move together and retain end time, even across midnight',()=>{
 const first={starts_at:'2026-11-20T23:30',ends_at:'2026-11-21T00:30'};
 const second=nextEventDay(first);
 assert.deepEqual(second,{starts_at:'2026-11-21T23:30',ends_at:'2026-11-22T00:30'});
 assert.deepEqual(nextEventDay(second),{starts_at:'2026-11-22T23:30',ends_at:'2026-11-23T00:30'});
});

test('overdue action plans unscheduled and old tasks relative to the displayed day',()=>{
 assert.deepEqual(nextOverdueTask({scheduled_at:null},'2026-11-23'),{scheduled_at:'2026-11-24T09:00',status:'planned'});
 assert.deepEqual(nextOverdueTask({scheduled_at:'2026-05-05T17:00'},'2026-11-23'),{scheduled_at:'2026-11-24T17:00',status:'planned'});
 assert.deepEqual(nextOverdueTask({scheduled_at:'2026-12-31T18:30'},'2026-12-31'),{scheduled_at:'2027-01-01T18:30',status:'planned'});
});
