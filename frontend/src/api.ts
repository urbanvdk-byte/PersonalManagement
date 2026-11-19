import type {Kind,Store} from './types';
import {addDays,dateTimeLocal,dayKey,weekStart} from './date';
import {DEFAULT_TASK_COLOR} from './taskPalette';
import {hasScheduledTime,isValidTaskDuration} from './taskValidation';
import {isOccurrenceDate,beforeDate} from './recurrence';

// GitHub Pages has no backend. This isolated adapter stores only DEMO data in this browser.
// The production build keeps using the FastAPI + SQLite endpoints unchanged.
export const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';
const STORAGE_KEY = 'personalmanagement:pages-demo:v1';

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
    ],
    occurrences:[],
    events:[
      {id:1,title:'Тестовая встреча',area_id:1,project_id:1,notes:'Вымышленное событие',starts_at:slot(now,14),ends_at:slot(now,15),color:'#f0b23c',created_at},
      {id:2,title:'Личное время',area_id:3,project_id:null,notes:'Демонстрационный блок',starts_at:slot(addDays(now,2),19),ends_at:slot(addDays(now,2),20),color:'#3c9ee5',created_at}
    ]
  };
}
function loadDemo():Store{
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw){
      const data=JSON.parse(raw) as Store;
      if(['areas','projects','goals','tasks','events'].every(k=>Array.isArray(data[k as Kind]))){
        if(!Array.isArray(data.occurrences))data.occurrences=[];
        for(const project of data.projects){
          if(!Array.isArray(project.area_ids))project.area_ids=project.area_id?[project.area_id]:[];
        }
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
function storeDemo(data:Store){localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}
type Row=Record<string,unknown>;
const defaults:Record<Kind,Row>={
  areas:{color:'#4689db',emoji:'📁'},
  projects:{area_id:null,area_ids:[],description:'',status:'active',start_date:null,due_date:null},
  goals:{area_id:null,project_id:null,description:'',period_start:null,period_end:null,start_value:0,target_value:1,current_value:0,unit:''},
  tasks:{area_id:null,project_id:null,goal_id:null,parent_id:null,notes:'',priority:4,important:0,urgent:0,status:'inbox',scheduled_at:null,due_at:null,duration_minutes:60,recurrence:'',recurrence_until:null,color:DEFAULT_TASK_COLOR},
  events:{area_id:null,project_id:null,notes:'',color:'#f3bb28'}
};
async function demoSave(kind:Kind,values:Row,id?:number):Promise<void>{
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
    if(kind==='tasks'&&String(values.recurrence??row.recurrence??'')&&!String(values.scheduled_at??row.scheduled_at??''))
      throw Error('Для повторяющейся задачи нужна дата и время');
    Object.assign(row,values);
    if(kind==='projects'){
      if(values.area_ids!==undefined)row.area_id=(values.area_ids as number[])[0]??null;
      else if(values.area_id!==undefined)row.area_ids=values.area_id?[values.area_id]:[];
    }
    if(kind==='tasks')row.updated_at=stamp;
  }else{
    if(!String(values.title||'').trim())throw Error('Укажите название');
    if(kind==='events'&&(!values.starts_at||!values.ends_at||String(values.starts_at)>=String(values.ends_at)))
      throw Error('Укажите корректное начало и окончание события');
    if(kind==='tasks'&&values.recurrence&&!values.scheduled_at)
      throw Error('Для повторяющейся задачи нужна дата и время');
    if(kind==='projects'&&values.area_ids===undefined)
      values.area_ids=values.area_id?[values.area_id]:[];
    const newId=Math.max(0,...list.map(x=>Number(x.id)||0))+1;
    list.push({...defaults[kind],...values,id:newId,created_at:stamp,...(kind==='tasks'?{updated_at:stamp}:{})});
  }
  storeDemo(data);
}
async function demoRemove(kind:Kind,id:number):Promise<void>{
  const data=loadDemo();
  const list=data[kind] as unknown as Row[];
  const idx=list.findIndex(x=>x.id===id);
  if(idx<0)throw Error('Запись не найдена');
  list.splice(idx,1);
  if(kind==='areas'){
    data.projects.forEach(x=>{
      x.area_ids=(x.area_ids||[]).filter(areaId=>areaId!==id);
      x.area_id=x.area_ids[0]??null;
    });
    data.goals.forEach(x=>{if(x.area_id===id)x.area_id=null});
    data.tasks.forEach(x=>{if(x.area_id===id)x.area_id=null});
    data.events.forEach(x=>{if(x.area_id===id)x.area_id=null});
  }
  if(kind==='projects'){
    data.tasks.forEach(x=>{if(x.project_id===id)x.project_id=null});
    data.goals.forEach(x=>{if(x.project_id===id)x.project_id=null});
    data.events.forEach(x=>{if(x.project_id===id)x.project_id=null});
  }
  if(kind==='goals')data.tasks.forEach(x=>{if(x.goal_id===id)x.goal_id=null});
  if(kind==='tasks'){
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
  const json=JSON.stringify(await exportData(),null,2);
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
async function saveOccurrence(taskId:number,day:string,changes:Row):Promise<void>{
  if(!isDemo){
    await request('/api/task-occurrences/'+taskId+'/'+day,{method:'PUT',body:JSON.stringify({changes})});
    return;
  }
  const data=loadDemo();
  const task=data.tasks.find(x=>x.id===taskId);
  if(!task||!isOccurrenceDate(task,day))throw Error('Дата не относится к серии');
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
  storeDemo(data);
}
async function resetOccurrence(taskId:number,day:string):Promise<void>{
  if(!isDemo){await request<void>('/api/task-occurrences/'+taskId+'/'+day,{method:'DELETE'});return;}
  const data=loadDemo();
  data.occurrences=(data.occurrences||[]).filter(x=>!(x.task_id===taskId&&x.occurrence_date===day));
  storeDemo(data);
}
async function splitSeries(taskId:number,day:string,changes:Row):Promise<void>{
  if(!isDemo){
    await request('/api/task-series/'+taskId+'/split',{method:'POST',body:JSON.stringify({occurrence_date:day,changes})});
    return;
  }
  const data=loadDemo();
  const old=data.tasks.find(x=>x.id===taskId);
  if(!old||!isOccurrenceDate(old,day))throw Error('Дата не относится к серии');
  if(day===old.scheduled_at?.slice(0,10))throw Error('Для первого повтора измените всю серию');
  const existing=(data.occurrences||[]).find(x=>x.task_id===taskId&&x.occurrence_date===day)?.changes||{};
  const nextId=Math.max(0,...data.tasks.map(t=>t.id))+1;
  const newTask={...old,...existing,...changes,id:nextId,
    scheduled_at:day+old.scheduled_at!.slice(10),created_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  if(changes.scheduled_at)newTask.scheduled_at=String(changes.scheduled_at);
  if(!hasScheduledTime(newTask.scheduled_at)||!isValidTaskDuration(newTask.duration_minutes))
    throw Error('Некорректное начало новой серии');
  old.recurrence_until=beforeDate(day);
  data.tasks.push(newTask);
  data.occurrences=(data.occurrences||[]).map(x=>x.task_id===taskId&&x.occurrence_date>=day?
    {...x,task_id:nextId}:x).filter(x=>!(x.task_id===nextId&&x.occurrence_date===day));
  storeDemo(data);
}

export const api={
  load:()=>isDemo?Promise.resolve(loadDemo()):request<Store>('/api/bootstrap'),
  save:(kind:Kind,data:Row,id?:number)=>isDemo?demoSave(kind,data,id):request('/api/'+kind+(id?'/'+id:''),{method:id?'PATCH':'POST',body:JSON.stringify(data)}),
  remove:(kind:Kind,id:number)=>isDemo?demoRemove(kind,id):request<void>('/api/'+kind+'/'+id,{method:'DELETE'}),
  download,
  resetDemo,
  saveOccurrence,
  resetOccurrence,
  splitSeries
};
