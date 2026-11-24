import type {Kind,Store} from './types';

/** Offline-first production data engine. GitHub Pages still uses its separate demo store. */
export type OfflineAction = 'save'|'remove'|'occurrence'|'reset_occurrence'|'split'|'extra_add'|'extra_update'|'extra_remove';
export type OfflineOperation = {
 operation_id:string;sequence:number;action:OfflineAction;
 kind:Kind|'events'|'checklist'|'milestones';item_id?:number;parent_id?:number;
 day?:string;values:Record<string,unknown>;revision?:number;temp_id?:number;
};
export type OfflineMode = 'ready'|'offline'|'syncing'|'conflict'|'auth'|'error';
export type OfflineStatus = {mode:OfflineMode;pending:number;message:string;lastSync:number|null};
type Snapshot = {key:'snapshot';version:number;data:Store;updatedAt:number};
type IdMap = Record<string,number>;
type Envelope = {result:Record<string,unknown>|null;revision:number|null};

const DATABASE='personalmanagement-offline-v1';
const CHANGE_EVENT='personalmanagement:offline-change';
const SYNC_EVENT='personalmanagement:offline-status';
const KINDS:Kind[]=['areas','projects','goals','tasks'];
const LINK_FIELDS=new Set(['area_id','project_id','goal_id','parent_id','task_id']);
const CACHE_WARNING='Нет сохранённой копии данных. Откройте менеджер с интернетом хотя бы один раз.';
const networkMessage='Изменения сохранены на устройстве. Они будут переданы на сервер после появления интернета.';

