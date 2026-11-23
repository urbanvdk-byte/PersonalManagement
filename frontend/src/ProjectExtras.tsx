import {useState} from 'react';
import {Check,Plus,Trash2} from 'lucide-react';
import {api} from './api';
import {fmtDate} from './date';
import type {ActivityItem,Milestone} from './types';
export function ProjectMilestones({projectId,items,reload}:{
 projectId:number;items:Milestone[];reload:()=>Promise<void>;
}){
 const [title,setTitle]=useState('');
 const [due,setDue]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 async function action(op:()=>Promise<void>){
   setBusy(true);setError('');
   try{await op();await reload();}
   catch(e){setError(e instanceof Error?e.message:String(e))}
   finally{setBusy(false)}
 }
 return <section className="project-section project-milestones">
   <header><div><h3>Этапы и контрольные точки</h3><small>{items.filter(x=>x.done).length} из {items.length} завершены</small></div></header>
   {items.map(item=><div className="milestone-row" key={item.id}>
     <label><input type="checkbox" checked={Boolean(item.done)} disabled={busy}
       onChange={e=>void action(()=>api.updateMilestone(projectId,item.id,{done:e.target.checked?1:0},item.revision))}/>
       <span className={item.done?'done':''}>{item.title}{item.due_date&&<small>До {fmtDate(item.due_date)}</small>}</span></label>
     <button type="button" disabled={busy} aria-label={'Удалить этап '+item.title}
       onClick={()=>void action(()=>api.deleteMilestone(projectId,item.id,item.revision))}><Trash2 size={14}/></button>
   </div>)}
   <div className="milestone-add">
     <input aria-label="Название нового этапа" placeholder="Новый этап проекта" value={title} onChange={e=>setTitle(e.target.value)}/>
     <input aria-label="Срок этапа" type="date" value={due} onChange={e=>setDue(e.target.value)}/>
     <button disabled={!title.trim()||busy} onClick={()=>void action(async()=>{
       await api.addMilestone(projectId,title.trim(),due||null);setTitle('');setDue('');
     })}><Plus size={14}/> Добавить</button>
   </div>
   {error&&<small role="alert" className="field-error">{error}</small>}
 </section>;
}
export function ProjectHistory({items}:{items:ActivityItem[]}){
 return <section className="project-section project-history">
   <header><div><h3>История активности</h3><small>Последние изменения проекта</small></div></header>
   {items.length?items.slice(0,12).map(item=><div className="history-row" key={item.id}>
     <span>{item.message}</span><small>{item.happened_at.slice(0,16).replace('T',' ')}</small>
   </div>):<p className="empty">История появится после первого действия с проектом.</p>}
 </section>;
}
