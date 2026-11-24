import {useEffect,useState} from 'react';
import {Bell,BellOff} from 'lucide-react';

const supported=()=>window.isSecureContext&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;

async function request<T>(path:string,init?:RequestInit):Promise<T>{
 const response=await fetch('/api/push/'+path,{...init,cache:'no-store',headers:{'Content-Type':'application/json'}});
 if(!response.ok){
  const error=await response.json().catch(()=>({}));
  throw Error(typeof error.detail==='string'?error.detail:'Ошибка сервера: HTTP '+response.status);
 }
 return response.status===204?undefined as T:await response.json();
}
function keyBytes(value:string):Uint8Array<ArrayBuffer>{
 const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4));
 return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function registration(){
 const ready=await navigator.serviceWorker.getRegistration();
 if(!ready?.active)throw Error('Обновите страницу, чтобы установить службу уведомлений.');
 return ready;
}

const deviceZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
const syncSubscription=(sub:PushSubscription)=>request('subscription',{method:'PUT',body:JSON.stringify({...sub.toJSON(),timezone:deviceZone()})});

export default function PushSettings(){
 const [enabled,setEnabled]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const available=supported();
 useEffect(()=>{
  if(!available)return;
  let cancelled=false;
  navigator.serviceWorker.getRegistration().then(async reg=>{
   const sub=await reg?.pushManager.getSubscription();
   if(cancelled)return;
   if(sub&&Notification.permission==='granted'){
    setEnabled(true);
    try{await syncSubscription(sub)}catch{if(!cancelled)setMessage('Не удалось обновить серверную подписку. Проверьте интернет.');}
   }else setEnabled(false);
  }).catch(()=>{});
  return ()=>{cancelled=true};
 },[available]);
 async function toggle(){
  if(busy)return;
  setBusy(true);setMessage('');
  try{
   if(!enabled){
    // Request permission from the direct click, before other asynchronous work.
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw Error('Разрешите уведомления в настройках браузера и телефона.');
    const reg=await registration();
    const {publicKey}=await request<{publicKey:string}>('key');
    let sub=await reg.pushManager.getSubscription();
    if(sub){
     const existing=sub.options.applicationServerKey;
     const expected=keyBytes(publicKey);
     if(!existing||!new Uint8Array(existing).every((v,i)=>v===expected[i])||existing.byteLength!==expected.byteLength){
      await request('subscription',{method:'DELETE',body:JSON.stringify({endpoint:sub.endpoint})});
      await sub.unsubscribe();sub=null;
     }
    }
    if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(publicKey)});
    try{await syncSubscription(sub);}
    catch(error){await sub.unsubscribe().catch(()=>false);throw error;}
    setEnabled(true);setMessage('Напоминания включены на этом устройстве.');
   }else{
    const reg=await registration();
    const sub=await reg.pushManager.getSubscription();
    if(sub){
     await request('subscription',{method:'DELETE',body:JSON.stringify({endpoint:sub.endpoint})});
     await sub.unsubscribe();
    }
    setEnabled(false);setMessage('Напоминания отключены.');
   }
  }catch(error){setMessage(error instanceof Error?error.message:'Не удалось настроить уведомления.');}
  finally{setBusy(false);}
 }
 async function testDelivery(){
  setBusy(true);setMessage('');
  try{
   const reg=await registration(),sub=await reg.pushManager.getSubscription();
   if(!sub||Notification.permission!=='granted')throw Error('Сначала включите напоминания.');
   await syncSubscription(sub);
   const result=await request<{ok:boolean;timezone:string}>('test',{method:'POST',body:JSON.stringify({endpoint:sub.endpoint})});
   setMessage('Push-сервис принял тест. Часовой пояс: '+result.timezone+'. Проверьте шторку уведомлений.');
  }catch(error){setMessage(error instanceof Error?error.message:'Ошибка тестовой отправки.');}
  finally{setBusy(false);}
 }
 return <div className="push-settings">
  <button type="button" className="export-link" disabled={busy||!available} aria-pressed={enabled}
    onClick={()=>void toggle()}>{enabled?<BellOff size={15}/>:<Bell size={15}/>}
    {enabled?'Отключить напоминания':'Включить напоминания'}</button>
  <small>За 1 час до начала задачи</small>
  {enabled&&<><small>Часовой пояс: {deviceZone()}</small>
   <button type="button" className="export-link" disabled={busy} onClick={()=>void testDelivery()}>Проверить уведомление</button></>}
  {!available&&<small>Нужен браузер с поддержкой Web Push.</small>}
  {message&&<small role="status">{message}</small>}
 </div>;
}
