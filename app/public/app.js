const $ = id => document.getElementById(id);
const extensionMode = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
const escape = text => String(text ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data = null, selectedCourse = null, filter = 'all', search = '', selected = new Set(), busy = false, changingSpeed = false;
const statusLabels = {pending:'未完成',unknown:'待核对',completed:'已完成',queued:'已排队',loading:'加载中',playing:'播放中',paused:'已暂停',verifying:'核对中',waiting_focus:'等待播放页',needs_attention:'等待处理',skipped:'已跳过',stopped:'已停止',failed:'失败'};
const queueLabels = {idle:'未开始',running:'进行中',paused:'已暂停',waiting_focus:'等待播放页',needs_attention:'等待处理',stopping:'停止中',stopped:'已停止',finished:'已结束'};
const typeLabels = {0:'视频',1:'音频',2:'直播',3:'图文',4:'讨论',5:'练习',6:'作业',7:'课件',8:'课堂',9:'其他'};
function toast(text) { $('toast').textContent=text; $('toast').hidden=false; clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('toast').hidden=true,6000); }
async function api(route,input={}) {
  if (extensionMode) {
    const result = await chrome.runtime.sendMessage({kind:'study-desk-action',route,input});
    if (!result?.ok) throw new Error(result?.error || '插件后台未响应，请重新打开学习台');
    return result.value;
  }
  const response = await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':document.querySelector('meta[name="local-token"]').content},body:JSON.stringify(input)});
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '操作失败'); return result;
}
async function action(fn) {
  try { busy=true; render(); await fn(); }
  catch(error){toast(error.message);}
  finally {busy=false;render();}
}
function coursesInView() { return (data?.courses || []).filter(c=>$('termFilter').value==='all' || c.term===Math.max(...data.courses.map(c=>c.term||0))); }
function activeQueue() { return ['running','paused','waiting_focus','needs_attention','stopping'].includes(data?.queue.status); }
function taskState(task) {
  const item = data.queue.items.find(i=>i.id===task.id);
  if (item && !['skipped','stopped'].includes(item.status)) return item.status === 'playing' && data.queue.status==='paused' ? 'paused' : item.status;
  return task.status;
}
function selectable(task) { return task.type===0 && !task.expired && !['completed','unknown','queued','loading','playing','verifying','waiting_focus','needs_attention'].includes(taskState(task)); }
function visibleTasks() {
  const courses = selectedCourse ? data.courses.filter(c=>c.id===selectedCourse) : coursesInView();
  return courses.flatMap(course=>course.tasks.map(task=>({...task,courseName:course.name,classroomName:course.classroomName}))).filter(task=>{
    const status=taskState(task);
    if (filter==='completed' ? status!=='completed' : status==='completed') return false;
    if (filter==='video' && task.type!==0) return false;
    if (filter==='assignment' && ![5,6].includes(task.type)) return false;
    return !search || `${task.name} ${task.section || ''} ${task.courseName}`.toLowerCase().includes(search);
  }).sort((a,b)=>(a.expired-b.expired)||((a.deadlineTs||Infinity)-(b.deadlineTs||Infinity))||a.courseId-b.courseId||a.leafId-b.leafId);
}
function badge(status,expired) {
  const cls=status==='completed'?'success':['playing','loading','verifying'].includes(status)?'playing':expired||['needs_attention','waiting_focus','failed'].includes(status)?'warning':'neutral';
  return `<span class="badge ${cls}">${escape(expired&&status==='pending'?'已超时':statusLabels[status] || status)}</span>`;
}
function formatDate(task) {
  if (!task.deadlineTs && !task.deadline) return '未设置';
  if(task.deadlineTs){const d=new Date(task.deadlineTs);return new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit'}).format(d)+' '+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);}
  return String(task.deadline).replace(/^\d{4}-/,'');
}
function time(value) { if(!Number.isFinite(value))return '00:00'; const n=Math.max(0,Math.floor(value));return `${Math.floor(n/60).toString().padStart(2,'0')}:${(n%60).toString().padStart(2,'0')}`; }
function render() {
  if(!data)return;
  const connected=data.connection.connected;
  $('connectionChip').classList.toggle('online',connected);
  $('connectionChip').innerHTML=`<i></i>${connected?'浏览器已连接':'浏览器未连接'}`;
  $('connectionMessage').textContent=data.syncing?data.syncMessage:data.connection.message;
  $('connectButton').textContent=connected?'重新连接':'连接浏览器';
  $('connectButton').disabled=busy||activeQueue()||data.syncing;
  $('openBrowser').disabled=busy||activeQueue()||data.syncing;
  $('syncButton').disabled=busy||!connected||data.syncing;
  $('syncButton').textContent=data.syncing?'↻ 正在同步…':'↻ 同步课程';
  $('cacheBanner').hidden=!data.cacheOnly;
  const courses=coursesInView();
  const tasks=courses.flatMap(c=>c.tasks).filter(t=>taskState(t)!=='completed');
  $('statCourses').textContent=courses.length;
  $('statCoursesDetail').textContent=$('termFilter').value==='all'?'全部学期':'当前学期';
  $('statVideos').textContent=tasks.filter(t=>t.type===0).length;
  $('statAssignments').textContent=tasks.filter(t=>[5,6].includes(t.type)).length;
  $('statExpired').textContent=tasks.filter(t=>t.expired).length;
  $('navCount').textContent=tasks.length;
  $('courseList').innerHTML=courses.map(c=>`<button class="course-item ${selectedCourse===c.id?'selected':''}" data-course="${c.id}" title="${escape(c.classroomName)}"><span class="course-dot"></span><span>${escape(c.name)}${c.auditor?' · 旁听':''}${c.name.includes('入学教育')?`<small> · ${c.classroomName.includes('非全')?'非全日制':'全体新生'}</small>`:''}</span><b>${c.tasks.filter(t=>taskState(t)!=='completed').length || '✓'}</b></button>`).join('');
  const course=data.courses.find(c=>c.id===selectedCourse);
  $('courseTitle').textContent=course?course.name:'待办任务';
  $('courseSubtitle').textContent=course?`${course.classroomName} · 学习进度 ${Number(course.progress||0).toFixed(1)}%`: '全部课程 · 按截止时间排序';
  $('refreshCourse').hidden=!course;
  $('refreshCourse').disabled=busy||!connected;
  if(course?.error)$('courseSubtitle').textContent+=` · ${course.error}`;
  const visible=visibleTasks();
  $('taskRows').innerHTML=visible.map(t=>`<tr><td><input type="checkbox" data-task="${t.id}" aria-label="选择 ${escape(t.name)}" ${selected.has(t.id)?'checked':''} ${selectable(t)?'':'disabled'}></td><td><div class="task-title">${escape(t.name==='作业'&&t.section?t.section+' · 作业':t.name)}</div><div class="task-meta"><span class="task-type ${[5,6].includes(t.type)?'assignment':''}">${typeLabels[t.type]||'任务'}</span>${escape(t.courseName)}${t.name==='作业'&&!t.section?' · '+t.leafId:''}</div></td><td class="deadline ${t.expired?'expired':''}">${escape(formatDate(t))}</td><td>${badge(taskState(t),t.expired)}</td><td><button class="open-task" data-open="${t.id}" aria-label="打开 ${escape(t.name)}" title="在雨课堂中打开" ${connected?'':'disabled'}>↗</button></td></tr>`).join('');
  $('emptyState').hidden=visible.length>0;
  $('taskCount').textContent=`${visible.length} 项任务`;
  $('lastSync').textContent=data.lastSync?`最近同步 ${new Date(data.lastSync).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}`:'尚未同步';
  const selectableTasks=visible.filter(selectable);
  $('selectAll').checked=selectableTasks.length>0&&selectableTasks.every(t=>selected.has(t.id));
  $('selectAll').indeterminate=selectableTasks.some(t=>selected.has(t.id))&&!$('selectAll').checked;
  $('selectionCount').textContent=selected.size?`已选择 ${selected.size} 个视频`:'未选择';
  document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('selected',b.dataset.filter===filter));
  const queue=data.queue,active=queue.items.find(i=>i.id===queue.activeId),hasQueue=queue.items.length>0;
  $('queueBadge').textContent=queueLabels[queue.status]||queue.status;
  $('queueBadge').className=`badge ${['needs_attention','waiting_focus'].includes(queue.status)?'warning':queue.status==='running'?'playing':'neutral'}`;
  $('queueIntro').hidden=!!active||hasQueue;
  $('nowPlaying').hidden=!active;
  if(active){
    $('playingTitle').textContent=active.name;
    $('playingCourse').textContent=active.courseName;
    $('playProgress').style.width=`${Math.min(100,active.duration?100*active.position/active.duration:0)}%`;
    $('playTime').textContent=`${time(active.position)} / ${time(active.duration)}`;
    $('actualSpeed').textContent=`${active.speed}×`;
    $('serverCoverage').textContent=active.coverage===null?'等待读取':`${(active.coverage*100).toFixed(1)}%`;
  }
  $('queueMessage').textContent=hasQueue?queue.message:'';
  $('playerPolicy').textContent=queue.mode==='background'?'每个视频在独立后台播放会话中实际播放，切换标签后继续。平台确认完成后才更新状态；登录或验证提示仍需手动处理。':queue.requiresForeground===true?'此课程要求播放窗口保持焦点。切换标签、操作其他窗口或最小化会暂停；返回播放页后从原位置继续。':'前台模式按原播放器要求播放，完成状态以服务器返回为准。';
  $('queueList').innerHTML=queue.items.map((i,index)=>{
    const live=(queue.activeIds||[queue.activeId]).includes(i.id);
    return `<li class="${live?'active':''}"><span class="index">${String(index+1).padStart(2,'0')}</span><div>${escape(i.name)}<small>${escape(i.courseName)}</small>${i.duration?`<small>${time(i.position)} / ${time(i.duration)} · ${i.speed}×</small><small>服务器覆盖率 ${i.coverage===null?'等待读取':(i.coverage*100).toFixed(1)+'%'}</small>`:''}${i.message&&['needs_attention','failed'].includes(i.status)?`<small class="task-error">${escape(i.message)}</small>`:''}${live?`<div class="task-actions"><button class="text-button" data-focus="${i.id}">打开</button>${['needs_attention','waiting_focus'].includes(i.status)?`<button class="text-button" data-resume="${i.id}">继续</button>`:''}<button class="text-button" data-skip="${i.id}">跳过</button></div>`:''}</div>${badge(live&&queue.status==='paused'?'paused':i.status,false)}</li>`;
  }).join('');
  $('startQueue').hidden=activeQueue();
  $('startQueue').disabled=busy||!connected||data.cacheOnly||!selected.size||data.syncing;
  $('startQueue').textContent=selected.size?`▶ 开始播放 ${selected.size} 个视频`:'▶ 开始播放所选视频';
  $('queueControls').hidden=!activeQueue();
  $('pauseQueue').hidden=!['running','waiting_focus'].includes(queue.status);
  $('resumeQueue').hidden=!['paused','needs_attention'].includes(queue.status);
  $('stopQueue').disabled=queue.status==='stopping';
  $('playerLinks').hidden=!active;
  $('focusPlayer').textContent=queue.status==='waiting_focus'?'返回播放页继续 ↗':'打开播放页面 ↗';
  $('skipVideo').disabled=queue.status==='stopping';
  $('playbackMode').disabled=activeQueue();
  $('concurrencySelect').disabled=activeQueue()||$('playbackMode').value==='foreground';
  if(activeQueue()){$('playbackMode').value=queue.mode||'foreground';$('concurrencySelect').value=String(queue.concurrency||1);}
  if(activeQueue()&&!changingSpeed)$('speedSelect').value=String(queue.speed);
}
$('courseList').addEventListener('click',e=>{const b=e.target.closest('[data-course]');if(b){selectedCourse=Number(b.dataset.course);render();}});
$('navCourses').onclick=()=>{selectedCourse=null;render();};
$('termFilter').onchange=()=>{if(selectedCourse&&!coursesInView().some(c=>c.id===selectedCourse))selectedCourse=null;render();};
$('taskFilters').onclick=e=>{const b=e.target.closest('[data-filter]');if(b){filter=b.dataset.filter;render();}};
$('search').oninput=e=>{search=e.target.value.toLowerCase().trim();render();};
$('taskRows').onchange=e=>{const id=e.target.dataset.task;if(id){e.target.checked?selected.add(id):selected.delete(id);render();}};
$('taskRows').onclick=e=>{const b=e.target.closest('[data-open]');if(b)action(()=>api('/api/task/open',{id:b.dataset.open}));};
$('selectAll').onchange=e=>{visibleTasks().filter(selectable).forEach(t=>e.target.checked?selected.add(t.id):selected.delete(t.id));render();};
$('clearSelection').onclick=()=>{selected.clear();render();};
$('openBrowser').onclick=()=>action(async()=>{const result=await api('/api/browser/open');$('endpoint').value=result.endpoint;toast('已打开雨课堂。请手动登录，再点击连接浏览器。');});
$('connectButton').onclick=()=>action(async()=>{await api('/api/connect',{endpoint:$('endpoint').value});await api('/api/sync');toast('课程与待办已同步');});
$('syncButton').onclick=()=>action(()=>api('/api/sync'));
$('refreshCourse').onclick=()=>action(()=>api('/api/course/refresh',{id:selectedCourse}));
$('startQueue').onclick=()=>action(async()=>{const ids=[...selected];await api('/api/queue/start',{ids,speed:Number($('speedSelect').value),mode:$('playbackMode').value,concurrency:Number($('concurrencySelect').value)});selected.clear();});
for(const [id,verb] of [['pauseQueue','pause'],['resumeQueue','resume'],['stopQueue','stop'],['skipVideo','skip']])$(id).onclick=()=>action(()=>api('/api/queue/'+verb));
$('focusPlayer').onclick=()=>action(()=>api('/api/player/focus'));
$('stopService').onclick=()=>action(async()=>{await api('/api/service/stop');if(!extensionMode){events.close();$('connectionChip').innerHTML='<i></i>工具已退出';}toast(extensionMode?'已断开连接，工具创建的视频标签已关闭。':'服务已停止，工具创建的视频已暂停。');});
$('playbackMode').onchange=()=>{if($('playbackMode').value==='foreground')$('concurrencySelect').value='1';render();};
$('queueList').onclick=e=>{const button=e.target.closest('button');if(!button)return;if(button.dataset.focus)action(()=>api('/api/player/focus',{id:button.dataset.focus}));if(button.dataset.skip)action(()=>api('/api/queue/skip',{id:button.dataset.skip}));if(button.dataset.resume)action(()=>api('/api/queue/resume',{id:button.dataset.resume}));};
$('speedSelect').onchange=()=>{if(activeQueue()){changingSpeed=true;action(async()=>{try{await api('/api/queue/speed',{speed:Number($('speedSelect').value)});}finally{changingSpeed=false;}});}};
async function init(){try{data=extensionMode?await api('/api/state'):await(await fetch('/api/state')).json();$('endpoint').value=data.connection.endpoint;if(data.restoredPlan&&!activeQueue()){selected=new Set(data.restoredPlan.ids.filter(id=>data.courses.some(c=>c.tasks.some(t=>t.id===id&&selectable(t)))));$('playbackMode').value=data.restoredPlan.mode||'background';$('concurrencySelect').value=String(data.restoredPlan.concurrency||2);$('speedSelect').value=String(data.restoredPlan.speed||1.5);}render();}catch{toast(extensionMode?'插件后台未连接，请重新打开学习台':'本地服务未连接，请重新启动工具');}}
function extensionEvents() {
  const events = {close(){port?.disconnect();clearTimeout(retry);},onmessage:null,onerror:null};
  let port, retry;
  function connect() {
    try {
      port=chrome.runtime.connect({name:'study-desk-state'});
      port.onMessage.addListener(value=>{if(value.error){toast(value.error);return;}events.onmessage?.({data:JSON.stringify(value)});});
      port.onDisconnect.addListener(()=>{events.onerror?.();retry=setTimeout(connect,1500);});
    } catch { events.onerror?.();retry=setTimeout(connect,3000); }
  }
  connect();
  return events;
}
const events=extensionMode?extensionEvents():new EventSource('/api/events');
events.onmessage=e=>{data=JSON.parse(e.data);selected=new Set([...selected].filter(id=>data.courses.some(c=>c.tasks.some(t=>t.id===id&&selectable(t)))));render();};
events.onerror=()=>{$('connectionChip').innerHTML=`<i></i>${extensionMode?'插件后台重新连接中':'本地服务连接中断'}`;};
init();
