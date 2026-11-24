import {useState} from 'react';
import {Check,Plus,Trash2} from 'lucide-react';
import {api} from './api';
import type {ChecklistItem} from './types';
export default function TaskChecklist({taskId,items,reload}:{
 taskId:number;items:ChecklistItem[];reload:()=>Promise<void>;
}){
 const [title,setTitle]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 async function change(action:()=>Promise<void>){
   setBusy(true);setError('');
   try{await action();await reload();}
   catch(e){setError(e instanceof Error?e.message:String(e))}
   finally{setBusy(false)}
 }
 const done=items.filter(item=>item.done).length;
 return <section className="checklist-editor">
   <h3>Чек-лист <small>{done}/{items.length}</small></h3>
   {items.map(item=><div className="checklist-item" key={item.id}>
     <label><input type="checkbox" checked={Boolean(item.done)} disabled={busy}
       onChange={e=>void change(()=>api.updateChecklist(taskId,item.id,{done:e.target.checked?1:0},item.revision))}/>
       <span className={item.done?'done':''}>{item.title}</span></label>
     <button type="button" aria-label={'Удалить пункт '+item.title} disabled={busy}
       onClick={()=>void change(()=>api.deleteChecklist(taskId,item.id,item.revision))}><Trash2 size={13}/></button>
   </div>)}
   <div className="checklist-add">
     <input aria-label="Новый пункт чек-листа" placeholder="Новый пункт…" value={title}
       onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(!busy&&title.trim())void change(async()=>{await api.addChecklist(taskId,title.trim());setTitle('')})}}}/>
     <button type="button" disabled={busy||!title.trim()} onClick={()=>void change(async()=>{await api.addChecklist(taskId,title.trim());setTitle('')})}><Plus size={15}/> Добавить</button>
   </div>
   {error&&<small role="alert" className="field-error">{error}</small>}
 </section>;
}
