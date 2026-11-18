import type {Kind,Store} from './types';
import {addDays,dateTimeLocal,dayKey,weekStart} from './date';
import {DEFAULT_TASK_COLOR} from './taskPalette';
import {hasScheduledTime,isValidTaskDuration} from './taskValidation';

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
      {id:1,title:'Демонстрационный проект',area_id:1,description:'Пример связи проекта с задачами и целью',status:'active',start_date:today,due_date:dayKey(addDays(mon,18)),created_at}
    ],
    goals:[
      {id:1,title:'Провести 4 тренировки за месяц',area_id:2,project_id:null,description:'Пример измеримой цели',period_start:goalStart,period_end:goalEnd,start_value:0,target_value:4,current_value:1,unit:'тренировки',created_at},
      {id:2,title:'Выполнить 5 шагов учебного проекта',area_id:1,project_id:1,description:'Цель для демонстрационного проекта',period_start:today,period_end:dayKey(addDays(mon,18)),start_value:0,target_value:5,current_value:1,unit:'шагов',created_at}
    ],
    tasks:[
      {id:1,title:'Обсудить план проекта',area_id:1,project_id:1,goal_id:2,parent_id:null,notes:'Вымышленная задача для тестирования интерфейса',priority:1,important:1,urgent:1,status:'planned',scheduled_at:slot(now,10),due_at:slot(addDays(now,1),18),duration_minutes:60,recurrence:'',color:DEFAULT_TASK_COLOR,created_at,updated_at:created_at},
      {id:2,title:'Провести тренировку',area_id:2,project_id:null,goal_id:1,parent_id:null,notes:'Пример задачи из направления Здоровье',priority:2,important:1,urgent:0,status:'planned',scheduled_at:slot(addDays(now,1),18),due_at:null,duration_minutes:60,recurrence:'',color:'#39aa6f',created_at,updated_at:created_at},
      {id:3,title:'Разобрать покупки на неделю',area_id:3,project_id:null,goal_id:null,parent_id:null,notes:'Пример повседневного дела',priority:3,important:0,urgent:1,status:'inbox',scheduled_at:null,due_at:slot(addDays(now,2),17),duration_minutes:30,recurrence:'',color:'#ff963b',created_at,updated_at:created_at},
      {id:4,title:'Идея для будущего проекта',area_id:1,project_id:null,goal_id:null,parent_id:null,notes:'Сохранено на потом',priority:4,important:0,urgent:0,status:'someday',scheduled_at:null,due_at:null,duration_minutes:30,recurrence:'',color:'#9463d6',created_at,updated_at:created_at}
    ],
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
      if(['areas','projects','goals','tasks','events'].every(k=>Array.isArray(data[k as Kind])))return data;
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
  projects:{area_id:null,description:'',status:'active',start_date:null,due_date:null},
  goals:{area_id:null,project_id:null,description:'',period_start:null,period_end:null,start_value:0,target_value:1,current_value:0,unit:''},
  tasks:{area_id:null,project_id:null,goal_id:null,parent_id:null,notes:'',priority:4,important:0,urgent:0,status:'inbox',scheduled_at:null,due_at:null,duration_minutes:60,recurrence:'',color:DEFAULT_TASK_COLOR},
  events:{area_id:null,project_id:null,notes:'',color:'#f3bb28'}
};
async function demoSave(kind:Kind,values:Row,id?:number):Promise<void>{
  if('title' in values&&(!String(values.title||'').trim()))throw Error('Укажите название');
  if(kind==='tasks'){
    if((!id || Object.prototype.hasOwnProperty.call(values,'scheduled_at'))&&!hasScheduledTime(values.scheduled_at)){
      throw Error('Укажите обязательные дату и время задачи');
    }
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
    Object.assign(row,values);
    if(kind==='tasks')row.updated_at=stamp;
  }else{
    if(!String(values.title||'').trim())throw Error('Укажите название');
    if(kind==='events'&&(!values.starts_at||!values.ends_at||String(values.starts_at)>=String(values.ends_at)))
      throw Error('Укажите корректное начало и окончание события');
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
    data.projects.forEach(x=>{if(x.area_id===id)x.area_id=null});
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
  if(kind==='tasks')data.tasks.forEach(x=>{if(x.parent_id===id)x.parent_id=null});
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
export const api={
  load:()=>isDemo?Promise.resolve(loadDemo()):request<Store>('/api/bootstrap'),
  save:(kind:Kind,data:Row,id?:number)=>isDemo?demoSave(kind,data,id):request('/api/'+kind+(id?'/'+id:''),{method:id?'PATCH':'POST',body:JSON.stringify(data)}),
  remove:(kind:Kind,id:number)=>isDemo?demoRemove(kind,id):request<void>('/api/'+kind+'/'+id,{method:'DELETE'}),
  download,
  resetDemo
};
