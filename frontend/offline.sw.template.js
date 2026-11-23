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
