import test from 'node:test';
import assert from 'node:assert/strict';
import {snapQuarter,toScheduledAt,movePreview,resizePreview,isPreviewChanged} from '../src/calendarInteraction.ts';

test('moving task to other date keeps offset and snaps to a quarter hour',()=>{
  const moved=movePreview(8,'2026-11-20',14*60+7,15,45);
  assert.deepEqual(moved,{taskId:8,day:'2026-11-20',minute:13*60+45,duration:45,mode:'move'});
  assert.equal(toScheduledAt(moved.day,moved.minute),'2026-11-20T13:45');
  assert.equal(isPreviewChanged('2026-11-19',14*60,45,moved),true);
});
test('moving at end of day clamps the whole block inside day',()=>{
  const moved=movePreview(1,'2026-11-20',1436,0,60);
  assert.equal(moved.minute,1380);
  assert.equal(moved.duration,60);
});
test('top-edge resizing preserves end time and minimum thirty minutes',()=>{
  const grown=resizePreview(1,'2026-11-20',600,60,'resize-start',-31);
  assert.equal(grown.minute,570);
  assert.equal(grown.duration,90);
  assert.equal(grown.minute+grown.duration,660);
  const shrunk=resizePreview(1,'2026-11-20',600,60,'resize-start',100);
  assert.equal(shrunk.minute,630);
  assert.equal(shrunk.duration,30);
  assert.equal(shrunk.minute+shrunk.duration,660);
});
test('bottom-edge resizing changes only duration by fifteen-minute steps',()=>{
  const longer=resizePreview(4,'2026-11-20',600,45,'resize-end',29);
  assert.equal(longer.duration,75);
  assert.equal(longer.minute,600);
  const shorter=resizePreview(4,'2026-11-20',600,45,'resize-end',-40);
  assert.equal(shorter.duration,30);
  assert.equal(shorter.minute,600);
});
test('resizing is bounded at midnight and no-change gestures are ignored',()=>{
  const late=resizePreview(4,'2026-11-20',1380,45,'resize-end',300);
  assert.equal(late.duration,60);
  assert.equal(snapQuarter(22),15);
  const noChange=movePreview(4,'2026-11-20',600,0,60);
  assert.equal(isPreviewChanged('2026-11-20',600,60,noChange),false);
});
