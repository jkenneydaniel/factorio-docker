import {icon} from './icons.js';
import {setupPage,setupReady} from './onboarding.js';
import {mountMap} from './map.js';
import {cleanWorldPreview} from './world-preview.js';
import {worldForm,bindWorldEditor,clearWorldDraft,useCopiedSettings} from './world-editor.js';
let worldOptions=null,worldSearch='',createdWorld=null;
let panelRelease=null,lastReleasePoll=0,updateState=null,updateReviewPending=false;
const $=selector=>document.querySelector(selector);
let cleanMap=()=>{};
let renderedMapCreated=null;
let livePositions=null,liveTimer=null,livePolling=false,renderedMapScope=null;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pretty=value=>String(value||'').replace(/\.zip$/,'').replace(/[_-]/g,' ');
const bytes=value=>value==null?'—':value>=1024**3?(value/1024**3).toFixed(1)+' GB':value>=1024**2?(value/1024**2).toFixed(1)+' MB':Math.round(value/1024)+' KB';
const date=value=>value?new Date(value).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Not yet';
const relative=value=>{if(!value)return'No saved data yet';const minutes=Math.max(0,Math.floor((Date.now()-new Date(value))/60000));return minutes<1?'Just now':minutes<60?`${minutes} min ago`:minutes<1440?`${Math.floor(minutes/60)} hr ago`:date(value);};
let user=null,status=null,currentPage='overview',viewNumber=0,refreshTimer=null,busyJob=null,worldFilter='all';
const admin=()=>user?.role==='admin';
async function api(route,{method='GET',body,raw=false,signal}={}){
  const headers={};if(method!=='GET')headers['x-csrf-token']=user?.csrf||'';
  if(body!==undefined&&!raw)headers['content-type']='application/json';
  const response=await fetch('/api'+route,{method,credentials:'same-origin',headers,signal,body:body===undefined?undefined:raw?body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok){if(response.status===401&&!['/login','/register','/registration'].includes(route))showLogin();throw new Error(result.error||'The request could not be completed.');}return result;
}
let toastTimer;
function toast(message,error=false){const element=$('#toast');element.textContent=message;element.className='toast'+(error?' error':'');element.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{element.hidden=true;},error?10000:6500);}
async function confirmAction(title,message,label='Continue'){const dialog=$('#confirm-dialog');$('#confirm-title').textContent=title;$('#confirm-message').textContent=message;$('#confirm-yes').textContent=label;dialog.returnValue='';dialog.showModal();return await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));}
function showLogin(){cleanWorldPreview();clearWorldDraft();worldOptions=null;createdWorld=null;worldSearch='';worldFilter='all';panelRelease=null;lastReleasePoll=0;updateState=null;$('#release-notice').hidden=true;user=null;livePositions=null;cleanMap();clearInterval(refreshTimer);clearInterval(liveTimer);$('#app-view').hidden=true;$('#login-view').hidden=false;$('#login-form').hidden=false;$('#register-form').hidden=true;}
function invitationToken(value){return String(value).trim().split('#register=').pop();}
async function showRegistration(token=''){
  showLogin();$('#login-form').hidden=true;$('#register-form').hidden=false;$('#register-form').reset();
  $('#register-error').textContent='';$('#owner-steps').hidden=true;$('#invite-label').hidden=!!token;$('#register-form').elements.invitation.value=token;
  $('#register-description').textContent='Use an invitation from your administrator to create an account.';
  if(token){try{const invitation=await api('/registration',{method:'POST',body:{token}});$('#register-description').textContent=invitation.owner?'Host setup is complete. Create your administrator account, then check your server and learn how to join.':`You’re invited with ${invitation.role==='admin'?'administrator':'read-only'} access. Choose your own login below.`;$('#owner-steps').hidden=!invitation.owner;}
    catch(error){$('#register-error').textContent=error.message;$('#invite-label').hidden=false;}}
}
$('.skip-link').addEventListener('click',event=>{event.preventDefault();(user?$('#content'):$('#login-view input:not([type=hidden])'))?.focus();});
$('#open-registration').addEventListener('click',()=>showRegistration());
$('#back-to-login').addEventListener('click',showLogin);
$('#register-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('button[type="submit"]'),data=new FormData(form);$('#register-error').textContent='';
  if(data.get('password')!==data.get('confirmation')){$('#register-error').textContent='The passwords do not match.';return;}
  button.disabled=true;
  try{user=await api('/register',{method:'POST',body:{token:invitationToken(data.get('invitation')),username:data.get('username'),password:data.get('password')}});form.reset();history.replaceState(null,'',user.onboarding?.completed===false?'/#setup':'/#overview');await showApp();toast('Your account is ready. Welcome to the factory.');}
  catch(error){$('#register-error').textContent=error.message;}finally{button.disabled=false;}
});
async function showApp(){
  $('#login-view').hidden=true;$('#app-view').hidden=false;$('#user-label').textContent=user.username+' · '+(admin()?'Administrator':'Read-only');
  $('#accounts-nav').hidden=false;$('#setup-nav').hidden=!admin();
  if(admin()&&user.onboarding?.completed===false&&!location.hash)history.replaceState(null,'','/#setup');
  await navigate();clearInterval(refreshTimer);refreshTimer=setInterval(refresh,5000);
  clearInterval(liveTimer);liveTimer=setInterval(refreshLivePlayers,2000);
}
$('#login-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;$('#login-error').textContent='';
  try{user=await api('/login',{method:'POST',body:Object.fromEntries(new FormData(event.target))});event.target.reset();await showApp();}
  catch(error){$('#login-error').textContent=error.message;}finally{button.disabled=false;}
});
for(const id of ['logout','mobile-logout'])$('#'+id).addEventListener('click',async()=>{try{await api('/logout',{method:'POST',body:{}});showLogin();}catch(error){toast(error.message,true);}});
addEventListener('hashchange',()=>{if(location.hash.startsWith('#register=')){const token=location.hash.slice(10);history.replaceState(null,'','/');showRegistration(token);}else if(user)navigate();});
async function navigate(){
  window.scrollTo(0,0);
  const page=location.hash.slice(1).split('/')[0];
  currentPage=['overview','worlds','map','backups','players','logs','settings','accounts','setup'].includes(page)?page:'overview';
  if(currentPage==='setup'&&!admin())currentPage='overview';
  $('#app-view').classList.toggle('setup-mode',currentPage==='setup');
  document.querySelectorAll('[data-page]').forEach(link=>{const active=link.dataset.page===currentPage;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  $('#breadcrumb-page').textContent={overview:'Overview',worlds:'Worlds',map:'Map',backups:'Backups',players:'Players',logs:'Activity',settings:'Settings',accounts:'Accounts',setup:'Setup'}[currentPage];
  await render();
}
function heading(eyebrow,title,description,actions=''){return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div><div class="button-group">${actions}</div></div>`;}
function readonly(){return admin()?'':'<div class="readonly-note">You’re signed in with read-only access. An administrator can change settings and manage worlds.</div>';}
function jobBanner(){const job=busyJob||status?.activeJob;return job&&['running','queued'].includes(job.state)?`<div class="job-banner"><span class="spinner"></span><span>${esc(job.message||'Working…')}</span></div>`:'';}
function card(title,body,link=''){return `<section class="card"><div class="card-header"><h2>${title}</h2>${link}</div><div class="card-body">${body}</div></section>`;}
function empty(title,description=''){return `<div class="empty-state"><div class="empty-symbol">${icon('folder')}</div>${esc(title)}${description?`<p>${esc(description)}</p>`:''}</div>`;}
function actionButton(label,action,extra='',primary=false){const glyph={save:'device-floppy',restart:'refresh',start:'player-play',stop:'player-stop',backup:'database','refresh-map':'refresh'}[action]||'adjustments';return `<button class="button${primary?' primary':''}" data-action="${action}" ${extra} ${!admin()||busyJob||updateState?.busy?'disabled':''}>${icon(glyph)}${label.replace(/^[^A-Za-z]+/,'')}</button>`;}
function updateChrome(){if(!status)return;const label=$('#header-status');label.innerHTML=`<span class="dot ${status.ready?'':'offline'}"></span>${status.ready?(status.paused?'Paused':'Running'):status.running?'Starting':'Stopped'}<span class="header-players"> · ${status.players.length} online</span>`;$('#header-version').textContent='Factorio '+(status.version.match(/\d+\.\d+\.\d+/)?.[0]||status.version);$('#footer-version').textContent=panelRelease?'v'+panelRelease.current:'Local server management';}
function activityRows(jobs,limit=5){return jobs.length?jobs.slice(0,limit).map(job=>`<div class="activity-row ${job.state==='failed'?'failed':''}"><div class="activity-icon">${icon(job.state==='succeeded'?'circle-check':job.state==='failed'?'alert-circle':'clock')}</div><div><strong>${esc(({save:'Save completed',backup:'Backup complete',settings:'Settings updated',start:'Server started',stop:'Server stopped',create:'World created',restore:'Backup restored'})[job.action]||pretty(job.action))} <span class="mini-pill">${esc(job.state)}</span></strong><p>${esc(job.message)}</p></div><time>${esc(relative(job.finished||job.started))}</time></div>`).join(''):empty('Nothing to report.','Server actions and completed backups will appear here.');}
function overview(jobs=[],health=null){
  const s=status,stateLabel=!s.running?'Stopped':!s.ready?'Starting':s.paused?'Paused · waiting for players':'Running',version=s.version.match(/\d+\.\d+\.\d+/)?.[0]||s.version;
  const controls=admin()?`<details class="server-menu"><summary class="button">Server actions ${icon('dots')}</summary><div class="server-menu-items">${actionButton('Start server','start',s.running?'disabled':'')}${actionButton('Restart','restart',!s.running?'disabled':'')}${actionButton('Stop & save','stop',!s.running?'disabled':'')}</div></details>`:'';
  return heading('SERVER OVERVIEW','Your factory, under control.','Everything you need for a good session.',admin()?actionButton('Save now','save',!s.ready?'disabled':'',true)+controls:'')+readonly()+jobBanner()+(admin()&&user.onboarding?.completed===false?'<div class="setup-resume"><span>Your account is ready. Finish the setup guide to check readiness and connection details.</span><a class="button" href="#setup">Continue setup</a></div>':'')+`
  <section class="card active-world"><div class="world-symbol">${icon('file-description')}</div><div><h2>${esc(pretty(s.currentWorld)||'No world loaded')}</h2><p><span class="dot ${s.ready?'':'offline'}"></span> ${stateLabel} · Factorio ${esc(version)}</p></div><div class="world-last-save">Last save<strong>${esc(relative(s.lastSaveAt))}</strong></div><a class="button" href="#worlds">Open world ${icon('arrow-right')}</a></section><div class="overview-grid"><div class="overview-main">${card('Recent activity',activityRows(jobs),'<a href="#logs">View all activity '+icon('arrow-right')+'</a>')}${card('Quick actions',`<p class="form-note">Common tasks to keep your server running smoothly.</p><div class="quick-actions">${(admin()?[['file-plus','Create a world','Start a new factory','#worlds/create'],['upload','Import a save','Add an existing world','#worlds/import']]:[['world','Browse worlds','Your saved factories','#worlds']]).concat([['database','Manage backups','View saved progress','#backups'],['map','Open map','Explore your world','#map']]).map(([glyph,title,detail,href])=>`<a class="quick-action" href="${href}">${icon(glyph)}<strong>${title}</strong><span>${detail}</span></a>`).join('')}</div>`)}</div><div class="overview-side">${card('Join the factory',`<p class="form-note">Share this address with your friends to join.</p><div class="connection-line"><code>${esc(s.connection)}</code><button class="copy-button" data-copy="${esc(s.connection)}">${icon('copy')} Copy address</button></div><p class="hint">Your game must match Factorio ${esc(version)}.</p>`)}${card('Engineers online',s.players.length?s.players.map(name=>`<div class="crew-row"><span class="player-avatar">${esc(name.slice(0,1).toUpperCase())}</span><strong>${esc(name)}</strong><span>In game</span></div>`).join(''):empty('A quiet moment.','Engineers appear here when they join.'),'<a href="#players">'+s.players.length+' online</a>')}${card(health?.verifiedCount?'Progress protected':'Protect your progress',`<p class="form-note">Keep a backup on another device.</p><div class="detail-row"><span>Last backup</span><strong>${health?.latestAt?esc(relative(health.latestAt)):'No backup yet'}</strong></div><div class="detail-row"><span>Archives checked</span><strong>${health?health.verifiedCount+' verified':'Unavailable'}</strong></div>${health?.alerts?.length?'<p class="hint">'+esc(health.alerts[0])+'</p>':''}<div class="button-group section-spacer">${admin()?actionButton('Create backup','backup'):'<a class="button" href="#backups">View backups</a>'}</div>`)}</div></div><div class="overview-telemetry"><span>CPU ${s.cpu==null?'unavailable':s.cpu.toFixed(1)+'%'}</span><span>Memory ${bytes(s.memory)}</span><span>Autosave every ${s.autosaveMinutes||5} min</span><span>${s.saveVerified?'Save completion confirmed':'Save not yet confirmed'}</span></div>`;
}
function worldRows(worlds){const filtered=worlds.filter(world=>(!worldSearch||world.name.toLowerCase().includes(worldSearch.toLowerCase()))&&(worldFilter==='all'||worldFilter==='autosaves'&&world.kind==='autosave'||worldFilter==='library'&&world.kind==='archive'||worldFilter==='active'&&world.current));return filtered.length?`<div class="table-wrap"><table><thead><tr><th>World</th><th>Updated</th><th>Size</th><th>Actions</th></tr></thead><tbody>${filtered.map(world=>`<tr><td><div class="world-name-cell">${world.hasPreview?`<img class="world-thumbnail" src="/api/preview?id=${encodeURIComponent(world.id)}" alt="Terrain preview for ${esc(world.name)}" loading="lazy">`:icon('world')}<div><span class="name">${esc(pretty(world.name))}</span><span class="secondary">${world.current?'Active world':world.kind==='autosave'?'Rolling autosave':world.kind==='archive'?'World library':'Saved world'}</span></div></div></td><td>${date(world.modified)}</td><td>${bytes(world.size)}</td><td><div class="row-actions">${admin()?`<a class="button small" href="/api/download?kind=world&amp;id=${encodeURIComponent(world.id)}">Download</a>`:''}${world.hasPreview?`<button class="button small" data-preview="${esc(world.id)}">Preview</button>`:''}${!world.current&&admin()?`<button class="button small" data-load-world="${esc(world.id)}" data-name="${esc(world.name)}" ${busyJob?'disabled':''}>Switch to world</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`:empty('No worlds in this view.','Try another filter or create your next world.');}
let visibleWorlds=[];
function worldPage(worlds){
  visibleWorlds=worlds;
  if(admin()&&location.hash==='#worlds/create')return jobBanner()+worldForm(worldOptions,!!busyJob);
  if(createdWorld&&location.hash==='#worlds/created'){const world=worlds.find(w=>w.name===createdWorld.name+'.zip'||w.name===createdWorld.name);return `<section class="card creation-complete">${icon('circle-check')}<h1>${esc(createdWorld.name)} is ready.</h1><p class="section-spacer">${esc(createdWorld.message)}</p>${world?.hasPreview?`<img class="completed-preview" src="/api/preview?id=${encodeURIComponent(world.id)}" alt="Generated preview of ${esc(world.name)}">`:''}<div class="button-group"><a class="button primary" href="#worlds">Open world library ${icon('arrow-right')}</a><a class="button" href="#worlds/create">Create another</a></div></section>`;}
  return heading('WORLD LIBRARY','Your worlds. Your next adventure.','Start fresh, import a favourite save, or return to a familiar factory.',admin()?'<a class="button primary" href="#worlds/create">'+icon('plus')+' Create a world</a><a class="button" href="#worlds/import">'+icon('upload')+' Import save</a>':'')+readonly()+jobBanner()+`<section class="card world-current"><div class="card-body"><div class="eyebrow">ACTIVE WORLD</div><h2>${esc(pretty(status.currentWorld)||'No world loaded')}</h2><p class="hint">Opening a world or its preview leaves the server unchanged. Switching saves and backs up first; connected players will need to rejoin.</p></div></section>${admin()?`<div class="world-forms"><details class="card" ${location.hash==='#worlds/import'?'open':''}><summary>Import an existing save</summary><div class="card-body"><form id="upload-form"><p class="form-note">Add a Factorio save ZIP to the library. Importing does not replace the running world.</p><label>World ZIP<input class="file-input" name="world" type="file" accept=".zip" required></label><p class="form-note">Maximum 128 MB. Match the installed game version and enabled mods.</p><button class="button" ${busyJob?'disabled':''}>Import to library</button></form></div></details></div>`:''}<div class="tag-tabs" aria-label="Filter worlds">${[['all','All worlds'],['active','Active world'],['library','Library'],['autosaves','Autosaves']].map(([value,label])=>`<button class="${worldFilter===value?'active':''}" aria-pressed="${worldFilter===value}" data-world-filter="${value}">${label}</button>`).join('')}</div><label class="world-search">Find a world<input type="search" id="world-search" value="${esc(worldSearch)}" placeholder="Search by name"></label><section class="card"><div class="card-header"><h2>World library</h2><span class="hint">${worlds.length} ${worlds.length===1?'save':'saves'}</span></div><div id="world-results">${worldRows(worlds)}</div></section>`;
}
function backupPage(items,schedule,health){return heading('PROGRESS, PROTECTED','A little peace of mind.','Complete snapshots of your saves, server settings, and mods.',actionButton('▣ Create backup','backup','',true))+readonly()+jobBanner()+backupHealthView(health)+`
  <section class="card">${items.length?`<div class="table-wrap"><table><thead><tr><th>Backup</th><th>Created</th><th>Size</th><th></th></tr></thead><tbody>${items.map(item=>`<tr><td><span class="name">${esc(item.relative.replace(/\.zip$/,''))}</span><span class="secondary">${item.validation?item.validation.ok?'✓ Archive integrity verified '+date(item.validation.checked):'⚠ '+esc(item.validation.error):'Not verified yet'}</span></td><td>${date(item.modified)}</td><td>${bytes(item.size)}</td><td><div class="row-actions">${admin()?`<button class="button small" data-verify-backup="${esc(item.relative)}" ${busyJob?'disabled':''}>Verify</button><a class="button small" href="/api/download?kind=backup&amp;name=${encodeURIComponent(item.relative)}">Download</a><button class="button small" data-restore="${esc(item.relative)}" ${busyJob?'disabled':''}>Restore</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`:empty('Your first backup is a click away.','World changes and restores also create a backup automatically.')}</section>
  ${admin()?`<div class="section-spacer">${card('Automatic backups',`<form id="schedule-form"><label class="check-label"><input type="checkbox" name="enabled" ${schedule.enabled?'checked':''}>Create backups on a schedule</label><div class="form-grid"><label>Every (hours)<input name="hours" type="number" min="1" max="168" value="${schedule.hours}" required></label><label>Scheduled backups to keep<input name="keep" type="number" min="2" max="100" value="${schedule.keep}" required></label></div><p class="form-note">The PC and Docker must be running. Manual backups and backups taken before world changes are kept separately from scheduled retention.</p><button class="button primary">Save schedule</button></form>`)}</div>`:''}`;}
function playersPage(){return heading('YOUR CREW','Better with company.','See who’s connected and manage the engineers in your world.')+readonly()+jobBanner()+`
  <section class="card"><div class="card-header"><h2>Online players</h2><span class="mini-pill">${status.players.length} connected</span></div>${status.players.length?`<div class="table-wrap"><table><tbody>${status.players.map(name=>`<tr><td><span class="player-avatar">${esc(name.slice(0,2).toUpperCase())}</span><strong>${esc(name)}</strong></td><td><span class="online-label"><span class="dot"></span>Online</span></td><td class="row-actions">${admin()?`<button class="button small" data-player-name="${esc(name)}" data-player-op="kick">Kick</button><button class="button small danger" data-player-name="${esc(name)}" data-player-op="ban">Ban</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('No engineers online.','The factory pauses automatically when everyone leaves, if pause when empty is enabled.')}</section>
  ${admin()?`<div class="split-layout section-spacer">${card('Player access',`<form id="player-form"><label>LAN player name<input name="name" maxlength="64" required placeholder="Player name"></label><label>Action<select name="operation"><option value="promote">Make administrator</option><option value="demote">Remove administrator</option><option value="whitelist">Add to whitelist</option><option value="unwhitelist">Remove from whitelist</option><option value="unban">Remove ban</option><option value="ban">Ban player</option></select></label><p class="form-note">Adding names to an empty whitelist restricts joining to those names. LAN player names are self-selected while identity verification is disabled.</p><button class="button">Apply player action</button></form>`)}${card('Send an announcement',`<form id="announce-form"><label>Message<textarea name="message" maxlength="250" required placeholder="A message for everyone in the factory…"></textarea></label><button class="button primary">Send announcement</button></form>`)}</div>`:''}`;}
function logsPage(jobs,logs){return heading('UNDER THE HOOD','Know what’s happening.','Completed actions, server events, and the latest log output.')+jobBanner()+`
  <div class="split-layout">${card('Server log',`<pre class="logs">${esc(logs||'The server has not written a log yet.')}</pre>`)}${card('Panel activity',activityRows(jobs,20))}</div>
  ${admin()?`<div class="section-spacer">${card('Administrative console',`<form id="console-form"><p class="form-note">These commands inspect the server without running Lua scripts or disabling achievements.</p><div class="inline-choice"><select name="command" aria-label="Administrative command">${['/players','/time','/seed','/version','/evolution','/admins','/bans','/whitelist get','/help'].map(command=>`<option>${esc(command)}</option>`).join('')}</select><button class="button">Run command</button></div><pre id="console-output" class="logs console-output">Choose a command to inspect the server.</pre></form>`)}</div>`:''}`;}
function settingsTabs(){return `<nav class="settings-tabs" aria-label="Settings sections"><a href="#settings" class="${location.hash==='#settings/updates'?'':'active'}">General & connection</a>${admin()?`<a href="#settings/updates" class="${location.hash==='#settings/updates'?'active':''}">Updates</a><a href="#setup">Setup guide</a>`:''}</nav>`;}
function releaseView(){
  if(!admin())return '';
  if(!panelRelease)return '<section id="panel-updates" class="card"><div class="card-body"><p>Release information is unavailable. Check your connection and try again.</p></div></section>';
  const r=panelRelease,labels={available:'An update is available',current:'Panel is up to date','no-releases':'No releases in this channel',disabled:'Release checks are disabled',unavailable:'Release check unavailable',unchecked:'Release check pending'},disabled=updateState?.busy||updateReviewPending||!updateState?'disabled':'';
  const releaseLink=r.latest?.url&&/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/tag\//.test(r.latest.url)?`<a class="button ghost" href="${esc(r.latest.url)}" target="_blank" rel="noopener noreferrer">Release notes ${icon('external-link')}</a>`:'';
  const history=(updateState?.jobs||[]).slice(0,8).map(j=>`<div class="activity-row"><div class="activity-icon">${icon(j.state==='succeeded'?'circle-check':j.state==='failed'?'alert-circle':'refresh')}</div><div><strong>${j.kind==='game'?'Factorio':'Panel'} ${esc(j.target)} · ${esc(j.state)}</strong><p role="status">${esc(j.message)}</p>${j.backup?`<p class="hint">Pre-update backup: ${esc(j.backup)}</p>`:''}${j.recovery?`<p class="hint">${esc(j.recovery.action)} Recovery copy: ${esc(j.recovery.directory)}</p>`:''}</div><time>${date(j.finished||j.started)}</time></div>`).join('');
  return `<section id="panel-updates"><div class="update-layout"><div class="card"><div class="card-body"><div class="update-section"><div class="update-title">${icon('building-factory-2')}<div><h2>Factory Control</h2><p class="hint">Web panel + controller</p></div></div><div class="version-path"><span>${esc(r.current)}</span>${r.available?icon('arrow-right')+'<strong>'+esc(r.latest?.tag)+'</strong><span class="mini-pill pending">Available</span>':''}</div><p class="form-note">${esc(labels[r.state]||'Release status unavailable')}. The panel reconnects during installation. Your game keeps running.</p>${r.error?`<p class="warning">${esc(r.error)}</p>`:''}<div class="button-group">${r.available?`<button class="button primary" id="review-panel-update" ${disabled}>Review panel update</button>`:''}${releaseLink}</div></div><div class="update-section"><div class="update-title">${icon('server')}<h2>Factorio server</h2></div><p class="form-note">Installed ${esc(status.version.match(/\d+\.\d+\.\d+/)?.[0]||status.version)}. Match all clients and check mod compatibility. Players disconnect during the upgrade.</p><form id="game-update-form"><div class="inline-choice"><label>Target version<input name="version" placeholder="2.0.x" pattern="2\\.0\\.[0-9]+" required ${disabled}></label><button class="button" ${disabled}>Review game upgrade</button></div></form><p class="hint">Choose an exact newer 2.0.x version. Mods, Docker and your host OS are not upgraded.</p></div><div class="update-section"><h3>Before installation</h3><div class="update-policy">${[['device-floppy','Save and verify a backup'],['database','Keep recovery copies'],['shield-check','Check readiness after replacement']].map(([glyph,text])=>`<div class="policy-row">${icon(glyph)} ${text}</div>`).join('')}</div><p class="hint">These steps run after confirmation. A failed game upgrade requires an explicit backup restore.</p></div></div></div><aside class="card"><div class="card-body"><h2>Update preferences</h2><div class="detail-row"><span>Release channel</span><strong>${r.channel==='preview'?'Preview':'Stable'}</strong></div><p class="hint">${r.channel==='preview'?'Includes alpha and beta releases.':'Stable releases only.'}</p><div class="detail-row"><span>Last checked</span><strong>${date(r.checkedAt)}</strong></div><div class="detail-row"><span>Automatic checks</span><strong>${r.state==='disabled'?'Off':'Every 6 hours'}</strong></div><div class="detail-row"><span>Automatic install</span><strong>Off</strong></div><p class="hint">An administrator chooses when to install. Release-channel preferences come from your host configuration.</p><p class="hint">${updateState?'Progress survives panel replacement. Sign in again to see the result.':'Update service is unavailable. Complete the updated host setup first.'}</p></div></aside></div><section class="card update-history"><div class="card-header"><h2>Installation history</h2></div><div id="update-history" class="card-body">${history||'<p>No installations yet.</p><p class="hint">Progress and recovery details will appear here.</p>'}</div></section></section>`;
}
async function refreshUpdates(){
  if(!admin())return;const signedUser=user;
  try{const result=await api('/update-status');if(user!==signedUser)return;const changed=JSON.stringify(result)!==JSON.stringify(updateState);updateState=result;
    if(changed&&currentPage==='settings'&&!updateReviewPending&&!$('#game-update-form')?.contains(document.activeElement)&&!document.querySelector('dialog[open]')){
      const section=$('#panel-updates');if(section){section.outerHTML=releaseView();bindUpdates();}
    }
  }catch{}
}
function bindUpdates(){
  async function review(kind,target){
    if(updateReviewPending)return;updateReviewPending=true;
    try{const plan=await api('/update-plan',{method:'POST',body:{kind,target}});
      const message=`${plan.current} → ${plan.target}. ${plan.impact} ${plan.backup} ${plan.notes}`;
      if(await confirmAction('Install '+(kind==='game'?'Factorio ':'Factory Control ')+plan.target+'?',message,'Install update')){
        await api('/update-install',{method:'POST',body:{planId:plan.id,confirm:true}});toast('Update started. The panel may reconnect; sign in again when it returns.');
      }
    }catch(error){toast(error.message,true);}finally{updateReviewPending=false;await refreshUpdates();}
  }
  $('#review-panel-update')?.addEventListener('click',()=>review('panel',panelRelease.latest.tag.replace(/^v/,'')));
  $('#game-update-form')?.addEventListener('submit',event=>{event.preventDefault();review('game',new FormData(event.target).get('version'));});
}
async function refreshReleases(){
  if(!admin()||Date.now()-lastReleasePoll<60000)return;
  lastReleasePoll=Date.now();const signedUser=user;
  try{const result=await api('/updates');if(user!==signedUser)return;panelRelease=result;$('#release-notice').hidden=!result.available;$('#release-notice').textContent=result.latest?'Panel '+result.latest.tag+' available':'Panel update available';}catch{}
}
function settingsPage(settings){return heading('MAKE IT YOURS','The way you like to play.','Server preferences, access and connection details.')+settingsTabs()+readonly()+jobBanner()+`
  <div class="split-layout">${card('Server settings',`<form id="settings-form"><label>Server name<input name="name" value="${esc(settings.name)}" maxlength="100" required ${admin()?'':'disabled'}></label><label>Description<textarea name="description" maxlength="500" ${admin()?'':'disabled'}>${esc(settings.description)}</textarea></label><div class="form-grid"><label>Player limit (0 = unlimited)<input name="max_players" type="number" min="0" max="1000" value="${settings.max_players}" ${admin()?'':'disabled'} required></label><label>Autosave interval (minutes)<input name="autosave_interval" type="number" min="1" max="60" value="${settings.autosave_interval}" ${admin()?'':'disabled'} required></label><label>Rolling autosave slots<input name="autosave_slots" type="number" min="1" max="100" value="${settings.autosave_slots}" ${admin()?'':'disabled'} required></label><label>New game password<input name="game_password" type="password" autocomplete="new-password" placeholder="${settings.passwordSet?'Leave blank to keep current password':'Optional'}" ${admin()?'':'disabled'}></label></div><label class="check-label"><input type="checkbox" name="auto_pause" ${settings.auto_pause?'checked':''} ${admin()?'':'disabled'}>Pause the world when nobody is connected</label><label class="check-label"><input type="checkbox" name="require_user_verification" ${settings.require_user_verification?'checked':''} ${admin()?'':'disabled'}>Require Factorio account identity verification</label>${settings.passwordSet?'<label class="check-label"><input type="checkbox" name="clear_password">Remove the current game password</label>':''}<p class="form-note">Keep account verification off for Switch LAN usernames. Changes create a backup and restart the server when it is running.</p>${admin()?'<button class="button primary">Save & restart</button>':''}</form>`)}
  ${card('PC + Switch compatibility',`<div class="detail-row"><span>Server version</span><strong>${esc(status.version.replace(/^Version:\s*/,''))}</strong></div><div class="detail-row"><span>Update policy</span><strong class="mini-pill">Version pinned</strong></div><div class="detail-row"><span>Public server listing</span><strong>Disabled</strong></div><div class="detail-row"><span>LAN address</span><strong>${esc(status.connection)}</strong></div><p class="hint">PC and Switch must run the same Factorio version. Switch cannot load optional mods. This panel keeps the server’s existing image and mod configuration.</p><p class="hint">Configure Docker to start with your host or at sign-in. The panel and Factorio containers then follow their restart policies.</p><p class="hint">Panel accounts are separate from Factorio player names. Administrators can invite people to register from the Accounts page.</p>`)}</div>`;}
function accountsPage(data,sessions){return heading('YOUR CREW','Your account & access.','Manage your password and signed-in devices.')+`
  <div class="split-layout">${card('Change your password',`<form id="password-form"><label>Current password<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="256"></label><label>New password<input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label><label>Confirm new password<input name="confirmation" type="password" autocomplete="new-password" required minlength="12" maxlength="128"></label><p class="form-note">Use at least 12 characters. Other sessions are signed out when your password changes.</p><button class="button primary">Change password</button></form>`)}
  ${card('Signed-in sessions',sessions.map(item=>`<div class="detail-row"><span>${item.current?'This session':'Another session'}<br>Signed in ${date(item.created)} · expires ${date(item.expires)}</span>${item.current?'<strong class="mini-pill">Current</strong>':`<button class="button small" data-session="${esc(item.id)}">Sign out</button>`}</div>`).join('')+'<button id="revoke-other-sessions" class="button section-spacer">Sign out other sessions</button>')}</div>`+(admin()?`
  <div class="split-layout section-spacer">${card('Create an invitation',`<form id="invite-form"><label>Account access<select name="role"><option value="viewer">Read-only — view server status and worlds</option><option value="admin">Administrator — manage the server and accounts</option></select></label><button class="button primary" type="submit">Create registration link</button></form><div id="invite-result" hidden><label class="section-spacer">Registration link<input id="invite-link" readonly aria-label="Registration link"></label><p class="hint">Select and copy this link to share it privately. Invitations work once and expire after 24 hours.</p></div>`)}
  ${card('Panel accounts',data.users.map(item=>`<div class="detail-row"><span>${esc(item.username)}${item.username===user.username?' (you)':''}<br>${item.role==='admin'?'Administrator':'Read-only'}</span><div class="button-group"><button class="button small" data-account-role="${esc(item.username)}" data-role="${item.role==='admin'?'viewer':'admin'}">${item.role==='admin'?'Make read-only':'Make admin'}</button><button class="button small danger" data-account-delete="${esc(item.username)}">Remove</button></div></div>`).join('')+'<p class="hint">At least one administrator must remain. Role changes sign out the affected account.</p>')}</div>
  <div class="section-spacer">${card('Unused invitations',data.invitations.length?data.invitations.map(item=>`<div class="detail-row"><span>${item.role==='admin'?'Administrator':'Read-only'} · expires ${date(item.expires)}<br>Created by ${esc(item.createdBy)}</span><button class="button small danger" data-revoke="${esc(item.id)}">Revoke</button></div>`).join(''):empty('No unused invitations.'))}</div>`:'');}
function backupHealthView(health){if(!health)return '';return `${health.alerts.map(message=>`<div class="warning">${esc(message)}</div>`).join('')}<div class="stats-grid"><div class="stat-card"><div class="stat-label">Latest backup</div><div class="stat-value">${relative(health.latestAt)}</div><div class="stat-foot">${health.count} backups retained</div></div><div class="stat-card"><div class="stat-label">Archive integrity</div><div class="stat-value">${health.verifiedCount}<small>verified</small></div><div class="stat-foot">Last checked ${relative(health.lastVerifiedAt)}</div></div><div class="stat-card"><div class="stat-label">Backup storage</div><div class="stat-value">${bytes(health.totalBytes)}</div><div class="stat-foot">${bytes(health.storage?.freeBytes)} available on storage volume</div></div><div class="stat-card"><div class="stat-label">Next scheduled backup</div><div class="stat-value compact-value">${health.nextScheduledAt?date(health.nextScheduledAt):'Not scheduled'}</div><div class="stat-foot">${health.lastAttempt?'Last attempt '+esc(health.lastAttempt.state):'No backup attempts recorded'}</div></div></div><p class="form-note">Verification checks CRC integrity, embedded world archives, and required settings. A successful test restore in Factorio is a separate check.</p>`;}
function mapPage(payload){
  const map=payload.snapshot;
  return heading('YOUR SHARED WORLD','A view of the factory.','Explore your saved world without joining the game.',actionButton('↻ Refresh map','refresh-map','',true))+readonly()+`<p id="map-refresh-state" class="form-note" role="status">${esc(mapRefreshLabel(payload.automatic))}</p>`+jobBanner()+(map?`
    ${payload.staleWorld?'<div class="warning">This snapshot belongs to a different world. Refresh to draw the current world.</div>':''}
    ${map.limited||map.entitiesLimited?'<div class="warning">This large map is limited to 2,048 explored chunks nearest spawn and 80,000 objects.</div>':''}
    <div class="map-summary"><span>${icon('world')} ${esc(map.world.replace(/\.zip$/,''))}</span><span>Snapshot ${date(map.created)}</span><span>${map.chunks.length.toLocaleString()} explored chunks · ${map.entities.length.toLocaleString()} objects</span><span>Seed ${map.seed}</span></div>
    <section class="map-shell"><div class="map-tools"><div class="button-group"><button id="map-plus" class="button small" aria-label="Zoom in">${icon('plus')}</button><button id="map-minus" class="button small" aria-label="Zoom out">${icon('minus')}</button><button id="map-fit" class="button small">Fit map</button><button id="map-base" class="button small">Base / spawn</button></div><span id="map-coordinates">X 0 · Y 0</span></div><canvas id="world-map" tabindex="0" aria-label="Explored factory map. Drag to pan, scroll or pinch to zoom. Arrow keys pan, plus and minus zoom, zero fits the map."></canvas>
    <div class="map-layers">${[['resources','Resources'],['buildings','Buildings'],['railways','Railways'],['power','Power'],['enemies','Enemy bases'],['pollution','Pollution'],['players','Players'],['pins','Pins']].map(([id,label])=>`<label class="check-label"><input type="checkbox" data-map-layer="${id}" ${['power','pollution'].includes(id)?'':'checked'}>${label}</label>`).join('')}</div></section>
    <p class="hint">Drag to pan · Scroll or pinch to zoom · Tap objects or players for details. Terrain and buildings reflect the saved snapshot; live players may move beyond its edges. Terrain uses one sample per 2 × 2 tiles. Explored chunks may include areas currently under fog of war.</p>
    <div class="section-spacer">${card('Player positions',`<p id="live-player-state" class="form-note" role="status">Checking player tracking…</p><div id="live-player-list"></div>${admin()?'<button id="toggle-live-players" class="button" disabled>Checking tracking…</button>':''}`)}</div>
    <div class="split-layout section-spacer">${card('Inspect the map','<h3 id="map-selection-title">Choose a building or resource.</h3><p id="map-selection-detail" class="hint">Tap the map to inspect an object or select coordinates for a shared pin.</p>')}${card('Shared pins',`<div>${payload.pins.map(pin=>`<div class="detail-row"><button class="text-button" data-map-pin="${esc(pin.id)}">${esc(pin.label)} · ${pin.x}, ${pin.y}</button>${admin()?`<button class="button small danger" data-remove-pin="${esc(pin.id)}">Remove</button>`:''}</div>`).join('')||'<p class="hint">No shared pins yet.</p>'}</div>${admin()?'<form id="pin-form" class="section-spacer"><label>Pin label<input name="label" maxlength="80" required placeholder="Next iron mine"></label><div class="form-grid"><label>X<input name="x" type="number" required step="1" value="0"></label><label>Y<input name="y" type="number" required step="1" value="0"></label></div><button class="button">Add shared pin</button></form>':''}`)}</div>`:card('Your first map',empty('Ready to explore?','Refresh the map to draw the explored area from an isolated copy of your latest save.')));
}
function mapRefreshLabel(automatic,active){
  if(active)return 'Updating after a save · '+active.message;
  if(automatic?.running)return 'Updating the map from the latest completed save…';
  if(automatic?.lastError)return 'Automatic refresh will retry: '+automatic.lastError;
  if(automatic?.pending)return 'A save completed. Map refresh is queued.';
  return automatic?.enabled?'Refreshes automatically after completed saves.':'Use Refresh map to update this snapshot.';
}
async function render({preserveMap=false}={}){
  cleanWorldPreview();const version=++viewNumber,mapView=preserveMap?cleanMap.getView?.():null;cleanMap();const content=$('#content');if(!preserveMap)content.innerHTML='<div class="progress-message">Connecting to your factory…</div>';
  try{
    if(currentPage!=='accounts'){status=await api('/status');updateChrome();}
    await refreshReleases();
    await refreshUpdates();
    let html,mapData=null;
    if(currentPage==='overview'){const [data,backups]=await Promise.all([api('/jobs'),api('/backups')]);html=overview(data.jobs,backups.health);}
    if(currentPage==='worlds'){const [data,options]=await Promise.all([api('/worlds'),admin()?api('/world-options'):null]);worldOptions=options;html=worldPage(data.worlds);}
    if(currentPage==='backups'){const data=await api('/backups');html=backupPage(data.backups,data.schedule,data.health);}
    if(currentPage==='map'){mapData=await api('/map');html=mapPage(mapData);}
    if(currentPage==='players')html=playersPage();
    if(currentPage==='logs'){const [jobs,logs]=await Promise.all([api('/jobs'),api('/logs')]);html=logsPage(jobs.jobs,logs.text);}
    if(currentPage==='settings')html=location.hash==='#settings/updates'?heading('UPDATES','Stay up to date, on your terms.','Review changes. Choose when to install.')+settingsTabs()+jobBanner()+releaseView():settingsPage(await api('/settings'));
    if(currentPage==='setup')html=jobBanner()+setupPage(status,user);
    if(currentPage==='accounts'){const [data,sessionData]=await Promise.all([admin()?api('/accounts'):null,api('/sessions')]);html=accountsPage(data,sessionData.sessions);}
    if(version!==viewNumber)return;content.className=currentPage==='worlds'&&location.hash==='#worlds/create'?'creation-page':currentPage==='setup'?'setup-page':currentPage==='overview'?'overview-page':currentPage==='settings'&&location.hash==='#settings/updates'?'updates-page':'';content.innerHTML=html;updateChrome();bindPage();if(mapData){renderedMapCreated=mapData.snapshot?.created||null;renderedMapScope=mapData.snapshot?{world:mapData.snapshot.world,seed:mapData.snapshot.seed,surface:mapData.snapshot.surface}:null;if(mapData.snapshot){cleanMap=mountMap(mapData,mapView);if(livePositions)applyLivePlayers(livePositions);void refreshLivePlayers();}}
  }catch(error){if(version===viewNumber)content.innerHTML=heading('CONNECTION','Waiting for the controller.',esc(error.message))+`<button class="button" id="retry">Try again</button>`;$('#retry')?.addEventListener('click',render);}
}
function applyLivePlayers(value){
  if(currentPage!=='map'||!renderedMapScope)return;
  cleanMap.updatePlayers?.(value);const label=$('#live-player-state'),list=$('#live-player-list'),button=$('#toggle-live-players');if(!label||!list)return;
  const matches=value.world===renderedMapScope.world&&value.seed===renderedMapScope.seed;
  const messages={disabled:'Showing saved positions. Live tracking is off; enabling it disables achievements for this world.',offline:'Factorio is stopped or restarting. Live markers are hidden.',unavailable:'Live positions are temporarily unavailable. Markers are hidden until the next update.', 'different-world':'Live tracking was approved for another world. Enable it separately for the current world.'};
  label.textContent=value.state==='live'?(matches?`${value.players.length} online · updates every 2 seconds · checked ${new Date(value.updatedAt).toLocaleTimeString()}`:'The live server is running a different world from this map. Refresh the map to show its players.'):(messages[value.state]||'Checking live positions…');
  list.replaceChildren();
  if(value.state==='live'&&matches){
    if(!value.players.length){const empty=document.createElement('p');empty.className='hint';empty.textContent='Nobody is online. Players appear here when they join.';list.append(empty);}
    for(const player of value.players){
      const row=document.createElement('div');row.className='detail-row live-player-row';const text=document.createElement('span');text.textContent=`${player.name} · X ${player.x.toFixed(1)} · Y ${player.y.toFixed(1)} · ${player.surface}`;row.append(text);
      if(player.surface===renderedMapScope.surface){const center=document.createElement('button');center.className='button small';center.textContent='Center on '+player.name;center.addEventListener('click',()=>{cleanMap.centerPlayer?.(player.name);$('#world-map')?.scrollIntoView({behavior:'smooth',block:'center'});});row.append(center);}list.append(row);
    }
  }
  if(button){button.disabled=!!busyJob;button.textContent=value.enabled?'Turn off live tracking':'Enable live tracking';}
}
async function refreshLivePlayers(){
  if(!user||currentPage!=='map'||document.hidden||livePolling||!renderedMapScope)return;
  const version=viewNumber;livePolling=true;
  try{const value=await api('/live-players');if(version!==viewNumber||currentPage!=='map')return;livePositions=value;applyLivePlayers(value);}
  catch{if(version===viewNumber&&user){livePositions={enabled:true,state:'unavailable',players:[]};applyLivePlayers(livePositions);}}
  finally{livePolling=false;}
}
async function refresh(){
  if(!user||document.hidden)return;
  try{
    const view=viewNumber;status=await api('/status');if(view!==viewNumber)return;updateChrome();
    await refreshReleases();
    await refreshUpdates();if(view!==viewNumber)return;
    if(currentPage==='map'){
      const version=viewNumber,latest=await api('/map-status');if(version!==viewNumber||currentPage!=='map')return;
      const label=$('#map-refresh-state');if(label)label.textContent=mapRefreshLabel(latest.automatic,latest.active);
      const banner=$('.job-banner');if(banner&&!busyJob){if(latest.active)banner.querySelector('span:last-child').textContent=latest.active.message;else banner.remove();}
      if(latest.created!==renderedMapCreated&&!busyJob&&!cleanMap.isInteracting?.()&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!document.querySelector('dialog[open]'))await render({preserveMap:true});
    }
    if(currentPage==='setup'&&!busyJob&&!document.querySelector('dialog[open]')){const focus=document.activeElement?.id;$('#content').innerHTML=jobBanner()+setupPage(status,user);bindPage();if(focus)document.getElementById(focus)?.focus({preventScroll:true});}
    if(currentPage==='overview'&&!busyJob&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!document.querySelector('dialog[open]')){
      const view=viewNumber;const [data,backups]=await Promise.all([api('/jobs'),api('/backups')]);if(view!==viewNumber)return;$('#content').innerHTML=overview(data.jobs,backups.health);bindPage();
    }
  }catch{}
}
async function startJob(action,params={}){
  if(busyJob)return toast('An operation is already running.');
  try{
    busyJob=await api('/jobs',{method:'POST',body:{action,params}});toast('Operation started. You can watch its progress here.');
    const jobId=busyJob.id;await render();
    for(;;){
      await new Promise(resolve=>setTimeout(resolve,1000));const data=await api('/jobs'),job=data.jobs.find(item=>item.id===jobId);
      if(!job){busyJob=null;break;}busyJob=job;
      const banner=$('.job-banner span:last-child');if(banner)banner.textContent=job.message;
      if(!['running','queued'].includes(job.state)){
        busyJob=null;if(job.state==='succeeded'){if(action==='create'){clearWorldDraft();createdWorld={name:params.name,message:job.message};if(currentPage==='worlds')history.replaceState(null,'','/#worlds/created');}if(action==='world-options')useCopiedSettings();}toast(job.message,job.state!=='succeeded');await render();
        if(action==='console'&&$('#console-output'))$('#console-output').textContent=job.result||job.message;
        break;
      }
    }
  }catch(error){busyJob=null;toast(error.message,true);await render();}
}
function bindPage(){
  bindUpdates();
  $('#finish-setup')?.addEventListener('click',async()=>{const button=$('#finish-setup');button.disabled=true;try{user.onboarding=await api('/onboarding',{method:'POST',body:{complete:true}});location.hash='#overview';toast('Setup complete. Welcome to your factory.');}catch(error){toast(error.message,true);button.disabled=!setupReady(status);}});
  $('#world-search')?.addEventListener('input',event=>{worldSearch=event.target.value;$('#world-results').innerHTML=worldRows(visibleWorlds);bindWorldRows();});
  if(currentPage==='worlds'&&admin())bindWorldEditor(worldOptions,{startJob,confirmAction,toast,api});
  $('#toggle-live-players')?.addEventListener('click',async()=>{
    const enabled=!livePositions?.enabled;
    if(enabled&&!await confirmAction('Enable live positions and disable achievements?','Factorio treats the read-only coordinate query as a Lua console command, which permanently disables achievements for this world. A backup will be created first. Turning tracking off later will not restore achievements. PC and Switch play remain compatible.'))return;
    await startJob('live-tracking',{enabled,...(enabled?{confirm:true,world:renderedMapScope.world,seed:renderedMapScope.seed}:{})});
    await refreshLivePlayers();
  });
  $('#password-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const body=Object.fromEntries(new FormData(event.target));if(body.password!==body.confirmation)return toast('The new passwords do not match.',true);
    const button=event.target.querySelector('button');button.disabled=true;
    try{user=await api('/password',{method:'POST',body});event.target.reset();await render();toast('Password changed. Other sessions have been signed out.');}catch(error){toast(error.message,true);}finally{button.disabled=false;}
  });
  async function revokeSession(body){try{await api('/sessions',{method:'POST',body});await render();toast('Sessions updated.');}catch(error){toast(error.message,true);}}
  $('#revoke-other-sessions')?.addEventListener('click',()=>revokeSession({others:true}));
  document.querySelectorAll('[data-session]').forEach(button=>button.addEventListener('click',()=>revokeSession({id:button.dataset.session})));
  async function updateAccount(body){if(!await confirmAction(body.operation==='delete'?'Remove '+body.username+'?':'Change access for '+body.username+'?',body.operation==='delete'?'This removes the panel account and signs it out. The person will need a new invitation to register again.':'The selected access will take effect immediately and this account will be signed out.'))return;try{await api('/accounts',{method:'POST',body:{...body,confirm:true}});if(body.username===user.username){showLogin();toast('Your account access changed. Sign in again.');}else{await render();toast('Account updated.');}}catch(error){toast(error.message,true);}}
  document.querySelectorAll('[data-account-role]').forEach(button=>button.addEventListener('click',()=>updateAccount({username:button.dataset.accountRole,operation:'role',role:button.dataset.role})));
  document.querySelectorAll('[data-account-delete]').forEach(button=>button.addEventListener('click',()=>updateAccount({username:button.dataset.accountDelete,operation:'delete'})));
  document.querySelectorAll('[data-verify-backup]').forEach(button=>button.addEventListener('click',()=>startJob('verify-backup',{name:button.dataset.verifyBackup})));
  $('#pin-form')?.addEventListener('submit',async event=>{event.preventDefault();const body=Object.fromEntries(new FormData(event.target));body.x=Number(body.x);body.y=Number(body.y);try{await api('/pins',{method:'POST',body});await render();toast('Shared pin added.');}catch(error){toast(error.message,true);}});
  document.querySelectorAll('[data-remove-pin]').forEach(button=>button.addEventListener('click',async()=>{try{await api('/pins',{method:'POST',body:{remove:button.dataset.removePin}});await render();toast('Pin removed.');}catch(error){toast(error.message,true);}}));
  $('#invite-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;
    try{const invitation=await api('/invitations',{method:'POST',body:Object.fromEntries(new FormData(event.target))});await render();$('#invite-result').hidden=false;$('#invite-link').value=location.origin+'/#register='+invitation.token;$('#invite-link').focus();$('#invite-link').select();}
    catch(error){toast(error.message,true);}finally{button.disabled=false;}
  });
  document.querySelectorAll('[data-revoke]').forEach(button=>button.addEventListener('click',async()=>{
    if(!await confirmAction('Revoke this invitation?','The registration link will stop working immediately. Existing accounts keep their access.'))return;
    try{await api('/invitations',{method:'POST',body:{revoke:button.dataset.revoke}});await render();toast('Invitation revoked.');}catch(error){toast(error.message,true);}
  }));
  document.querySelectorAll('[data-scroll-to]').forEach(button=>button.addEventListener('click',()=>{const form=$('#'+button.dataset.scrollTo);if(!form)return;const details=form.closest('details');if(details)details.open=true;(details||form).scrollIntoView({behavior:'smooth',block:'start'});}));
  document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',async()=>{
    const action=button.dataset.action;const params={};
    if(['restart','stop'].includes(action)){if(!await confirmAction(action==='stop'?'Stop the server?':'Restart the server?',`The world will be saved. ${status.players.length?status.players.length+' connected player(s) will be disconnected.':'Nobody is currently connected.'}`))return;params.confirm=true;}
    startJob(action,params);
  }));
  document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(button.dataset.copy);toast('Connection address copied.');}catch{toast('Connection address: '+button.dataset.copy);}}));
  document.querySelectorAll('[data-world-filter]').forEach(button=>button.addEventListener('click',()=>{worldFilter=button.dataset.worldFilter;render();}));
  bindWorldRows();
  document.querySelectorAll('[data-player-op]').forEach(button=>button.addEventListener('click',async()=>{if(await confirmAction(pretty(button.dataset.playerOp)+' '+button.dataset.playerName+'?','This action takes effect immediately.'))startJob('player',{name:button.dataset.playerName,operation:button.dataset.playerOp});}));
  $('#upload-form')?.addEventListener('submit',async event=>{event.preventDefault();const file=new FormData(event.target).get('world');if(!file?.size)return;if(file.size>128*1024*1024)return toast('World uploads are limited to 128 MB.',true);const button=event.target.querySelector('button');button.disabled=true;try{const result=await api('/upload?name='+encodeURIComponent(file.name),{method:'POST',body:file,raw:true});toast(result.message);await render();}catch(error){toast(error.message,true);}finally{button.disabled=false;}});
  $('#schedule-form')?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.target);try{await api('/schedule',{method:'POST',body:{enabled:data.has('enabled'),hours:Number(data.get('hours')),keep:Number(data.get('keep'))}});toast('Backup schedule saved.');}catch(error){toast(error.message,true);}});
  $('#player-form')?.addEventListener('submit',async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.target));if(await confirmAction('Update '+data.name+'?','This changes the selected player’s access immediately.'))startJob('player',data);});
  $('#announce-form')?.addEventListener('submit',event=>{event.preventDefault();startJob('announce',Object.fromEntries(new FormData(event.target)));});
  $('#console-form')?.addEventListener('submit',event=>{event.preventDefault();startJob('console',Object.fromEntries(new FormData(event.target)));});
  $('#settings-form')?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.target);if(!await confirmAction('Save settings and restart?','A backup will be created before applying these settings. Connected players will be disconnected if the server is running.'))return;const params=Object.fromEntries(data);for(const key of ['max_players','autosave_interval','autosave_slots'])params[key]=Number(params[key]);for(const key of ['auto_pause','require_user_verification','clear_password'])params[key]=data.has(key);params.confirm=true;startJob('settings',params);});
}
function bindWorldRows(){
  document.querySelectorAll('[data-load-world]').forEach(button=>button.addEventListener('click',async()=>{if(await confirmAction('Switch to '+button.dataset.name+'?','The current world will be saved and backed up. Connected players will be disconnected while the selected world starts.'))startJob('switch',{id:button.dataset.loadWorld,confirm:true});}));
  document.querySelectorAll('[data-restore]').forEach(button=>button.addEventListener('click',async()=>{if(await confirmAction('Restore this backup?','The current world, settings, and mods will be backed up before this snapshot is restored. Connected players will be disconnected.'))startJob('restore',{name:button.dataset.restore,confirm:true});}));
  document.querySelectorAll('[data-preview]').forEach(button=>button.addEventListener('click',()=>{
    const image=$('#preview-image');image.src='/api/preview?id='+encodeURIComponent(button.dataset.preview);image.onerror=()=>{$('#preview-dialog').close();toast('This world has no generated preview.',true);};$('#preview-dialog').showModal();
  }));
}
$('#close-preview').addEventListener('click',()=>$('#preview-dialog').close());
document.querySelectorAll('[data-icon]').forEach(el=>{el.innerHTML=icon(el.dataset.icon);});
if(location.hash.startsWith('#register=')){const token=location.hash.slice(10);history.replaceState(null,'','/');await showRegistration(token);}
else try{user=await api('/session');await showApp();}catch{showLogin();}
