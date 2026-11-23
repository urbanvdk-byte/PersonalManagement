import {defineConfig,type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';

function offlineShell():Plugin{
 return {
  name:'personalmanagement-offline-shell',
  apply:'build',
  async closeBundle(){
   const output=join(process.cwd(),'dist');
   async function collect(dir:string):Promise<string[]>{
    const entries=await readdir(dir,{withFileTypes:true});
    const result:string[]=[];
    for(const entry of entries){
     const abs=join(dir,entry.name);
     if(entry.isDirectory())result.push(...await collect(abs));
     else if(/\.(html|js|css|svg|png|webp|webmanifest)$/.test(entry.name))
      result.push(relative(output,abs).replaceAll('\\','/'));
    }
    return result;
   }
   const assets=(await collect(output)).sort();
   const html=await readFile(join(output,'index.html'));
   const hash=createHash('sha256').update(assets.join('|')).update(html).digest('hex').slice(0,16);
   const template=await readFile(join(process.cwd(),'offline.sw.template.js'),'utf8');
   const serviceWorker=template
    .replace('__BUILD_VERSION__',hash)
    .replace('__PRECACHE_ASSETS__',JSON.stringify(assets));
   await writeFile(join(output,'sw.js'),serviceWorker);
  }
 };
}

export default defineConfig({
 base:process.env.VITE_BASE_PATH||'/',
 plugins:[react(),offlineShell()],
 server:{proxy:{'/api':{target:'http://127.0.0.1:3000',changeOrigin:true}}}
});