export class OfflineHttpError extends Error {
 constructor(public readonly status:number,message:string){super(message);}
}
const req=<T>(request:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{
 request.onsuccess=()=>resolve(request.result);
 request.onerror=()=>reject(request.error);
});
const done=(tx:IDBTransaction)=>new Promise<void>((resolve,reject)=>{
 tx.oncomplete=()=>resolve();
 tx.onabort=()=>reject(tx.error||new Error('Локальная транзакция прервана'));
 tx.onerror=()=>reject(tx.error||new Error('Ошибка локального хранилища'));
});
let dbPromise:Promise<IDBDatabase>|null=null;
function database():Promise<IDBDatabase>{
 if(!dbPromise){
  dbPromise=new Promise<IDBDatabase>((resolve,reject)=>{
   if(!('indexedDB' in window)){reject(Error('Браузер не поддерживает IndexedDB'));return;}
   const opening=indexedDB.open(DATABASE,1);
   opening.onupgradeneeded=()=>{
    const db=opening.result;
    if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
    if(!db.objectStoreNames.contains('queue'))db.createObjectStore('queue',{keyPath:'operation_id'});
   };
   opening.onsuccess=()=>{
    opening.result.onversionchange=()=>opening.result.close();
    resolve(opening.result);
   };
   opening.onerror=()=>reject(opening.error);
   opening.onblocked=()=>reject(Error('Закройте другие вкладки менеджера и повторите попытку'));
  }).catch(error=>{dbPromise=null;throw error});
 }
 return dbPromise!;
}
async function snapshot():Promise<Snapshot|null>{
 const db=await database();return (await req(db.transaction('meta').objectStore('meta').get('snapshot')) as Snapshot|undefined)||null;
}
async function queue():Promise<OfflineOperation[]>{
 const db=await database();
 const items=await req(db.transaction('queue').objectStore('queue').getAll()) as OfflineOperation[];
 return items.sort((a,b)=>a.sequence-b.sequence);
}
async function mappings():Promise<IdMap>{
 const db=await database();
 return (await req(db.transaction('meta').objectStore('meta').get('mappings')) as {key:string;value:IdMap}|undefined)?.value||{};
}
async function pendingCount():Promise<number>{
 const db=await database();return req(db.transaction('queue').objectStore('queue').count());
}
function emitChange():void{window.dispatchEvent(new Event(CHANGE_EVENT));}
function notify(status:OfflineStatus):void{window.dispatchEvent(new CustomEvent(SYNC_EVENT,{detail:status}));}
function minNegative(data:Store,map:IdMap):number{
 let min=0;
 for(const key of Object.keys(map))min=Math.min(min,Number(key));
 for(const kind of KINDS)for(const record of data[kind])min=Math.min(min,record.id);
 for(const record of data.checklist||[])min=Math.min(min,record.id);
 for(const record of data.milestones||[])min=Math.min(min,record.id);
 return min-1;
}
function rewrite(value:unknown,map:IdMap,key=''):unknown{
 if(typeof value==='number'&&value<0&&LINK_FIELDS.has(key)){
  if(map[value]===undefined)throw Error('Не найдена серверная запись для локальной связи '+value);
  return map[value];
 }
 if(key==='area_ids'&&Array.isArray(value))return value.map(id=>{
  if(typeof id!=='number'||id>=0)return id;
  if(map[id]===undefined)throw Error('Не найдена серверная запись для направления '+id);
  return map[id];
 });
 if(Array.isArray(value))return value.map(x=>rewrite(x,map));
 if(value&&typeof value==='object')return Object.fromEntries(
  Object.entries(value as Record<string,unknown>).map(([k,v])=>[k,rewrite(v,map,k)])
 );
 return value;
}
/** IDs that were already acknowledged may be edited by a still-open drawer. */
function localKnownIds(value:unknown,map:IdMap,key=''):unknown{
 if(typeof value==='number'&&value<0&&LINK_FIELDS.has(key))return map[value]??value;
 if(key==='area_ids'&&Array.isArray(value))return value.map(id=>typeof id==='number'&&id<0?map[id]??id:id);
 if(Array.isArray(value))return value.map(x=>localKnownIds(x,map));
 if(value&&typeof value==='object')return Object.fromEntries(
  Object.entries(value as Record<string,unknown>).map(([k,v])=>[k,localKnownIds(v,map,k)])
 );
 return value;
}
// Keep local references usable between acknowledgment and the next bootstrap.
function visibleMappings(data:Store,map:IdMap):IdMap{
 const visible=new Set<number>();
 for(const kind of KINDS)for(const item of data[kind])visible.add(item.id);
 for(const item of [...(data.checklist||[]),...(data.milestones||[])])visible.add(item.id);
 return Object.fromEntries(Object.entries(map).filter(([id])=>!visible.has(Number(id))));
}
function remapSnapshot(data:Store,map:IdMap):Store{
 const next=localKnownIds(data,map) as Store;
 for(const kind of KINDS)for(const item of next[kind])item.id=map[item.id]??item.id;
 for(const item of [...(next.checklist||[]),...(next.milestones||[])])item.id=map[item.id]??item.id;
 return next;
}
function mapped(id:number|undefined,map:IdMap):number|undefined{
 if(id===undefined)return undefined;
 if(id<0){
  if(map[id]===undefined)throw Error('Созданная офлайн-запись ещё не синхронизирована: '+id);
  return map[id];
 }
 return id;
}
async function send(op:OfflineOperation,map:IdMap):Promise<Envelope>{
 const payload={
  operation_id:op.operation_id,action:op.action,kind:op.kind,
  ...(op.item_id===undefined?{}:{item_id:mapped(op.item_id,map)}),
  ...(op.parent_id===undefined?{}:{parent_id:mapped(op.parent_id,map)}),
  ...(op.day?{day:op.day}:{}),
  values:rewrite(op.values,map)
 };
 const headers:Record<string,string>={'Content-Type':'application/json'};
 if(op.revision!==undefined)headers['If-Match']=String(op.revision);
 else if(op.kind==='checklist'&&(op.action==='extra_update'||op.action==='extra_remove'))headers['If-Match']='1';
 let response:Response;
 try{
  response=await fetch('/api/offline/execute',{
   method:'POST',credentials:'same-origin',cache:'no-store',
   headers,body:JSON.stringify(payload)
  });
 }catch(error){throw new OfflineHttpError(0,networkMessage+' '+String(error));}
 if(!response.ok){
  const body=await response.json().catch(()=>({}));
  throw new OfflineHttpError(response.status,typeof body.detail==='string'?body.detail:'Ошибка сервера '+response.status);
 }
 return response.json() as Promise<Envelope>;
}
async function serverBootstrap():Promise<Store>{
 let response:Response;
 try{response=await fetch('/api/bootstrap',{cache:'no-store',credentials:'same-origin'});}
 catch(error){throw new OfflineHttpError(0,networkMessage+' '+String(error));}
 if(!response.ok)throw new OfflineHttpError(response.status,'Не удалось получить данные сервера: '+response.status);
 return response.json() as Promise<Store>;
}
function matching(op:OfflineOperation,other:OfflineOperation):boolean{
 if(op.action==='occurrence'||op.action==='reset_occurrence'||op.action==='split'){
  return other.kind==='tasks'&&other.item_id===op.item_id;
 }
 return op.kind===other.kind&&op.item_id!==undefined&&other.item_id===op.item_id;
}
function statusMessage(error:unknown):OfflineMode{
 if(error instanceof OfflineHttpError){
  if(error.status===0)return 'offline';
  if(error.status===409)return 'conflict';
  if(error.status===401||error.status===403||error.status===429)return 'auth';
 }
 return 'error';
}

