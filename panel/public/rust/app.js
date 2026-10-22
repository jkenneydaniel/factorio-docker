import {serverPath} from './scope.js';
const $=selector=>document.querySelector(selector),all=selector=>[...document.querySelectorAll(selector)];
const escape=value=>String(value??'').replace(/[&<>"']/g,value=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[value]));
let modStatus=null,frameworkPlan=null,pluginConfig=null;
let session=null,page='overview',status=null,settings=null,sending=false,refreshing=false,watchedJob=null;
const registration=new URLSearchParams(location.hash.slice(1)).get('register');
if(registration)history.replaceState(null,'',location.pathname);
function message(text,error=false){const element=$(error?'#error':'#feedback');element.textContent=text;element.hidden=!text;}
async function api(route,body){
  const response=await fetch(serverPath('/api/'+route),{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(session?{'x-csrf-token':session.csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();if(!response.ok){if(response.status===401&&session){session=null;$('#shell').hidden=true;$('#auth').hidden=false;}throw Error(result.error||'Request failed.');}return result;
}
async function guarded(work){try{message('',true);await work();}catch(error){message(error.message,true);}}
function confirm(title,text){$('#confirm-title').textContent=title;$('#confirm-message').textContent=text;const dialog=$('#confirm');dialog.returnValue='cancel';dialog.showModal();return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='confirm'),{once:true}));}
function setBusy(){all('[data-action],[data-verify],#backup,#settings button,[data-mod-edit],[data-plugin-operation]').forEach(button=>button.disabled=!status||sending||!!status.activeJob||!!status.imageMigration);if(status){$('[data-action=start]').disabled||=status.running;$('[data-action=stop]').disabled||=!status.running;$('[data-action=restart]').disabled||=!status.running;const save=$('#settings button');if(save)save.disabled||=status.running||!settings?.editable;all('[data-mod-edit]').forEach(button=>button.disabled||=status.running||!modStatus?.available);$('#framework button[type=submit]').disabled||=!modStatus?.imageCapable;all('[data-plugin-operation]').forEach(button=>button.disabled||=button.dataset.pluginOperation==='reload'?!status.ready:status.running);}}
const bytes=value=>value==null?'—':value>=1024**3?(value/1024**3).toFixed(1)+' GiB':value>=1024**2?(value/1024**2).toFixed(1)+' MiB':value>=1024?(value/1024).toFixed(1)+' KiB':value+' B';
async function job(action,params={}){
  if(sending)return;const interruption={stop:['Stop Rust?','Connected players will be disconnected. Rust will save before stopping.'],restart:['Restart Rust?','Connected players will be disconnected while Rust saves and restarts.'],backup:['Back up Rust?','Rust will save and briefly stop while its complete identity is copied, then resume if it was running. Players will be disconnected.']};
  if(interruption[action]){if(!await confirm(...interruption[action]))return;params.confirm=true;}
  sending=true;setBusy();try{watchedJob=(await api('jobs',{action,params})).id;message('Operation started. Follow its progress in Overview.');await refresh();}finally{sending=false;setBusy();}
}
async function refresh(){
  if(!session||refreshing)return;refreshing=true;
  try{
    const [value,operations]=await Promise.all([api('status'),api('jobs')]);status=value;
    $('#server-name').textContent=value.name;$('#game-address').textContent=value.connection;
    $('#connection-state').textContent=value.ready?'Ready':value.running?'Starting / unavailable':'Stopped';$('#connection-state').classList.toggle('ready',value.ready);
    $('#player-count').textContent=value.players==null?'—':`${value.players} / ${value.maxPlayers??'—'}`;$('#fps').textContent=value.fps==null?'—':Number(value.fps).toFixed(0);$('#memory').textContent=bytes(value.memory);$('#cpu').textContent=value.cpu==null?'—':Number(value.cpu).toFixed(1)+'%';
    $('#jobs').innerHTML=operations.jobs.slice(0,8).map(job=>`<div class="row"><div><strong>${escape(job.action.replaceAll('-',' '))}</strong><small>${escape(job.message)}</small><small>${escape(new Date(job.started).toLocaleString())} · ${escape(job.actor)}</small></div><span class="state ${escape(job.state)}">${escape(job.state)}</span></div>`).join('')||'<p class="muted">No operations yet. Start Rust when you’re ready.</p>';
    $('#connection-warning').textContent=value.imageMigration?.message||value.error||'';$('#connection-warning').hidden=!value.imageMigration&&!value.error;setBusy();
    const watched=operations.jobs.find(job=>job.id===watchedJob);
    if(watched&&!['running','queued'].includes(watched.state)){watchedJob=null;message(watched.message,watched.state!=='succeeded');if(page==='backups')await loadPage({preserveSchedule:true});if(page==='settings'&&watched.action==='save-settings'||page==='mods')await loadPage();}
  }catch(error){$('#connection-state').textContent='Controller unavailable';$('#connection-state').classList.remove('ready');status=null;all('[data-action],[data-verify],#backup,#settings button,[data-mod-edit],[data-plugin-operation]').forEach(button=>button.disabled=true);$('#connection-warning').textContent=error.message;$('#connection-warning').hidden=false;}
  finally{refreshing=false;}
}
async function loadPage({preserveSchedule=false}={}){
  if(page==='players'){
    $('#players-note').textContent='Loading players…';$('#players').innerHTML='';
    const result=await api('players');$('#players-note').textContent=result.available?(result.players.length?`${result.players.length} players online`:'No players online.'):result.message;
    $('#players').innerHTML=result.players.map(player=>`<tr><td>${escape(player.name)}</td><td>${escape(player.id)}</td><td>${escape(player.ping??'—')} ms</td><td>${Math.floor(player.connectedSeconds/60)} min</td></tr>`).join('');
  }
  if(page==='logs'){$('#logs').textContent='Loading logs…';$('#logs').textContent=(await api('logs')).logs||'No log output yet.';}
  if(page==='settings'){
    settings=await api('settings');$('#settings-note').textContent=settings.message;
    $('#settings').innerHTML=settings.fields.map(field=>`<label>${escape(field.label)}<input name="${escape(field.key)}" type="${field.type}" ${field.type==='number'?`min="${field.min}" max="${field.max}" required`:`maxlength="${field.max}" ${field.key==='server.hostname'?'required':''}`} value="${escape(settings.values[field.key])}" ${settings.editable?'':'disabled'}></label>`).join('')+`<button class="primary" ${settings.editable?'':'disabled'} type="submit">Save settings</button>`;setBusy();
  }
  if(page==='backups'){
    const result=await api('backups');if(!preserveSchedule){$('#schedule [name=enabled]').checked=result.schedule.enabled;$('#schedule [name=hours]').value=result.schedule.hours;$('#schedule [name=keep]').value=result.schedule.keep;}
    $('#backups').innerHTML=result.backups.map(item=>`<div class="row"><div><strong>${escape(item.relative)}</strong><small>${bytes(item.size)} · ${escape(new Date(item.modified).toLocaleString())} · ${item.validation?.ok?'Archive verified':item.validation?'Verification failed':'Not verified'}</small></div><div class="actions"><button data-verify="${escape(item.relative)}">Verify</button><a href="${serverPath('/api')}/download?kind=backup&amp;name=${encodeURIComponent(item.relative)}">Download</a></div></div>`).join('')||'<p class="muted">No backups yet. Create one after Rust has written its first save.</p>';
  }
  if(page==='mods'){
    modStatus=await api('mods');$('#mods-note').textContent=modStatus.message;$('#framework-current').textContent='Current framework: '+({carbon:'Carbon',oxide:'Oxide / uMod',none:'Vanilla'}[modStatus.framework]||modStatus.framework)+(modStatus.version?' · '+modStatus.version:'');
    $('#framework [name=framework]').value=modStatus.framework;$('#recover-framework').hidden=!modStatus.recoveryRequired;
    $('#plugins').innerHTML=modStatus.plugins.map(plugin=>`<div class="row"><div><strong>${escape(plugin.name)}</strong><small>${plugin.disabled?'Disabled':'Enabled'} · ${bytes(plugin.size)}</small></div><div class="actions"><button data-plugin-operation="${plugin.disabled?'enable':'disable'}" data-plugin="${escape(plugin.name)}">${plugin.disabled?'Enable':'Disable'}</button>${plugin.disabled?'':`<button data-plugin-operation="reload" data-plugin="${escape(plugin.name)}">Reload</button>`}<button data-plugin-operation="remove" data-plugin="${escape(plugin.name)}">Remove</button></div></div>`).join('')||'<p class="muted">No plugins installed.</p>';
    $('#plugin-config-name').innerHTML='<option value="">Choose a configuration</option>'+modStatus.configs.map(file=>`<option value="${escape(file.name)}">${escape(file.name)}</option>`).join('');setBusy();
  }
  if(page==='access'){
    const result=await api('accounts');$('#accounts').innerHTML=result.users.map(user=>`<div class="row"><strong>${escape(user.username)}</strong><span class="muted">${escape(user.role==='admin'?'Administrator':'Read-only')}</span></div>`).join('');
  }
}
function openPage(value){page=value;all('[data-view]').forEach(element=>element.hidden=element.dataset.view!==page);all('[data-page]').forEach(button=>{if(button.dataset.page===page)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});$('#page-title').textContent=page==='mods'?'Mods & plugins':page[0].toUpperCase()+page.slice(1);void guarded(loadPage);}
function signedIn(value){$('#session-loading').hidden=true;session=value;$('#auth').hidden=true;$('#shell').hidden=false;$('#account').textContent=value.username+' · '+(value.role==='admin'?'Administrator':'Read-only');all('[data-admin]').forEach(element=>element.hidden=value.role!=='admin');openPage('overview');void refresh();}
if(registration){$('#auth-title').textContent='Create your Rust account';$('#auth-help').textContent='Choose a username and a password of at least 12 characters.';$('#login button').textContent='Create account';$('#login [name=password]').minLength=12;$('#login [name=password]').autocomplete='new-password';}
$('#login').addEventListener('submit',async event=>{event.preventDefault();const button=$('#login button');button.disabled=true;try{const data=Object.fromEntries(new FormData(event.target));signedIn(await api(registration?'register':'login',registration?{...data,token:registration}:data));}catch(error){$('#auth-error').textContent=error.message;}finally{button.disabled=false;}});
all('[data-page]').forEach(button=>button.addEventListener('click',()=>openPage(button.dataset.page)));
all('[data-action]').forEach(button=>button.addEventListener('click',()=>guarded(()=>job(button.dataset.action))));
$('#backup').addEventListener('click',()=>guarded(()=>job('backup')));
$('#backups').addEventListener('click',event=>{const name=event.target.closest('[data-verify]')?.dataset.verify;if(name)void guarded(()=>job('verify-backup',{name}));});
for(const id of ['players','logs'])$('#refresh-'+id).addEventListener('click',()=>guarded(loadPage));
$('#settings').addEventListener('submit',event=>{event.preventDefault();void guarded(async()=>{const values=Object.fromEntries(new FormData(event.target));for(const field of settings.fields)if(field.type==='number')values[field.key]=Number(values[field.key]);await job('save-settings',{values,revision:settings.revision});});});
$('#schedule').addEventListener('submit',event=>{event.preventDefault();void guarded(async()=>{const form=event.target,enabled=form.elements.enabled.checked;if(enabled&&!await confirm('Schedule Rust interruptions?','Each scheduled backup will save, stop and resume Rust. Connected players will be disconnected. Old scheduled archives beyond the count limit may be removed.'))return;await api('schedule',{enabled,hours:Number(form.elements.hours.value),keep:Number(form.elements.keep.value),confirmDowntime:enabled});message('Backup schedule saved.');});});
$('#invite').addEventListener('submit',event=>{event.preventDefault();void guarded(async()=>{const result=await api('invitations',{role:event.target.elements.role.value}),url=location.origin+'/#register='+result.token;$('#invitation').hidden=false;$('#invitation').textContent=`Private invitation (expires in 24 hours): ${url}`;});});
$('#password').addEventListener('submit',event=>{event.preventDefault();void guarded(async()=>{session=await api('password',Object.fromEntries(new FormData(event.target)));event.target.reset();message('Password changed. Other sessions were signed out.');});});
$('#refresh-mods').addEventListener('click',()=>guarded(loadPage));
$('#framework').addEventListener('submit',event=>{event.preventDefault();void guarded(async()=>{
  frameworkPlan=await api('mods-plan',{framework:event.target.elements.framework.value});
  const description=frameworkPlan.name+' '+frameworkPlan.version+(frameworkPlan.sha256?' · SHA-256 '+frameworkPlan.sha256:'')+'. '+frameworkPlan.message;
  if(await confirm('Install '+frameworkPlan.name+'?',description))await job('install-framework',{planId:frameworkPlan.id,confirm:true});
});});
$('#recover-framework').addEventListener('click',()=>guarded(async()=>{if(await confirm('Recover framework?','Restore the framework files from the interrupted installation. Rust stays stopped. Worlds and plugin data are preserved.'))await job('recover-framework',{confirm:true});}));
$('#plugin-upload').addEventListener('submit',event=>{event.preventDefault();void guarded(async()=>{
  const file=event.target.elements.plugin.files[0];if(!file||file.size>512*1024)throw Error('Choose a .cs plugin file of at most 512 KiB.');
  if(await confirm('Install '+file.name+'?','This installs server code. Use a plugin from an author you trust. Existing plugin source is kept in recovery history; configuration and data are preserved.'))await job('plugin',{operation:'install',name:file.name,source:await file.text(),confirm:true});
});});
$('#plugins').addEventListener('click',event=>{const button=event.target.closest('[data-plugin-operation]');if(!button)return;void guarded(async()=>{if(await confirm(button.textContent+' '+button.dataset.plugin+'?',button.dataset.pluginOperation==='reload'?'Reload this plugin on the running server.':'Change this plugin file. Its configuration and data are kept; changes apply at the next start.'))await job('plugin',{operation:button.dataset.pluginOperation,name:button.dataset.plugin,confirm:true});});});
$('#load-plugin-config').addEventListener('click',()=>guarded(async()=>{const name=$('#plugin-config-name').value;if(!name)throw Error('Choose a configuration first.');pluginConfig=await api('plugin-config?name='+encodeURIComponent(name));$('#plugin-config [name=source]').value=pluginConfig.source;}));
$('#plugin-config').addEventListener('submit',event=>{event.preventDefault();void guarded(async()=>{if(!pluginConfig||pluginConfig.name!==event.target.elements.name.value)throw Error('Load this configuration before saving.');await job('plugin-config',{name:pluginConfig.name,revision:pluginConfig.revision,source:event.target.elements.source.value});});});
$('#logout').addEventListener('click',()=>guarded(async()=>{await api('logout',{});session=null;location.reload();}));
if(registration){$('#session-loading').hidden=true;$('#auth').hidden=false;}
else try{signedIn(await api('session'));}catch{$('#session-loading').hidden=true;$('#auth').hidden=false;}
setInterval(()=>void refresh(),5000);
