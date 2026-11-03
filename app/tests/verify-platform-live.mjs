import {mkdir,writeFile} from 'node:fs/promises';
import {BrowserBridge} from '../browser.mjs';

// Opt-in student GETs only: no playback, answer submissions or completion updates.
const bridge=new BrowserBridge();
bridge.background=true;
const platforms=[];
try {
  for(const platform of ['school','official']) {
    try {
      bridge.platform=platform;
      await bridge.connect(process.env.YKT_CDP || 'http://[::1]:9222');
      const page=await bridge.evaluate(bridge.dataPage,'({origin:location.origin,path:location.pathname})');
      const entry={platform,...page};
      platforms.push(entry);
      const courses=await bridge.courses();
      Object.assign(entry,{count:courses.length,ids:courses.map(c=>Number(c.classroom_id)).sort((a,b)=>a-b)});
    } catch(error) {
      const entry=platforms.find(p=>p.platform===platform);
      if(entry)entry.error=error.message;else platforms.push({platform,error:error.message});
    } finally { await bridge.close(); }
  }
  const sameCourses=platforms.every(p=>Array.isArray(p.ids))&&JSON.stringify(platforms[0].ids)===JSON.stringify(platforms[1].ids);
  await mkdir('.local',{recursive:true});
  await writeFile('.local/platform-verification.json',JSON.stringify({time:new Date().toISOString(),platforms,sameCourses},null,2));
  console.log(JSON.stringify({platforms:platforms.map(({ids,...p})=>p),sameCourses}));
  if(!sameCourses)throw new Error('当前会话未通过两版课程列表校验；请查看登录错误或课程差异');
} finally { await bridge.close(); }