/** One atomic IndexedDB write stores both the visible change and its durable queue entry. */
async function commit(expected:number,updated:Store,operation:OfflineOperation):Promise<boolean>{
 const db=await database();
 return new Promise<boolean>((resolve,reject)=>{
  const tx=db.transaction(['meta','queue'],'readwrite');
  const meta=tx.objectStore('meta');
  let success=false;
  const get=meta.get('snapshot');
  get.onsuccess=()=>{
   const current=get.result as Snapshot|undefined;
   if((current?.version??0)!==expected){return;}
   meta.put({key:'snapshot',version:expected+1,data:updated,updatedAt:Date.now()} as Snapshot);
   tx.objectStore('queue').add(operation);
   success=true;
  };
  get.onerror=()=>tx.abort();
  tx.oncomplete=()=>resolve(success);
  tx.onabort=()=>reject(tx.error||Error('Не удалось сохранить офлайн-изменение'));
  tx.onerror=()=>reject(tx.error||Error('Ошибка IndexedDB'));
 });
}
async function replaceSnapshot(data:Store):Promise<boolean>{
 const db=await database();
 return new Promise<boolean>((resolve,reject)=>{
  const tx=db.transaction(['meta','queue'],'readwrite');
  const meta=tx.objectStore('meta');let eligible=false;
  const count=tx.objectStore('queue').count();
  count.onsuccess=()=>{
   if(count.result!==0)return;
   const get=meta.get('snapshot');
   get.onsuccess=()=>{
    const current=get.result as Snapshot|undefined;
    if(current&&JSON.stringify(current.data)===JSON.stringify(data))return;
    meta.put({key:'snapshot',version:(current?.version??0)+1,data,updatedAt:Date.now()} as Snapshot);
    eligible=true;
   };
  };
  tx.oncomplete=()=>resolve(eligible);
  tx.onabort=()=>reject(tx.error||Error('Не удалось сохранить копию сервера'));
  tx.onerror=()=>reject(tx.error||Error('Ошибка IndexedDB'));
 });
}
async function acknowledge(op:OfflineOperation,server:Envelope):Promise<void>{
 const db=await database();
 const tx=db.transaction(['queue','meta'],'readwrite');
 const meta=tx.objectStore('meta');const list=tx.objectStore('queue');
 const row=await req(list.get(op.operation_id)) as OfflineOperation|undefined;
 if(row){
  const map=await req(meta.get('mappings')) as {key:string;value:IdMap}|undefined;
  const ids={...(map?.value||{})};
  if(op.temp_id!==undefined){
   const actual=server.result?.id;
   if(typeof actual!=='number'||actual<=0)throw Error('Сервер не вернул ID новой записи');
   ids[op.temp_id]=actual;
   meta.put({key:'mappings',value:ids});
   // Update the snapshot and ID mapping together; a new local operation
   // must never see a server ID with a snapshot still using its temp ID.
   const saved=await req(meta.get('snapshot')) as Snapshot|undefined;
   if(saved&&op.kind!=='events'){
    meta.put({...saved,version:saved.version+1,data:remapSnapshot(saved.data,ids),updatedAt:Date.now()});
   }
  }
  const delta=op.revision!==undefined&&typeof server.revision==='number'
   ?server.revision-(op.revision+1):0;
  if(delta!==0){
   const future=await req(list.getAll()) as OfflineOperation[];
   for(const next of future)if(next.operation_id!==op.operation_id&&matching(op,next)&&next.revision!==undefined){
    list.put({...next,revision:next.revision+delta});
   }
  }
  list.delete(op.operation_id);
 }
 await done(tx);
}
type LocalApply=(data:Store,op:OfflineOperation)=>Promise<Store>;

