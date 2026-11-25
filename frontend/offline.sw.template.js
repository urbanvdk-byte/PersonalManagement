/* Version and asset list are injected by the Vite production build. */
const CACHE_NAME='personalmanagement-shell-'+'__BUILD_VERSION__';
const ASSETS=__PRECACHE_ASSETS__;
const root=new URL(self.registration.scope);
const shell=new URL('index.html',root).toString();
self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE_NAME);
  // Cache ONLY static app files, never authenticated API responses or user data.
  await cache.addAll(ASSETS.map(asset=>new URL(asset,root).toString()));
  await self.skipWaiting();
 })());
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const all=await caches.keys();
  await Promise.all(all.filter(k=>k.startsWith('personalmanagement-shell-')&&k!==CACHE_NAME)
   .map(k=>caches.delete(k)));
  await self.clients.claim();
 })());
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 if(url.origin!==root.origin||!url.pathname.startsWith(root.pathname))return;
 if(url.pathname.startsWith(new URL('api/',root).pathname)||url.pathname.startsWith('/api/'))return;
 if(request.mode==='navigate'){
  event.respondWith((async()=>{
   try{
    const response=await fetch(request);
    if(response.ok&&response.type!=='opaque'){
     const cache=await caches.open(CACHE_NAME);
     await cache.put(shell,response.clone());
    }
    return response;
   }catch{
    const cached=await caches.match(shell);
    return cached||Response.error();
   }
  })());
  return;
 }
 event.respondWith((async()=>{
  const cached=await caches.match(request);
  if(cached)return cached;
  const result=await fetch(request);
  if(result.ok&&url.pathname.startsWith(new URL('assets/',root).pathname)){
   const cache=await caches.open(CACHE_NAME);
   await cache.put(request,result.clone());
  }
  return result;
 })());
});

self.addEventListener('push',event=>{
 if(!event.data)return;
 let data;
 try{data=event.data.json()}catch{return}
 if(typeof data.title!=='string'||typeof data.body!=='string')return;
 // Notification title/body are native plain text. Use the large icon for
 // a color-coded priority circle; retain the textual P-number for accessibility.
 const priority=Number.isInteger(data.priority)&&data.priority>=1&&data.priority<=4?data.priority:null;
 const iconPath=priority===null?'brand-icon-v2-192.png':`push-priority-${priority}.png`;
 event.waitUntil(self.registration.showNotification(data.title,{
   body:data.body,icon:new URL(iconPath,root).toString(),
   tag:String(data.tag||'pm-task'),renotify:false,
   data:{url:typeof data.url==='string'?data.url:root.href}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
   let target;
   try{target=new URL(event.notification.data?.url||root.href,root)}catch{target=root}
   if(target.origin!==root.origin||!target.pathname.startsWith(root.pathname))target=root;
   const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
   const existing=windows.find(client=>client.url.startsWith(root.href));
   if(existing){
     try{const navigated=await existing.navigate(target.href);if(navigated){await navigated.focus();return}}catch{}
   }
   await self.clients.openWindow(target.href);
 })());
});
