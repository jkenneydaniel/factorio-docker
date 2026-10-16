import {mountMap} from './map.js';
import {cleanWorldPreview} from './world-preview.js';
import {worldForm,bindWorldEditor,clearWorldDraft,useCopiedSettings} from './world-editor.js';
let worldOptions=null;
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
async function confirmAction(title,message){const dialog=$('#confirm-dialog');$('#confirm-title').textContent=title;$('#confirm-message').textContent=message;dialog.returnValue='';dialog.showModal();return await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));}
function showLogin(){cleanWorldPreview();clearWorldDraft();worldOptions=null;user=null;livePositions=null;cleanMap();clearInterval(refreshTimer);clearInterval(liveTimer);$('#app-view').hidden=true;$('#login-view').hidden=false;$('#login-form').hidden=false;$('#register-form').hidden=true;}
function invitationToken(value){return String(value).trim().split('#register=').pop();}
async function showRegistration(token=''){
  showLogin();$('#login-form').hidden=true;$('#register-form').hidden=false;$('#register-form').reset();
  $('#register-error').textContent='';$('#invite-label').hidden=!!token;$('#register-form').elements.invitation.value=token;
  $('#register-description').textContent='Use an invitation from your administrator to create an account.';
  if(token){try{const invitation=await api('/registration',{method:'POST',body:{token}});$('#register-description').textContent=`You’re invited with ${invitation.role==='admin'?'administrator':'read-only'} access. Choose your own login below.`;}
    catch(error){$('#register-error').textContent=error.message;$('#invite-label').hidden=false;}}
}
$('#open-registration').addEventListener('click',()=>showRegistration());
$('#back-to-login').addEventListener('click',showLogin);
$('#register-form').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target,button=form.querySelector('button[type="submit"]'),data=new FormData(form);$('#register-error').textContent='';
  if(data.get('password')!==data.get('confirmation')){$('#register-error').textContent='The passwords do not match.';return;}
  button.disabled=true;
  try{user=await api('/register',{method:'POST',body:{token:invitationToken(data.get('invitation')),username:data.get('username'),password:data.get('password')}});form.reset();history.replaceState(null,'','/#overview');await showApp();toast('Your account is ready. Welcome to the factory.');}
  catch(error){$('#register-error').textContent=error.message;}finally{button.disabled=false;}
});
async function showApp(){
  $('#login-view').hidden=true;$('#app-view').hidden=false;$('#user-label').textContent=user.username+' · '+(admin()?'Administrator':'Read-only');
  $('#accounts-nav').hidden=false;
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
  currentPage=['overview','worlds','map','backups','players','logs','settings','accounts'].includes(page)?page:'overview';
  document.querySelectorAll('[data-page]').forEach(link=>link.classList.toggle('active',link.dataset.page===currentPage));
  $('#breadcrumb-page').textContent={overview:'Overview',worlds:'Worlds',map:'Map',backups:'Backups',players:'Players',logs:'Activity & logs',settings:'Settings',accounts:'Accounts'}[currentPage];
  await render();
}
function heading(eyebrow,title,description,actions=''){return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div><div class="button-group">${actions}</div></div>`;}
function readonly(){return admin()?'':'<div class="readonly-note">You’re signed in with read-only access. An administrator can change settings and manage worlds.</div>';}
function jobBanner(){const job=busyJob||status?.activeJob;return job&&['running','queued'].includes(job.state)?`<div class="job-banner"><span class="spinner"></span><span>${esc(job.message||'Working…')}</span></div>`:'';}
function card(title,body,link=''){return `<section class="card"><div class="card-header"><h2>${title}</h2>${link}</div><div class="card-body">${body}</div></section>`;}
function empty(title,description=''){return `<div class="empty-state"><div class="empty-symbol">◈</div>${esc(title)}${description?`<p>${esc(description)}</p>`:''}</div>`;}
function actionButton(label,action,extra='',primary=false){return `<button class="button${primary?' primary':''}" data-action="${action}" ${extra} ${!admin()||busyJob?'disabled':''}>${label}</button>`;}
const factory=`<div class="factory-icon"><svg viewBox="0 0 150 130" aria-hidden="true"><path d="M17 112V62l33 15V58l31 16V54l40 22v36z" fill="#647d57"/><path d="M87 15h14l5 54-25-12z" fill="#a29d7a"/><path d="M22 111V73l27 12V71l30 14V68l36 18v25z" fill="#90a477"/><path d="M17 112h108v8H17z" fill="#4f6547"/><path d="M33 91h12v12H33zm24 0h12v12H57zm25 0h12v12H82z" fill="#dce4cb"/><path d="M88 7c-10-9-24 2-14 10 9 7 24 1 16-7" fill="#d0d9c1"/><path d="M47 110V85l-27-13" fill="none" stroke="#b8c1a0" stroke-width="3"/></svg></div>`;
function activityRows(jobs,limit=5){return jobs.length?jobs.slice(0,limit).map(job=>`<div class="activity-row ${job.state==='failed'?'failed':''}"><div class="activity-icon">${job.state==='succeeded'?'✓':job.state==='failed'?'!':'↻'}</div><div><strong>${esc(pretty(job.action))} <span class="mini-pill">${esc(job.state)}</span></strong><p>${esc(job.message)}</p></div><time>${esc(relative(job.finished||job.started))}</time></div>`).join(''):empty('Nothing to report.','Server actions and completed backups will appear here.');}
function overview(jobs=[]){
  const s=status,paused=s.paused;const stateLabel=!s.running?'Stopped':!s.ready?'Starting':paused?'Paused · waiting for players':'Running';
  const lastTime=s.playtime||'Fresh world';
  return heading('SERVER OVERVIEW','Keep the factory running.','Your world, players, and progress — all in one place.',`${actionButton('↓ Save now','save','',true)}${actionButton('↻ Restart','restart')}`)+readonly()+jobBanner()+`
  <section class="hero"><div class="hero-copy"><div class="status-pill ${!s.running?'offline':paused?'paused':''}"><span class="dot"></span>${stateLabel}</div><h2>${esc(s.name||'Your Factorio server')}</h2><p>${paused?'Everything is saved and the factory is resting. It will resume when an engineer joins.':s.running?'A shared world for your PC and Switch. Ready whenever inspiration strikes.':'The server is stopped. Start it to continue from the latest saved progress.'}</p><div class="hero-meta"><span>◈ ${esc(s.currentWorld?.replace(/\.zip$/,'')||'No world loaded')}</span><span>Seed ${esc(s.seed||'—')}</span></div></div><div class="hero-art">${factory}</div></section>
  <div class="stats-grid">
    <div class="stat-card"><div class="stat-label">Engineers online <span class="stat-glyph">♧</span></div><div class="stat-value">${s.players.length}<small>players</small></div><div class="stat-foot">${s.players.length?esc(s.players.join(', ')):'A quiet moment in the factory'}</div></div>
    <div class="stat-card"><div class="stat-label">Last saved <span class="stat-glyph">▣</span></div><div class="stat-value">${esc(relative(s.lastSaveAt))}</div><div class="stat-foot">${s.saveVerified?'Save completion confirmed in server log':'Latest save file on disk'}</div></div>
    <div class="stat-card"><div class="stat-label">Memory usage <span class="stat-glyph">▥</span></div><div class="stat-value">${esc(bytes(s.memory))}</div><div class="stat-foot">Factorio container · ${s.cpu==null?'CPU warming up':s.cpu.toFixed(1)+'% CPU'}</div></div>
    <div class="stat-card"><div class="stat-label">Autosave interval <span class="stat-glyph">◷</span></div><div class="stat-value">${s.autosaveMinutes||5}<small>minutes</small></div><div class="stat-foot">${s.autosaveSlots||10} rolling saves · during play</div></div>
  </div>
  <div class="content-grid">${card('World & connection',`
    <div class="world-shortcuts"><a class="button" href="#worlds">Switch world</a>${admin()?'<a class="button primary" href="#worlds/create">＋ New world</a>':''}</div>
    <div class="detail-row"><span>World playtime</span><strong>${esc(lastTime)}</strong></div>
    <div class="detail-row"><span>Game version</span><strong>${esc(s.version.replace(/^Version:\s*/,''))}</strong></div>
    <div class="detail-row"><span>Pause when empty</span><strong class="mini-pill">${s.autoPause?'Enabled':'Disabled'}</strong></div>
    <div class="detail-row"><span>Backup schedule</span><strong>${s.schedule.enabled?'Every '+s.schedule.hours+' hours':'Manual backups'}</strong></div>
    <div class="connection-box"><div class="eyebrow">JOIN FROM YOUR SWITCH OR ANOTHER PC</div><div class="connection-line"><code>${esc(s.connection)}</code><button class="copy-button" data-copy="${esc(s.connection)}">Copy address ⧉</button></div></div><p class="hint">Use Multiplayer → Connect to address. Match the server’s game version and choose a unique LAN player name.</p>`,'<a href="#settings">Manage settings ↗</a>')}
    ${card('Recent activity',activityRows(jobs),'<a href="#logs">View all ↗</a>')}</div>
  <div class="section-spacer">${card('Server controls',`<div class="button-group">${actionButton('▶ Start server','start',s.running?'disabled':'',true)}${actionButton('■ Stop & save','stop',!s.running?'disabled':'')}${actionButton('▣ Create backup','backup')}</div><p class="hint">Stopping saves the current world. A stopped server starts again when Docker restarts. The panel remains available while Factorio is stopped.</p>`)}</div>`;
}
function worldRows(worlds){const filtered=worlds.filter(world=>worldFilter==='all'||worldFilter==='autosaves'&&world.kind==='autosave'||worldFilter==='library'&&world.kind==='archive'||worldFilter==='active'&&world.current);return filtered.length?`<div class="table-wrap"><table><thead><tr><th>World</th><th>Updated</th><th>Size</th><th></th></tr></thead><tbody>${filtered.map(world=>`<tr><td><span class="name">${esc(world.name)}</span><span class="secondary">${world.current?'● Currently running':world.kind==='autosave'?'Rolling autosave':world.kind==='archive'?'Archived world':'Current world save'}</span></td><td>${date(world.modified)}</td><td>${bytes(world.size)}</td><td><div class="row-actions">${admin()?`<a class="button small" href="/api/download?kind=world&amp;id=${encodeURIComponent(world.id)}">Download</a>`:''}${world.relative.startsWith('panel-worlds/')?`<button class="button small" data-preview="${esc(world.id)}">Preview</button>`:''}${!world.current&&admin()?`<button class="button small primary" data-load-world="${esc(world.id)}" data-name="${esc(world.name)}" ${busyJob?'disabled':''}>Switch to world</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`:empty('No worlds in this view.');}
function worldPage(worlds){return heading('WORLD LIBRARY','Create and switch worlds.','Create a fresh world, upload a save, or choose which world the server runs.',admin()?'<button class="button primary" data-scroll-to="create-form">＋ New world</button><button class="button" data-scroll-to="upload-form">Upload save</button>':'')+readonly()+jobBanner()+`
  <section class="card world-current"><div class="card-body"><div class="eyebrow">CURRENT SERVER WORLD</div><strong>${esc(status.currentWorld||'No world loaded')}</strong><p class="hint">Choose <strong>Switch to world</strong> beside a different save below. Switching saves and backs up your current world, then reconnects the server with the selected world. Connected players will need to rejoin.</p></div></section>
  ${admin()?`<div class="world-forms"><details class="card" ${location.hash==='#worlds/create'?'open':''}><summary>Create a new world</summary><div class="card-body world-builder-body">${worldForm(worldOptions,!!busyJob)}</div></details><details class="card"><summary>Upload an existing save</summary><div class="card-body"><form id="upload-form"><p class="form-note">Add a Factorio save ZIP to the library. Uploading does not replace the running world.</p><label>World ZIP<input class="file-input" name="world" type="file" accept=".zip" required></label><p class="form-note">Maximum 128 MB. Use a world compatible with Factorio 2.0.77 and your enabled mods.</p><button class="button" ${busyJob?'disabled':''}>Upload to library</button></form></div></details></div>`:''}
  <div class="tag-tabs">${[['all','All worlds'],['active','Current world'],['library','Library'],['autosaves','Autosaves']].map(([value,label])=>`<button class="${worldFilter===value?'active':''}" data-world-filter="${value}">${label}</button>`).join('')}</div>
  <section class="card"><div class="card-header"><h2>Choose a world</h2><span class="hint">${worlds.length} saves</span></div>${worldRows(worlds)}</section>`;}
function backupPage(items,schedule,health){return heading('PROGRESS, PROTECTED','A little peace of mind.','Complete snapshots of your saves, server settings, and mods.',actionButton('▣ Create backup','backup','',true))+readonly()+jobBanner()+backupHealthView(health)+`
  <section class="card">${items.length?`<div class="table-wrap"><table><thead><tr><th>Backup</th><th>Created</th><th>Size</th><th></th></tr></thead><tbody>${items.map(item=>`<tr><td><span class="name">${esc(item.relative.replace(/\.zip$/,''))}</span><span class="secondary">${item.validation?item.validation.ok?'✓ Archive integrity verified '+date(item.validation.checked):'⚠ '+esc(item.validation.error):'Not verified yet'}</span></td><td>${date(item.modified)}</td><td>${bytes(item.size)}</td><td><div class="row-actions">${admin()?`<button class="button small" data-verify-backup="${esc(item.relative)}" ${busyJob?'disabled':''}>Verify</button><a class="button small" href="/api/download?kind=backup&amp;name=${encodeURIComponent(item.relative)}">Download</a><button class="button small" data-restore="${esc(item.relative)}" ${busyJob?'disabled':''}>Restore</button>`:''}</div></td></tr>`).join('')}</tbody></table></div>`:empty('Your first backup is a click away.','World changes and restores also create a backup automatically.')}</section>
  ${admin()?`<div class="section-spacer">${card('Automatic backups',`<form id="schedule-form"><label class="check-label"><input type="checkbox" name="enabled" ${schedule.enabled?'checked':''}>Create backups on a schedule</label><div class="form-grid"><label>Every (hours)<input name="hours" type="number" min="1" max="168" value="${schedule.hours}" required></label><label>Scheduled backups to keep<input name="keep" type="number" min="2" max="100" value="${schedule.keep}" required></label></div><p class="form-note">The PC and Docker must be running. Manual backups and backups taken before world changes are kept separately from scheduled retention.</p><button class="button primary">Save schedule</button></form>`)}</div>`:''}`;}
function playersPage(){return heading('YOUR CREW','Better with company.','See who’s connected and manage the engineers in your world.')+readonly()+jobBanner()+`
  <section class="card"><div class="card-header"><h2>Online players</h2><span class="mini-pill">${status.players.length} connected</span></div>${status.players.length?`<div class="table-wrap"><table><tbody>${status.players.map(name=>`<tr><td><span class="player-avatar">${esc(name.slice(0,2).toUpperCase())}</span><strong>${esc(name)}</strong></td><td><span class="online-label"><span class="dot"></span>Online</span></td><td class="row-actions">${admin()?`<button class="button small" data-player-name="${esc(name)}" data-player-op="kick">Kick</button><button class="button small danger" data-player-name="${esc(name)}" data-player-op="ban">Ban</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:empty('No engineers online.','The factory pauses automatically when everyone leaves, if pause when empty is enabled.')}</section>
  ${admin()?`<div class="split-layout section-spacer">${card('Player access',`<form id="player-form"><label>LAN player name<input name="name" maxlength="64" required placeholder="Player name"></label><label>Action<select name="operation"><option value="promote">Make administrator</option><option value="demote">Remove administrator</option><option value="whitelist">Add to whitelist</option><option value="unwhitelist">Remove from whitelist</option><option value="unban">Remove ban</option><option value="ban">Ban player</option></select></label><p class="form-note">Adding names to an empty whitelist restricts joining to those names. LAN player names are self-selected while identity verification is disabled.</p><button class="button">Apply player action</button></form>`)}${card('Send an announcement',`<form id="announce-form"><label>Message<textarea name="message" maxlength="250" required placeholder="A message for everyone in the factory…"></textarea></label><button class="button primary">Send announcement</button></form>`)}</div>`:''}`;}
function logsPage(jobs,logs){return heading('UNDER THE HOOD','Know what’s happening.','Completed actions, server events, and the latest log output.')+jobBanner()+`
  <div class="split-layout">${card('Server log',`<pre class="logs">${esc(logs||'The server has not written a log yet.')}</pre>`)}${card('Panel activity',activityRows(jobs,20))}</div>
  ${admin()?`<div class="section-spacer">${card('Administrative console',`<form id="console-form"><p class="form-note">These commands inspect the server without running Lua scripts or disabling achievements.</p><div class="inline-choice"><select name="command" aria-label="Administrative command">${['/players','/time','/seed','/version','/evolution','/admins','/bans','/whitelist get','/help'].map(command=>`<option>${esc(command)}</option>`).join('')}</select><button class="button">Run command</button></div><pre id="console-output" class="logs console-output">Choose a command to inspect the server.</pre></form>`)}</div>`:''}`;}
function settingsPage(settings){return heading('MAKE IT YOURS','The way you like to play.','Server preferences for your shared PC and Switch world.')+readonly()+jobBanner()+`
  <div class="split-layout">${card('Server settings',`<form id="settings-form"><label>Server name<input name="name" value="${esc(settings.name)}" maxlength="100" required ${admin()?'':'disabled'}></label><label>Description<textarea name="description" maxlength="500" ${admin()?'':'disabled'}>${esc(settings.description)}</textarea></label><div class="form-grid"><label>Player limit (0 = unlimited)<input name="max_players" type="number" min="0" max="1000" value="${settings.max_players}" ${admin()?'':'disabled'} required></label><label>Autosave interval (minutes)<input name="autosave_interval" type="number" min="1" max="60" value="${settings.autosave_interval}" ${admin()?'':'disabled'} required></label><label>Rolling autosave slots<input name="autosave_slots" type="number" min="1" max="100" value="${settings.autosave_slots}" ${admin()?'':'disabled'} required></label><label>New game password<input name="game_password" type="password" autocomplete="new-password" placeholder="${settings.passwordSet?'Leave blank to keep current password':'Optional'}" ${admin()?'':'disabled'}></label></div><label class="check-label"><input type="checkbox" name="auto_pause" ${settings.auto_pause?'checked':''} ${admin()?'':'disabled'}>Pause the world when nobody is connected</label><label class="check-label"><input type="checkbox" name="require_user_verification" ${settings.require_user_verification?'checked':''} ${admin()?'':'disabled'}>Require Factorio account identity verification</label>${settings.passwordSet?'<label class="check-label"><input type="checkbox" name="clear_password">Remove the current game password</label>':''}<p class="form-note">Keep account verification off for Switch LAN usernames. Changes create a backup and restart the server when it is running.</p>${admin()?'<button class="button primary">Save & restart</button>':''}</form>`)}
  ${card('PC + Switch compatibility',`<div class="detail-row"><span>Server version</span><strong>${esc(status.version.replace(/^Version:\s*/,''))}</strong></div><div class="detail-row"><span>Update policy</span><strong class="mini-pill">Version pinned</strong></div><div class="detail-row"><span>Public server listing</span><strong>Disabled</strong></div><div class="detail-row"><span>LAN address</span><strong>${esc(status.connection)}</strong></div><p class="hint">PC and Switch must run the same Factorio version. Switch cannot load optional mods. This panel keeps the server’s existing image and mod configuration.</p><p class="hint">Docker Desktop starts after Windows sign-in. The panel and Factorio container then start automatically.</p><p class="hint">Panel accounts are separate from Factorio player names. Administrators can invite people to register from the Accounts page.</p>`)}</div>`;}
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
    <div class="map-summary"><span>◈ ${esc(map.world.replace(/\.zip$/,''))}</span><span>Snapshot ${date(map.created)}</span><span>${map.chunks.length.toLocaleString()} explored chunks · ${map.entities.length.toLocaleString()} objects</span><span>Seed ${map.seed}</span></div>
    <section class="map-shell"><div class="map-tools"><div class="button-group"><button id="map-plus" class="button small" aria-label="Zoom in">＋</button><button id="map-minus" class="button small" aria-label="Zoom out">−</button><button id="map-fit" class="button small">Fit map</button><button id="map-base" class="button small">Base / spawn</button></div><span id="map-coordinates">X 0 · Y 0</span></div><canvas id="world-map" tabindex="0" aria-label="Explored factory map. Drag to pan, scroll or pinch to zoom. Arrow keys pan, plus and minus zoom, zero fits the map."></canvas>
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
    if(currentPage!=='accounts'){status=await api('/status');$('#header-version').textContent='Factorio '+(status.version.match(/\d+\.\d+\.\d+/)?.[0]||status.version);}
    let html,mapData=null;
    if(currentPage==='overview'){const data=await api('/jobs');html=overview(data.jobs);}
    if(currentPage==='worlds'){const [data,options]=await Promise.all([api('/worlds'),admin()?api('/world-options'):null]);worldOptions=options;html=worldPage(data.worlds);}
    if(currentPage==='backups'){const data=await api('/backups');html=backupPage(data.backups,data.schedule,data.health);}
    if(currentPage==='map'){mapData=await api('/map');html=mapPage(mapData);}
    if(currentPage==='players')html=playersPage();
    if(currentPage==='logs'){const [jobs,logs]=await Promise.all([api('/jobs'),api('/logs')]);html=logsPage(jobs.jobs,logs.text);}
    if(currentPage==='settings')html=settingsPage(await api('/settings'));
    if(currentPage==='accounts'){const [data,sessionData]=await Promise.all([admin()?api('/accounts'):null,api('/sessions')]);html=accountsPage(data,sessionData.sessions);}
    if(version!==viewNumber)return;content.innerHTML=html;bindPage();if(mapData){renderedMapCreated=mapData.snapshot?.created||null;renderedMapScope=mapData.snapshot?{world:mapData.snapshot.world,seed:mapData.snapshot.seed,surface:mapData.snapshot.surface}:null;if(mapData.snapshot){cleanMap=mountMap(mapData,mapView);if(livePositions)applyLivePlayers(livePositions);void refreshLivePlayers();}}
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
    status=await api('/status');
    if(currentPage==='map'){
      const version=viewNumber,latest=await api('/map-status');if(version!==viewNumber||currentPage!=='map')return;
      const label=$('#map-refresh-state');if(label)label.textContent=mapRefreshLabel(latest.automatic,latest.active);
      const banner=$('.job-banner');if(banner&&!busyJob){if(latest.active)banner.querySelector('span:last-child').textContent=latest.active.message;else banner.remove();}
      if(latest.created!==renderedMapCreated&&!busyJob&&!cleanMap.isInteracting?.()&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!document.querySelector('dialog[open]'))await render({preserveMap:true});
    }
    if(currentPage==='overview'&&!busyJob&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)&&!document.querySelector('dialog[open]')){
      const data=await api('/jobs');$('#content').innerHTML=overview(data.jobs);bindPage();
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
        busyJob=null;if(job.state==='succeeded'){if(action==='create')clearWorldDraft();if(action==='world-options')useCopiedSettings();}toast(job.message,job.state!=='succeeded');await render();
        if(action==='console'&&$('#console-output'))$('#console-output').textContent=job.result||job.message;
        break;
      }
    }
  }catch(error){busyJob=null;toast(error.message,true);await render();}
}
function bindPage(){
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
  document.querySelectorAll('[data-load-world]').forEach(button=>button.addEventListener('click',async()=>{if(await confirmAction('Switch to '+button.dataset.name+'?','The current world will be saved and backed up. Connected players will be disconnected while the selected world starts.'))startJob('switch',{id:button.dataset.loadWorld,confirm:true});}));
  document.querySelectorAll('[data-restore]').forEach(button=>button.addEventListener('click',async()=>{if(await confirmAction('Restore this backup?','The current world, settings, and mods will be backed up before this snapshot is restored. Connected players will be disconnected.'))startJob('restore',{name:button.dataset.restore,confirm:true});}));
  document.querySelectorAll('[data-preview]').forEach(button=>button.addEventListener('click',()=>{
    const image=$('#preview-image');image.src='/api/preview?id='+encodeURIComponent(button.dataset.preview);image.onerror=()=>{$('#preview-dialog').close();toast('This world has no generated preview.',true);};$('#preview-dialog').showModal();
  }));
  document.querySelectorAll('[data-player-op]').forEach(button=>button.addEventListener('click',async()=>{if(await confirmAction(pretty(button.dataset.playerOp)+' '+button.dataset.playerName+'?','This action takes effect immediately.'))startJob('player',{name:button.dataset.playerName,operation:button.dataset.playerOp});}));
  $('#upload-form')?.addEventListener('submit',async event=>{event.preventDefault();const file=new FormData(event.target).get('world');if(!file?.size)return;if(file.size>128*1024*1024)return toast('World uploads are limited to 128 MB.',true);const button=event.target.querySelector('button');button.disabled=true;try{const result=await api('/upload?name='+encodeURIComponent(file.name),{method:'POST',body:file,raw:true});toast(result.message);await render();}catch(error){toast(error.message,true);}finally{button.disabled=false;}});
  $('#schedule-form')?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.target);try{await api('/schedule',{method:'POST',body:{enabled:data.has('enabled'),hours:Number(data.get('hours')),keep:Number(data.get('keep'))}});toast('Backup schedule saved.');}catch(error){toast(error.message,true);}});
  $('#player-form')?.addEventListener('submit',async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(event.target));if(await confirmAction('Update '+data.name+'?','This changes the selected player’s access immediately.'))startJob('player',data);});
  $('#announce-form')?.addEventListener('submit',event=>{event.preventDefault();startJob('announce',Object.fromEntries(new FormData(event.target)));});
  $('#console-form')?.addEventListener('submit',event=>{event.preventDefault();startJob('console',Object.fromEntries(new FormData(event.target)));});
  $('#settings-form')?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.target);if(!await confirmAction('Save settings and restart?','A backup will be created before applying these settings. Connected players will be disconnected if the server is running.'))return;const params=Object.fromEntries(data);for(const key of ['max_players','autosave_interval','autosave_slots'])params[key]=Number(params[key]);for(const key of ['auto_pause','require_user_verification','clear_password'])params[key]=data.has(key);params.confirm=true;startJob('settings',params);});
}
$('#close-preview').addEventListener('click',()=>$('#preview-dialog').close());
if(location.hash.startsWith('#register=')){const token=location.hash.slice(10);history.replaceState(null,'','/');await showRegistration(token);}
else try{user=await api('/session');await showApp();}catch{showLogin();}
