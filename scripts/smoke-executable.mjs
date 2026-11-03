import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platform = process.platform === 'win32' ? 'windows' : 'linux';
const pkg = JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const executable = path.join(root,'dist',`YuketangStudyDesk-${pkg.version}-${platform}-${process.arch}${process.platform==='win32'?'.exe':''}`);
const dataDirectory = path.join(root,'.build','smoke-data-'+Date.now());
await mkdir(dataDirectory,{recursive:true});
const port = await new Promise((resolve,reject)=>{
  const socket = createServer();socket.once('error',reject);
  socket.listen(0,'127.0.0.1',()=>{const port=socket.address().port;socket.close(()=>resolve(port));});
});
const child = spawn(executable,['--no-open'],{
  cwd:dataDirectory,env:{...process.env,PORT:String(port),YKT_DATA_DIR:dataDirectory},windowsHide:true,stdio:['ignore','pipe','pipe'],
});
let logs='',finished=false;
const closed = new Promise(resolve=>{child.once('close',code=>{finished=true;resolve(code);});});
child.stdout.on('data',buffer=>{logs+=buffer;});child.stderr.on('data',buffer=>{logs+=buffer;});
let spawnError;child.once('error',error=>{spawnError=error;});
const base=`http://127.0.0.1:${port}`;
const assert=(value,message)=>{if(!value)throw new Error(message);};
let failure;
try {
  let ready=false;
  for(let attempt=0;attempt<80;attempt++){
    if(spawnError)throw spawnError;
    if(finished)throw new Error('程序提前退出：'+logs);
    try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1000)});const j=await r.json();if(r.ok&&j.ok&&j.packaged){ready=true;break;}}catch{}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  assert(ready,'独立程序未能启动：'+logs);
  const home=await fetch(base);const html=await home.text();
  assert(home.ok&&html.includes('雨课堂')&&html.includes('stopService'),'内嵌网页未正确返回');
  for(const filename of ['app.js','style.css']){
    const response=await fetch(base+'/'+filename);
    const served=Buffer.from(await response.arrayBuffer());
    const expected=await readFile(path.join(root,'app/public',filename));
    assert(response.ok&&served.equals(expected),'内嵌资源错误：'+filename);
  }
  const current=await(await fetch(base+'/api/state')).json();
  assert(current.courses.length===0 && current.connection.connected===false,'发布程序携带了个人课程或登录信息');
  const forbidden=await fetch(base+'/api/service/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert(forbidden.status===403,'停止服务接口缺少本地网页授权校验');
  const token=html.match(/name="local-token" content="([a-f0-9]+)"/)?.[1];
  assert(token,'未找到网页操作令牌');
  const response=await fetch(base+'/api/service/stop',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Local-Token':token},body:'{}'});
  assert(response.ok,'程序未能正常停止');
  const code=await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(new Error('退出超时')),5000))]);
  assert(code===0,'程序异常退出：'+code+' '+logs);
  assert(!(await readdir(dataDirectory)).some(name=>name.includes('profile')),'无操作验收不应创建登录浏览器配置');
  console.log(JSON.stringify({executable:path.basename(executable),port,packaged:true,embeddedAssetsVerified:true,personalDataIncluded:false,cleanExit:true,sha256:createHash('sha256').update(await readFile(executable)).digest('hex')}));
}catch(error){failure=error;}finally{
  if(!finished){child.kill();await closed;}
}
if(failure)throw failure;
