import type {Kind,Store,LegacyEventItem} from './types';
import {OfflineEngine,type OfflineOperation} from './offline';
import {addDays,dateTimeLocal,dayKey,weekStart} from './date';
import {DEFAULT_TASK_COLOR,taskColor} from './taskPalette';
import {hasScheduledTime,isValidTaskDuration} from './taskValidation';
import {isOccurrenceDate,beforeDate} from './recurrence';

// GitHub Pages has no backend. This isolated adapter stores only DEMO data in this browser.
// The production build keeps using the FastAPI + SQLite endpoints unchanged.
export const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';
const STORAGE_KEY = 'personalmanagement:pages-demo:v1';
export const STALE_RECORD_ERROR = 'Запись изменена в другой вкладке. Обновите данные перед повторным сохранением.';
const versionHeaders=(revision?:number):Record<string,string> =>
  revision===undefined?{}:{'If-Match':String(revision)};
const checkRevision=(current:number|undefined,expected?:number)=>{
  if(expected!==undefined&&(current??1)!==expected)throw Error(STALE_RECORD_ERROR);
};

async function request<T>(url:string, init?:RequestInit):Promise<T>{
  const r=await fetch(url,{...init,headers:{'Content-Type':'application/json',...(init?.headers||{})},cache:'no-store'});
  if(!r.ok){
    const e=await r.json().catch(()=>({}));
    throw Error(typeof e.detail==='string'?e.detail:'Ошибка HTTP '+r.status);
  }
  if(r.status===204)return undefined as T;
  return r.json();
}
function initialDemo():Store{
  const now=new Date();
  const mon=weekStart(now);
  const created_at=now.toISOString();
  const today=dayKey(now);
  const slot=(day:Date,h:number,m=0)=>{const d=new Date(day);d.setHours(h,m,0,0);return dateTimeLocal(d)};
  const goalStart=dayKey(new Date(now.getFullYear(),now.getMonth(),1));
  const goalEnd=dayKey(new Date(now.getFullYear(),now.getMonth()+1,0));
  return {
    areas:[
      {id:1,title:'Работа',color:'#368be5',emoji:'💼',created_at},
      {id:2,title:'Здоровье',color:'#22a879',emoji:'🏃',created_at},
      {id:3,title:'Дом и быт',color:'#f0b23c',emoji:'🏠',created_at}
    ],
    projects:[
      {id:1,title:'Демонстрационный проект',area_id:1,area_ids:[1],description:'Пример связи проекта с задачами и целью',status:'active',start_date:today,due_date:dayKey(addDays(mon,18)),created_at}
    ],
    goals:[
      {id:1,title:'Провести 4 тренировки за месяц',area_id:2,project_id:null,description:'Пример измеримой цели',period_start:goalStart,period_end:goalEnd,start_value:0,target_value:4,current_value:1,unit:'тренировки',created_at},
      {id:2,title:'Выполнить 5 шагов учебного проекта',area_id:1,project_id:1,description:'Цель для демонстрационного проекта',period_start:today,period_end:dayKey(addDays(mon,18)),start_value:0,target_value:5,current_value:1,unit:'шагов',created_at}
    ],
    tasks:[
      {id:1,title:'Обсудить план проекта',area_id:1,project_id:1,goal_id:2,parent_id:null,notes:'Вымышленная задача для тестирования интерфейса',priority:1,important:1,urgent:1,status:'planned',scheduled_at:slot(now,10),due_at:slot(addDays(now,1),18),duration_minutes:60,recurrence:'',recurrence_until:null,color:DEFAULT_TASK_COLOR,created_at,updated_at:created_at},
      {id:2,title:'Провести тренировку',area_id:2,project_id:null,goal_id:1,parent_id:null,notes:'Пример задачи из направления Здоровье',priority:2,important:1,urgent:0,status:'planned',scheduled_at:slot(addDays(now,1),18),due_at:null,duration_minutes:60,recurrence:'',recurrence_until:null,color:'#39aa6f',created_at,updated_at:created_at},
      {id:3,title:'Разобрать покупки на неделю',area_id:3,project_id:null,goal_id:null,parent_id:null,notes:'Пример повседневного дела',priority:3,important:0,urgent:1,status:'inbox',scheduled_at:null,due_at:slot(addDays(now,2),17),duration_minutes:30,recurrence:'',recurrence_until:null,color:'#ff963b',created_at,updated_at:created_at},
      {id:4,title:'Идея для будущего проекта',area_id:1,project_id:null,goal_id:null,parent_id:null,notes:'Сохранено на потом',priority:4,important:0,urgent:0,status:'someday',scheduled_at:null,due_at:null,duration_minutes:30,recurrence:'',recurrence_until:null,color:'#9463d6',created_at,updated_at:created_at}
      ,{id:5,title:'Тестовая встреча',area_id:1,project_id:1,goal_id:null,parent_id:null,notes:'Пример встречи как задачи',priority:4,important:0,urgent:0,status:'planned',scheduled_at:slot(now,14),due_at:null,duration_minutes:60,recurrence:'',recurrence_until:null,color:'#e4b636',created_at,updated_at:created_at},
      {id:6,title:'Личное время',area_id:3,project_id:null,goal_id:null,parent_id:null,notes:'Демонстрационный блок',priority:4,important:0,urgent:0,status:'planned',scheduled_at:slot(addDays(now,2),19),due_at:null,duration_minutes:60,recurrence:'',recurrence_until:null,color:'#16a2dc',created_at,updated_at:created_at}
    ],
    occurrences:[],checklist:[],milestones:[],activity:[]
  };
}
let offlineDraft:Store|null=null;
function loadDemo():Store{
  if(offlineDraft!==null)return offlineDraft;
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw){
      const data=JSON.parse(raw) as Store & {events?:LegacyEventItem[]};
      if(['areas','projects','goals','tasks'].every(k=>Array.isArray(data[k as Kind]))){
        if(!Array.isArray(data.occurrences))data.occurrences=[];
        if(!Array.isArray(data.checklist))data.checklist=[];
        if(!Array.isArray(data.milestones))data.milestones=[];
        if(!Array.isArray(data.activity))data.activity=[];
        for(const project of data.projects){
          if(!Array.isArray(project.area_ids))project.area_ids=project.area_id?[project.area_id]:[];
        }
        for(const kind of ['areas','projects','goals','tasks'] as Kind[])
          for(const item of data[kind])item.revision ||= 1;
        for(const item of data.checklist||[])item.revision ||= 1;
        for(const item of data.milestones||[])item.revision ||= 1;
        // Demo data is local-only; migrate legacy milestones once, retaining originals.
        const migrated=new Set(data.migrated_milestone_ids||[]);
        let changed=false;
        if(Array.isArray(data.events)){
          for(const event of data.events){
            const id=Math.max(0,...data.tasks.map(t=>t.id))+1;
            const duration=Math.max(30,Math.min(1440,Math.ceil((new Date(event.ends_at).getTime()-new Date(event.starts_at).getTime())/900000)*15));
            data.tasks.push({id,title:event.title,area_id:event.area_id,project_id:event.project_id,goal_id:null,parent_id:null,notes:event.notes,priority:4,important:0,urgent:0,status:event.done?'done':'planned',scheduled_at:event.starts_at,due_at:null,duration_minutes:duration,recurrence:'',recurrence_until:null,color:taskColor(event.color),created_at:event.created_at,updated_at:event.created_at,revision:1});
          }
          delete data.events;changed=true;
        }
        for(const milestone of data.milestones||[]){
          if(migrated.has(milestone.id))continue;
          const project=data.projects.find(p=>p.id===milestone.project_id);
          if(!project)continue;
          const id=Math.max(0,...data.goals.map(g=>g.id))+1;
          data.goals.push({id,title:milestone.title,project_id:project.id,area_id:project.area_id,
            description:'',period_start:null,period_end:milestone.due_date,start_value:0,target_value:1,
            current_value:0,unit:'',measurable:0,done:milestone.done,revision:1,created_at:new Date().toISOString()});
          migrated.add(milestone.id);changed=true;
        }
        if(changed){data.migrated_milestone_ids=[...migrated];localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}
        return data;
      }
      throw Error('Некорректный формат данных демо');
    }
    const data=initialDemo();
    localStorage.setItem(STORAGE_KEY,JSON.stringify(data));
    return data;
  }catch(e){
    throw Error('Не удалось прочитать данные демо из браузера. Проверьте доступность localStorage. '+String(e));
  }
}
function storeDemo(data:Store){if(offlineDraft!==null){offlineDraft=data;return;}localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}
type Row=Record<string,unknown>;
const defaults:Record<Kind,Row>={
  areas:{color:'#4689db',emoji:'📁'},
  projects:{area_id:null,area_ids:[],description:'',status:'active',start_date:null,due_date:null},
  goals:{area_id:null,project_id:null,description:'',period_start:null,period_end:null,start_value:0,target_value:1,current_value:0,unit:'',measurable:1,done:0},
  tasks:{area_id:null,project_id:null,goal_id:null,parent_id:null,notes:'',priority:4,important:0,urgent:0,status:'inbox',scheduled_at:null,due_at:null,duration_minutes:60,recurrence:'',recurrence_until:null,color:DEFAULT_TASK_COLOR}
};
async function demoSave(kind:Kind,values:Row,id?:number,expectedRevision?:number):Promise<void>{
  if('title' in values&&(!String(values.title||'').trim()))throw Error('Укажите название');
  if(kind==='projects' && values.area_ids!==undefined){
    if(!Array.isArray(values.area_ids)||values.area_ids.length>100||
       values.area_ids.some(x=>typeof x!=='number'||!Number.isInteger(x)||x<1)||
       new Set(values.area_ids).size!==values.area_ids.length)
      throw Error('Выберите направления проекта');
    values.area_id=values.area_ids[0]??null;
  }
  if(kind==='tasks'){
    if(values.recurrence!==undefined&&!['','daily','weekly','monthly','yearly'].includes(String(values.recurrence)))
      throw Error('Некорректное правило повторения');
    if(values.recurrence_until!=null&&!/^\d{4}-\d{2}-\d{2}$/.test(String(values.recurrence_until)))
      throw Error('Некорректная дата окончания повторений');
    if(values.scheduled_at!==undefined&&values.scheduled_at!==null&&!hasScheduledTime(values.scheduled_at))
      throw Error('Укажите корректные дату и время задачи');
    if(Object.prototype.hasOwnProperty.call(values,'duration_minutes')&&!isValidTaskDuration(values.duration_minutes)){
      throw Error('Продолжительность: минимум 30 минут, шаг 15 минут');
    }
  }
  const data=loadDemo();
  const list=data[kind] as unknown as Row[];
  const stamp=new Date().toISOString();
  if(id){
    const row=list.find(x=>x.id===id);
    if(!row)throw Error('Запись не найдена');
    checkRevision(Number(row.revision)||1,expectedRevision);
    if(kind==='tasks'&&String(values.recurrence??row.recurrence??'')&&!String(values.scheduled_at??row.scheduled_at??''))
      throw Error('Для повторяющейся задачи нужна дата и время');
    Object.assign(row,values);
    if(kind==='projects'){
      if(values.area_ids!==undefined)row.area_id=(values.area_ids as number[])[0]??null;
      else if(values.area_id!==undefined)row.area_ids=values.area_id?[values.area_id]:[];
    }
    if(kind==='tasks')row.updated_at=stamp;
    row.revision=(Number(row.revision)||1)+1;
  }else{
    if(!String(values.title||'').trim())throw Error('Укажите название');
    if(kind==='tasks'&&values.recurrence&&!values.scheduled_at)
      throw Error('Для повторяющейся задачи нужна дата и время');
    if(kind==='projects'&&values.area_ids===undefined)
      values.area_ids=values.area_id?[values.area_id]:[];
    const newId=Math.max(0,...list.map(x=>Number(x.id)||0))+1;
    list.push({...defaults[kind],...values,id:newId,created_at:stamp,revision:1,...(kind==='tasks'?{updated_at:stamp}:{})});
  }
  if(kind==='projects')writeActivity(data,id||Number((data.projects as unknown as Row[]).at(-1)?.id),"Проект: "+String(values.title||'обновлён'));
  if(kind==='tasks'||kind==='goals'){
    const target=id?(list.find(x=>x.id===id)?.project_id):values.project_id;
    writeActivity(data,Number(target)||null,(id?'Обновлено: ':'Создано: ')+String(values.title||list.find(x=>x.id===id)?.title||''));
  }
  storeDemo(data);
}
async function demoRemove(kind:Kind,id:number,expectedRevision?:number):Promise<void>{
  const data=loadDemo();
  const list=data[kind] as unknown as Row[];
  const idx=list.findIndex(x=>x.id===id);
  if(idx<0)throw Error('Запись не найдена');
  checkRevision(Number(list[idx].revision)||1,expectedRevision);
  list.splice(idx,1);
  if(kind==='areas'){
    data.projects.forEach(x=>{
      x.area_ids=(x.area_ids||[]).filter(areaId=>areaId!==id);
      x.area_id=x.area_ids[0]??null;
    });
    data.goals.forEach(x=>{if(x.area_id===id)x.area_id=null});
    data.tasks.forEach(x=>{if(x.area_id===id)x.area_id=null});
  }
  if(kind==='projects'){
    data.milestones=(data.milestones||[]).filter(m=>m.project_id!==id);
    data.activity=(data.activity||[]).filter(a=>a.project_id!==id);
    data.tasks.forEach(x=>{if(x.project_id===id)x.project_id=null});
    data.goals.forEach(x=>{if(x.project_id===id)x.project_id=null});
  }
  if(kind==='goals')data.tasks.forEach(x=>{if(x.goal_id===id)x.goal_id=null});
  if(kind==='tasks'){
    data.checklist=(data.checklist||[]).filter(item=>item.task_id!==id);
    data.tasks.forEach(x=>{if(x.parent_id===id)x.parent_id=null});
    data.occurrences=(data.occurrences||[]).filter(x=>x.task_id!==id);
  }
  storeDemo(data);
}
async function exportData():Promise<unknown>{
  return isDemo
    ? {exported_at:new Date().toISOString(),version:1,storage:'browser-demo',data:loadDemo()}
    : request<unknown>('/api/export');
}
async function download(){
  const json=JSON.stringify(isDemo?await exportData():await offlineEngine.exportBackup(),null,2);
  const blob=new Blob([json],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download='personalmanagement-'+(isDemo?'demo-':'')+dayKey(new Date())+'.json';
  document.body.append(link);
  link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function resetDemo(){
  if(!isDemo)throw Error('Сброс доступен только в деморежиме');
  const data=initialDemo();
  storeDemo(data);
  return data;
}

const ALLOWED_OCCURRENCE_FIELDS=new Set(['title','notes','priority','important','urgent','status','scheduled_at','due_at','duration_minutes','color','area_id','project_id','goal_id']);
async function saveOccurrence(taskId:number,day:string,changes:Row,revision?:number):Promise<void>{
  if(!isDemo&&offlineDraft===null){
    await offlineEngine.mutate({action:'occurrence',kind:'tasks',item_id:taskId,day,values:changes,revision});
    return;
  }
  const data=loadDemo();
  const task=data.tasks.find(x=>x.id===taskId);
  if(!task||!isOccurrenceDate(task,day))throw Error('Дата не относится к серии');
  checkRevision(task.revision,revision);
  if(Object.keys(changes).some(k=>!ALLOWED_OCCURRENCE_FIELDS.has(k)))throw Error('Некорректные поля повторения');
  if(changes.scheduled_at!==undefined&&!hasScheduledTime(changes.scheduled_at))
    throw Error('Укажите дату и время');
  if(changes.duration_minutes!==undefined&&!isValidTaskDuration(changes.duration_minutes))
    throw Error('Продолжительность: от 30 минут, шаг 15 минут');
  if(changes.status!==undefined&&!['inbox','planned','in_progress','waiting','done','someday','cancelled'].includes(String(changes.status)))
    throw Error('Некорректный статус');
  const index=(data.occurrences||[]).findIndex(x=>x.task_id===taskId&&x.occurrence_date===day);
  if(index>=0)data.occurrences![index].changes={...data.occurrences![index].changes,...changes};
  else (data.occurrences ||= []).push({task_id:taskId,occurrence_date:day,changes});
  task.revision=(task.revision||1)+1;
  storeDemo(data);
}
async function resetOccurrence(taskId:number,day:string,revision?:number):Promise<void>{
  if(!isDemo&&offlineDraft===null){
    await offlineEngine.mutate({action:'reset_occurrence',kind:'tasks',item_id:taskId,day,values:{},revision});
    return;
  }
  const data=loadDemo();
  const task=data.tasks.find(x=>x.id===taskId);
  if(!task||!isOccurrenceDate(task,day))throw Error('Дата не относится к серии');
  checkRevision(task.revision,revision);
  data.occurrences=(data.occurrences||[]).filter(x=>!(x.task_id===taskId&&x.occurrence_date===day));
  task.revision=(task.revision||1)+1;
  storeDemo(data);
}
async function splitSeries(taskId:number,day:string,changes:Row,revision?:number):Promise<void>{
  if(!isDemo&&offlineDraft===null){
    await offlineEngine.mutate({action:'split',kind:'tasks',item_id:taskId,day,values:changes,revision});
    return;
  }
  const data=loadDemo();
  const old=data.tasks.find(x=>x.id===taskId);
  if(!old||!isOccurrenceDate(old,day))throw Error('Дата не относится к серии');
  checkRevision(old.revision,revision);
  if(day===old.scheduled_at?.slice(0,10))throw Error('Для первого повтора измените всю серию');
  const existing=(data.occurrences||[]).find(x=>x.task_id===taskId&&x.occurrence_date===day)?.changes||{};
  const nextId=Math.max(0,...data.tasks.map(t=>t.id))+1;
  const newTask={...old,...existing,...changes,id:nextId,revision:1,
    scheduled_at:day+old.scheduled_at!.slice(10),created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  if(changes.scheduled_at)newTask.scheduled_at=String(changes.scheduled_at);
  if(!hasScheduledTime(newTask.scheduled_at)||!isValidTaskDuration(newTask.duration_minutes))
    throw Error('Некорректное начало новой серии');
  old.recurrence_until=beforeDate(day);
  old.revision=(old.revision||1)+1;
  data.tasks.push(newTask);
  data.occurrences=(data.occurrences||[]).map(x=>x.task_id===taskId&&x.occurrence_date>=day?
    {...x,task_id:nextId}:x).filter(x=>!(x.task_id===nextId&&x.occurrence_date===day));
  storeDemo(data);
}


type ExtraKind='checklist'|'milestones';
function writeActivity(data:Store,projectId:number|null,message:string){
 if(!projectId)return;
 const records=data.activity||[];
 const id=Math.max(0,...records.map(x=>x.id))+1;
 records.unshift({id,project_id:projectId,message,happened_at:new Date().toISOString()});
 data.activity=records.slice(0,500);
}
async function createExtra(kind:ExtraKind,parentId:number,details:Row):Promise<void>{
 if(!isDemo&&offlineDraft===null){
   await offlineEngine.mutate({action:'extra_add',kind,parent_id:parentId,values:details});
   return;
 }
 const title=String(details.title||'').trim();
 if(!title||title.length>250)throw Error('Введите название');
 const data=loadDemo();
 if(kind==='checklist'&&!data.tasks.some(task=>task.id===parentId))throw Error('Задача не найдена');
 if(kind==='milestones'&&!data.projects.some(project=>project.id===parentId))throw Error('Проект не найден');
 const list=(kind==='checklist'?data.checklist:data.milestones)||[];
 const id=Math.max(0,...list.map(item=>item.id))+1;
 const position=1+list.filter(item=>kind==='checklist'?'task_id' in item&&item.task_id===parentId:'project_id' in item&&item.project_id===parentId).length;
 if(kind==='checklist'){
   (data.checklist||=[]).push({id,task_id:parentId,title,done:0,position,revision:1});
   writeActivity(data,data.tasks.find(task=>task.id===parentId)?.project_id||null,'Чек-лист: '+title);
 }else{
   const date=details.due_date;
   if(date!=null&&!/^\d{4}-\d{2}-\d{2}$/.test(String(date)))throw Error('Неверная дата этапа');
   (data.milestones||=[]).push({id,project_id:parentId,title,done:0,position,due_date:date?String(date):null,revision:1});
   writeActivity(data,parentId,'Новый этап: '+title);
 }
 storeDemo(data);
}
async function updateExtra(kind:ExtraKind,parentId:number,id:number,details:Row,revision?:number):Promise<void>{
 if(!isDemo&&offlineDraft===null){
   await offlineEngine.mutate({action:'extra_update',kind,parent_id:parentId,item_id:id,values:details,revision:revision??1});
   return;
 }
 const data=loadDemo();
 const list=kind==='checklist'?data.checklist:data.milestones;
 const row=list?.find(item=>item.id===id&&(kind==='checklist'?'task_id' in item&&item.task_id===parentId:'project_id' in item&&item.project_id===parentId));
 if(!row)throw Error('Элемент не найден');
 checkRevision(row.revision??1,revision);
 if(details.done!==undefined&&![0,1,false,true].includes(details.done as number|boolean))throw Error('Неверный статус');
 if(details.title!==undefined&&(!String(details.title).trim()||String(details.title).length>250))throw Error('Неверное название');
 if(details.due_date!==undefined&&details.due_date!==null&&!/^\d{4}-\d{2}-\d{2}$/.test(String(details.due_date)))throw Error('Неверная дата');
 Object.assign(row,details);
 row.revision=(row.revision||1)+1;
 const projectId=kind==='milestones'?parentId:data.tasks.find(task=>task.id===parentId)?.project_id||null;
 writeActivity(data,projectId,(details.done===1?'Выполнено: ':'Изменено: ')+row.title);
 storeDemo(data);
}
async function removeExtra(kind:ExtraKind,parentId:number,id:number,revision?:number):Promise<void>{
 if(!isDemo&&offlineDraft===null){
   await offlineEngine.mutate({action:'extra_remove',kind,parent_id:parentId,item_id:id,values:{},revision:revision??1});
   return;
 }
 const data=loadDemo();
 const list=kind==='checklist'?data.checklist:data.milestones;
 const row=list?.find(item=>item.id===id&&(kind==='checklist'?'task_id' in item&&item.task_id===parentId:'project_id' in item&&item.project_id===parentId));
 if(!row)throw Error('Элемент не найден');
 checkRevision(row.revision??1,revision);
 if(kind==='checklist')data.checklist=(data.checklist||[]).filter(item=>item.id!==id);
 else data.milestones=(data.milestones||[]).filter(item=>item.id!==id);
 writeActivity(data,kind==='milestones'?parentId:data.tasks.find(task=>task.id===parentId)?.project_id||null,'Удалено: '+row.title);
 storeDemo(data);
}


/** Run the existing local edit rules against an isolated IndexedDB snapshot. */
async function completeGoalLocal(taskId:number,day:string|undefined,values:Row,revision?:number){
 const data=loadDemo();
 const task=data.tasks.find(t=>t.id===taskId);
 if(!task)throw Error('Задача не найдена');
 checkRevision(task.revision,revision);
 const effective={...task,...(day?data.occurrences?.find(x=>x.task_id===taskId&&x.occurrence_date===day)?.changes:{})};
 const changes=values.changes as Row;
 const goal=data.goals.find(g=>g.id===values.goal_id);
 const amount=Number(values.amount);
 if(!goal||effective.status==='done'||effective.status==='cancelled'||(changes.goal_id===undefined?effective.goal_id:changes.goal_id)!==goal.id||!Number.isFinite(amount)||amount<0||amount>1e12)throw Error('Некорректный вклад в цель');
 // Update both records in the same local draft/IndexedDB transaction.
 if(day)await saveOccurrence(taskId,day,changes,revision);
 else await demoSave('tasks',changes,taskId,revision);
 const updated=loadDemo();
 const g=updated.goals.find(x=>x.id===goal.id)!;
 const direction=g.target_value>=g.start_value?1:-1;
 const distance=Math.abs(g.target_value-g.start_value);
 const remaining=Math.max(0,(g.target_value-g.current_value)*direction);
 const advance=g.done?0:Math.min(remaining,g.measurable===0?amount*distance/100:amount);
 if(advance>0){
  g.current_value+=direction*advance;
  if(g.measurable===0&&advance>=remaining)g.done=1;
  g.revision=(g.revision||1)+1;
 }
 storeDemo(updated);
}
async function applyOffline(data:Store,operation:OfflineOperation):Promise<Store>{
 if(offlineDraft!==null)throw Error('Одновременная локальная операция не поддерживается');
 offlineDraft=structuredClone(data);
 try{
  const kind=operation.kind;
  const before=new Set<number>(
   kind==='checklist'?(offlineDraft.checklist||[]).map(x=>x.id):
   kind==='milestones'?(offlineDraft.milestones||[]).map(x=>x.id):
   (offlineDraft[kind as Kind] as Array<{id:number}>).map(x=>x.id)
  );
  switch(operation.action){
   case 'complete_goal':await completeGoalLocal(operation.item_id!,operation.day,operation.values,operation.revision);break;
   case 'save':await demoSave(kind as Kind,{...operation.values},operation.item_id,operation.revision);break;
   case 'remove':await demoRemove(kind as Kind,operation.item_id!,operation.revision);break;
   case 'occurrence':await saveOccurrence(operation.item_id!,operation.day!,{...operation.values},operation.revision);break;
   case 'reset_occurrence':await resetOccurrence(operation.item_id!,operation.day!,operation.revision);break;
   case 'split':await splitSeries(operation.item_id!,operation.day!,{...operation.values},operation.revision);break;
   case 'extra_add':await createExtra(kind as ExtraKind,operation.parent_id!,{...operation.values});break;
   case 'extra_update':await updateExtra(kind as ExtraKind,operation.parent_id!,operation.item_id!,{...operation.values},operation.revision);break;
   case 'extra_remove':await removeExtra(kind as ExtraKind,operation.parent_id!,operation.item_id!,operation.revision);break;
  }
  const updated=offlineDraft;
  if(operation.temp_id!==undefined){
   const collection=operation.action==='split'?updated.tasks:
    kind==='checklist'?(updated.checklist||[]):
    kind==='milestones'?(updated.milestones||[]):
    updated[kind as Kind];
   const created=collection.find(x=>!before.has(x.id));
   if(!created)throw Error('Не найдена новая запись для офлайн-ID');
   const oldId=created.id;
   created.id=operation.temp_id;
   if(operation.action==='split')
    updated.occurrences=(updated.occurrences||[]).map(x=>x.task_id===oldId?{...x,task_id:operation.temp_id!}:x);
   if(kind==='projects')
    updated.activity=(updated.activity||[]).map(x=>x.project_id===oldId?{...x,project_id:operation.temp_id!}:x);
  }
  return updated;
 }finally{offlineDraft=null;}
}
const offlineEngine=new OfflineEngine(applyOffline);

export const api={
  load:()=>isDemo?Promise.resolve(loadDemo()):offlineEngine.load(),
  save:(kind:Kind,data:Row,id?:number,revision?:number)=>isDemo?demoSave(kind,data,id,revision):offlineEngine.mutate({action:'save',kind,item_id:id,values:data,revision}),
  remove:(kind:Kind,id:number,revision?:number)=>isDemo?demoRemove(kind,id,revision):offlineEngine.mutate({action:'remove',kind,item_id:id,values:{},revision}),
  download,
  resetDemo,
  offline:offlineEngine,
  completeGoal:(taskId:number,day:string|undefined,changes:Row,goalId:number,amount:number,revision?:number)=>{
   const values={changes,goal_id:goalId,amount};
   return isDemo?completeGoalLocal(taskId,day,values,revision):offlineEngine.mutate({action:'complete_goal',kind:'tasks',item_id:taskId,day,values,revision});
  },
  saveOccurrence,
  resetOccurrence,
  splitSeries,
  addChecklist:(taskId:number,title:string)=>createExtra('checklist',taskId,{title}),
  updateChecklist:(taskId:number,id:number,changes:Row,revision?:number)=>updateExtra('checklist',taskId,id,changes,revision),
  deleteChecklist:(taskId:number,id:number,revision?:number)=>removeExtra('checklist',taskId,id,revision),
  addMilestone:(projectId:number,title:string,due_date?:string|null)=>createExtra('milestones',projectId,{title,due_date:due_date||null}),
  updateMilestone:(projectId:number,id:number,changes:Row,revision?:number)=>updateExtra('milestones',projectId,id,changes,revision),
  deleteMilestone:(projectId:number,id:number,revision?:number)=>removeExtra('milestones',projectId,id,revision)
};
