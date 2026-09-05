import {createClient} from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const staging=path.resolve('private-materials');
const manifest=JSON.parse(await fs.readFile(path.join(staging,'manifest.json'),'utf8'));
if(manifest.schema_version!==1)throw new Error('Unsupported private manifest.');
for(const r of manifest.resources){
  const resolved=path.resolve(staging,r.local_path);
  if(!resolved.startsWith(staging+path.sep))throw new Error('Material escapes private staging directory.');
  const bytes=await fs.readFile(resolved);
  if(createHash('sha256').update(bytes).digest('hex')!==r.sha256)throw new Error('Prepared material checksum mismatch. Re-run preparation.');
  if(!['never','scheduled','immediate'].includes(r.student_policy))throw new Error('Invalid publication policy.');
  if(r.student_policy==='scheduled'&&!r.release_at)throw new Error('Missing release date.');
}
if(!process.argv.includes('--apply')){
  console.log(JSON.stringify({mode:'dry-run',lessons:manifest.lessons.length,resources:manifest.resources.length,
    policies:Object.fromEntries(['never','scheduled','immediate'].map(p=>[p,manifest.resources.filter(r=>r.student_policy===p).length])),
    note:'No cloud changes. Existing records will be preserved when importing.'},null,2));
  process.exit(0);
}
const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url||!key)throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in an ignored .local/ops.env file.');
if(!url.startsWith('https://'))throw new Error('Use HTTPS for the target Supabase project.');
if(key.startsWith('eyJ')){
  const payload=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());
  if(payload.role!=='service_role')throw new Error('Operator import requires service-role credentials.');
}else if(!key.startsWith('sb_secret_'))throw new Error('Operator import requires a Supabase secret key.');
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
function check(result,context){if(result.error)throw new Error(context+' failed ('+(result.error.code||result.error.status||'unknown')+'). No credentials were printed.');return result.data;}
const bucket=check(await client.storage.getBucket('course-materials'),'Private bucket check');
if(bucket.public)throw new Error('Refusing import: course-materials must be private.');
const lessons=check(await client.from('lessons').select('*'),'Lesson read');
let seeded=0,added=0,skipped=0;
for(const row of manifest.lessons){
  const existing=lessons.find(l=>l.id===row.id);
  if(!existing)throw new Error('Apply all migrations before importing.');
  if(existing.version===1&&!existing.starts_at){
    // Keep an edited timetable intact on every repeat import.
    const summary=row.summary.split(/[。！？]/)[0]+'。';
    check(await client.from('lessons').update({...row,summary}).eq('id',row.id).eq('version',1),'Lesson seed');seeded++;
  }
}
const existing=check(await client.from('resources').select('id'),'Resource read');
const ids=new Set(existing.map(r=>r.id));
for(const entry of manifest.resources){
  if(ids.has(entry.id)){skipped++;continue;}
  const {local_path,sha256,...row}=entry;
  const bytes=await fs.readFile(path.resolve(staging,local_path));
  const upload=await client.storage.from('course-materials').upload(row.storage_path,bytes,{upsert:false,contentType:row.mime_type,cacheControl:'0'});
  if(upload.error){
    // A prior interrupted import may have uploaded this immutable path already.
    // Check exact bytes before safely continuing; never overwrite an object.
    const remote=await client.storage.from('course-materials').download(row.storage_path);
    if(remote.error)throw new Error('Private upload failed. Resolve connection/permission and retry; existing data was not overwritten.');
    const remoteHash=createHash('sha256').update(Buffer.from(await remote.data.arrayBuffer())).digest('hex');
    if(remoteHash!==sha256)throw new Error('An existing storage path has different bytes. Refusing to overwrite.');
  }
  check(await client.from('resources').insert(row),'Resource insert');added++;
  console.log('Imported',added,'of',manifest.resources.length-skipped,'new resource records.');
}
console.log(JSON.stringify({seeded_lessons:seeded,added_resources:added,preserved_existing_resources:skipped},null,2));
