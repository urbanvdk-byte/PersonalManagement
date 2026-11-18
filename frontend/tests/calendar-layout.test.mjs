import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutTimedItems} from '../src/calendarLayout.ts';

const I=(id,start,end)=>({id,start,end});
function assertNoVisualCollisions(items){
 const {placements}=layoutTimedItems(items);
 for(let i=0;i<items.length;i++){
  for(let j=i+1;j<items.length;j++){
   const a=items[i],b=items[j];
   if(a.start>=b.end||b.start>=a.end)continue;
   const left=placements.get(a.id),right=placements.get(b.id);
   assert.ok(left&&right);
   const split=left.leftPercent+left.widthPercent<=right.leftPercent+1e-8
     ||right.leftPercent+right.widthPercent<=left.leftPercent+1e-8;
   assert.ok(split,`${a.id} and ${b.id} overlap on screen`);
  }
 }
}
test('simultaneous tasks render in separate equal-width columns',()=>{
 const entries=[I('tasks-1',600,660),I('tasks-2',600,660),I('tasks-3',600,660)];
 const {placements,maxColumns}=layoutTimedItems(entries);
 assert.equal(maxColumns,3);
 assert.deepEqual(entries.map(i=>placements.get(i.id).column),[0,1,2]);
 assert.ok(entries.every(i=>Math.abs(placements.get(i.id).widthPercent-100/3)<.001));
 assertNoVisualCollisions(entries);
});
test('transitively intersecting tasks stay in one collision group',()=>{
 const items=[I('a',600,660),I('b',630,690),I('c',660,720)];
 const {placements,maxColumns}=layoutTimedItems(items);
 assert.equal(maxColumns,2);
 assert.equal(placements.get('a').column,placements.get('c').column);
 assert.notEqual(placements.get('b').column,placements.get('c').column);
 assertNoVisualCollisions(items);
});
test('separate groups reclaim full row width',()=>{
 const items=[I('a',600,660),I('b',600,645),I('c',720,780)];
 const result=layoutTimedItems(items);
 assert.equal(result.placements.get('c').widthPercent,100);
 assert.equal(result.placements.get('c').leftPercent,0);
 assertNoVisualCollisions(items);
});
test('an item expands into free columns when it does not intersect them',()=>{
 const items=[I('a',600,720),I('b',600,660),I('c',600,630),I('d',660,720)];
 const result=layoutTimedItems(items);
 assert.equal(result.maxColumns,3);
 assert.equal(result.placements.get('d').span,2);
 assertNoVisualCollisions(items);
});
test('end/start touching is not an overlap, events and tasks share layout',()=>{
 const items=[I('tasks-1',600,660),I('events-1',660,720),I('tasks-2',675,735)];
 const result=layoutTimedItems(items);
 assert.equal(result.placements.get('tasks-1').widthPercent,100);
 assertNoVisualCollisions(items);
});
test('many interleaved appointments never overlap on both axes',()=>{
 const items=[
  I('a',480,570),I('b',495,525),I('c',510,600),I('d',525,540),
  I('e',540,630),I('f',600,660),I('g',615,645),I('h',645,690),
  I('i',690,750),I('j',700,710)
 ];
 assertNoVisualCollisions(items);
});
test('empty or invalid intervals do not create lanes',()=>{
 const result=layoutTimedItems([I('invalid',630,630),I('valid',720,780)]);
 assert.equal(result.maxColumns,1);
 assert.equal(result.placements.has('invalid'),false);
 assert.equal(result.placements.get('valid').widthPercent,100);
});