export class OfflineEngine {
 private active:Promise<void>|null=null;
 private mutationTail:Promise<void>=Promise.resolve();
 private current:OfflineStatus={mode:navigator.onLine?'ready':'offline',pending:0,message:'',lastSync:null};
 private channel:BroadcastChannel|null=null;
 private started=false;
 constructor(private readonly apply:LocalApply){}
 private update(mode:OfflineMode,message=''):void{
  this.current={...this.current,mode,message};
  notify(this.current);
 }
 private async count():Promise<void>{
  this.current={...this.current,pending:await pendingCount()};
  notify(this.current);
 }
 start():void{
  if(this.started)return;
  this.started=true;
  if('BroadcastChannel' in window){
   this.channel=new BroadcastChannel('personalmanagement:offline');
   this.channel.onmessage=()=>{emitChange();void this.count();};
  }
  window.addEventListener('online',()=>void this.syncNow());
  window.addEventListener('offline',()=>this.update('offline',networkMessage));
  window.addEventListener('visibilitychange',()=>{
   if(document.visibilityState==='visible')void this.syncNow();
  });
  window.setInterval(()=>{if(navigator.onLine)void this.syncNow();},30000);
  void this.count();
 }
 private broadcast():void{this.channel?.postMessage('updated');emitChange();}
 async load():Promise<Store>{
  this.start();
  let current=await snapshot();
  if(!current){
   if(!navigator.onLine)throw Error(CACHE_WARNING);
   try{
    const remote=await serverBootstrap();
    await replaceSnapshot(remote);current=await snapshot();
   }catch(error){this.update(statusMessage(error),String(error));throw error;}
  }
  if(!current)throw Error(CACHE_WARNING);
  if(navigator.onLine)void this.syncNow();
  const map=await mappings();
  return {...current.data,local_id_map:visibleMappings(current.data,map)};
 }
 async status():Promise<OfflineStatus>{
  this.start();
  await this.count();
  return this.current;
 }
 async mutate(details:Omit<OfflineOperation,'operation_id'|'sequence'|'temp_id'>):Promise<void>{
  const act=async()=>{
   for(let attempt=0;attempt<5;attempt++){
    let current=await snapshot();
    if(!current){
     await this.load();current=await snapshot();
    }
    if(!current)throw Error(CACHE_WARNING);
    const known=await mappings();
    const visible=visibleMappings(current.data,known);
    const localDetails={
     ...details,
     ...(details.item_id===undefined?{}:{item_id:details.item_id<0?visible[details.item_id]??details.item_id:details.item_id}),
     ...(details.parent_id===undefined?{}:{parent_id:details.parent_id<0?visible[details.parent_id]??details.parent_id:details.parent_id}),
     values:localKnownIds(details.values,visible) as Record<string,unknown>
    };
    const created=details.action==='save'&&details.item_id===undefined||
     details.action==='extra_add'||details.action==='split';
    const op:OfflineOperation={
     ...localDetails,operation_id:crypto.randomUUID(),sequence:current.version+1,
     ...(created?{temp_id:minNegative(current.data,known)}:{})
    };
    const updated=await this.apply(current.data,op);
    if(await commit(current.version,updated,op)){
     await this.count();
     this.broadcast();
     if(navigator.onLine)void this.syncNow();
     else this.update('offline',networkMessage);
     return;
    }
   }
   throw Error('Данные изменились в другой вкладке. Повторите действие.');
  };
  const result=this.mutationTail.then(act,act);
  this.mutationTail=result.then(()=>{},()=>{});
  return result;
 }
 syncNow():Promise<void>{
  if(this.active)return this.active;
  if(!navigator.onLine){this.update('offline',networkMessage);return Promise.resolve();}
  const job=async()=>{
   try{
    const ops=await queue();
    if(ops.length)this.update('syncing','Отправляем изменения на сервер');
    for(const op of ops){
     const all=await queue();
     if(!all.some(x=>x.operation_id===op.operation_id))continue;
     const map=await mappings();
     const reply=await send(op,map);
     await acknowledge(op,reply);
     await this.count();
     this.broadcast();
    }
    if(await pendingCount()===0){
     const remote=await serverBootstrap();
     if(await replaceSnapshot(remote)){
      this.current={...this.current,lastSync:Date.now()};
      this.broadcast();
     }
    }
    const remaining=await pendingCount();
    this.update(remaining?'syncing':'ready',remaining?'Ожидается отправка изменений':'Все данные синхронизированы');
   }catch(error){
    this.update(statusMessage(error),error instanceof Error?error.message:String(error));
   }
  };
  this.active=job().finally(()=>{
   this.active=null;
   if(this.current.mode==='syncing'&&this.current.pending>0&&navigator.onLine)
    void this.syncNow();
  });
  return this.active;
 }
 async keepLocalConflict():Promise<void>{
  const first=(await queue())[0];
  if(!first)throw Error('Нет конфликтующих операций');
  const remote=await serverBootstrap();
  const map=await mappings();
  const id=mapped(first.item_id,map);
  const group=first.kind==='checklist'?'checklist':first.kind==='milestones'?'milestones':first.kind;
  const target=(remote[group as keyof Store] as Array<{id:number;revision?:number}>|undefined)?.find(x=>x.id===id);
  if(!target?.revision)throw Error('Запись удалена на сервере: необходимо разрешить конфликт вручную');
  const db=await database();
  const tx=db.transaction('queue','readwrite');
  const list=tx.objectStore('queue');
  const future=await req(list.getAll()) as OfflineOperation[];
  const delta=target.revision-(first.revision||1);
  for(const operation of future){
   if(operation.operation_id===first.operation_id)list.put({...operation,revision:target.revision});
   else if(matching(first,operation)&&operation.revision!==undefined)
    list.put({...operation,revision:operation.revision+delta});
  }
  await done(tx);
  this.update('syncing','Повторяем сохранение локального варианта');
  await this.syncNow();
 }
 async discardAllPending():Promise<void>{
  // Never destroy the only copy before a fresh server snapshot was fetched.
  const remote=await serverBootstrap();
  const db=await database();
  const tx=db.transaction(['queue','meta'],'readwrite');
  const meta=tx.objectStore('meta');
  const get=meta.get('snapshot');
  get.onsuccess=()=>{
   const old=get.result as Snapshot|undefined;
   tx.objectStore('queue').clear();
   meta.put({key:'snapshot',version:(old?.version||0)+1,data:remote,updatedAt:Date.now()} as Snapshot);
   meta.put({key:'mappings',value:{}});
  };
  await done(tx);
  await this.count();
  this.broadcast();
  this.update('ready','Локальные изменения отменены');
 }
 async exportBackup():Promise<unknown>{
  const [saved,ops,map]=await Promise.all([snapshot(),queue(),mappings()]);
  return {exported_at:new Date().toISOString(),storage:'browser-indexeddb-offline',
   data:saved?.data||null,pending_operations:ops,id_map:map};
 }
}
