import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist');
let count=0;
async function scan(dir){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isSymbolicLink())throw new Error('Symlinks cannot be published.');
    if(entry.isDirectory()){await scan(full);continue;}
    if(!/\.(html|css|js|webp|png|ico|svg|woff2|txt)$/.test(entry.name))throw new Error('Unexpected public asset type: '+entry.name);
    if(/\.(html|js|css|txt)$/.test(entry.name)){
      const data=await fs.readFile(full,'utf8');
      if(/sb_secret_[A-Za-z0-9_-]+|DemoOnly!2026|admin@course\.invalid|private-materials\/manifest|REPLACE_WITH_VERIFIED_ADMIN_EMAIL/.test(data))throw new Error('Private/demo setup content found in public bundle.');
      for(const token of data.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[]){
        const payload=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
        if(payload.role!=='anon')throw new Error('Privileged JWT found in build.');
      }
    }
    count++;
  }
}
await scan(root);console.log('Public build inspected:',count,'files. No private materials or demo credentials.');
