import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const template=readFileSync(new URL('../offline.sw.template.js',import.meta.url),'utf8').replace('__PRECACHE_ASSETS__','[]');
for(const priority of [1,2,3,4,null,5,'1']){
 test('push priority '+String(priority),async()=>{
  const events={},calls=[];
  const self={registration:{scope:'https://example.org/PersonalManagement/',showNotification:async(title,options)=>calls.push({title,options})},addEventListener:(name,handler)=>events[name]=handler};
  runInNewContext(template,{self,URL});
  const markers={1:'🔴',2:'🟠',3:'🔵',4:'⚪'};
   const title='Переработать видео с Феликсом';
   const body=Number.isInteger(priority)&&markers[priority]?('15:30 · '+markers[priority]+' P'+priority):'15:30';
  let promise;
  events.push({data:{json:()=>({title,body,priority,tag:'task',url:'/?task=42'})},waitUntil:value=>promise=value});
  await promise;
  assert.equal(calls.length,1);
  assert.equal(calls[0].title,title);
  assert.equal(calls[0].options.body,body);
  const valid=Number.isInteger(priority)&&priority>=1&&priority<=4;
  const file=valid?`push-priority-${priority}.png`:'brand-icon-v2-192.png';
  assert.equal(calls[0].options.icon,'https://example.org/PersonalManagement/'+file);
  if(valid){
   const png=readFileSync(new URL('../public/'+file,import.meta.url));
   assert.equal(png.subarray(1,4).toString(),'PNG');
   assert.equal(png.readUInt32BE(16),96);
   assert.equal(png.readUInt32BE(20),96);
  }
 });
}
