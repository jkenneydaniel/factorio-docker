const clone=value=>JSON.parse(JSON.stringify(value));
let cleanup=()=>{};
export function cleanWorldPreview(){cleanup();cleanup=()=>{};}
export const previewHTML=`<aside class="world-draft-preview"><div class="world-preview-heading"><h3>Map preview</h3><button type="button" class="button small" id="refresh-draft-preview">Refresh now</button></div><label class="check-label"><input type="checkbox" id="auto-draft-preview" checked>Update as I change settings</label><p id="draft-preview-state" class="hint" role="status">Preparing your preview…</p><div class="draft-preview-picture"><img id="draft-preview-image" alt="Map preview for your new world settings" hidden><p id="draft-preview-empty">Your map preview will appear here.</p></div><p class="hint">Shows terrain, resources, and enemy bases. Research, evolution, and pollution rules do not change this image. Rendering can take a few seconds.</p></aside>`;
export function mountWorldPreview(form,{api,getDraft,isValid}){
  cleanWorldPreview();let timer=null,poll=null,stopped=false,version=0,controller=null,lastId=null;
  const automatic=form.querySelector('#auto-draft-preview'),label=form.querySelector('#draft-preview-state'),image=form.querySelector('#draft-preview-image'),empty=form.querySelector('#draft-preview-empty'),outer=form.closest('details');
  function text(value){label.textContent=value;}
  function stale(){image.classList.add('preview-stale');}
  function cancel(){clearTimeout(timer);clearTimeout(poll);controller?.abort();version++;}
  function seed(){const input=form.elements.seed;if(input.value===''){const values=new Uint32Array(1);do{crypto.getRandomValues(values);}while(values[0]===0);input.value=String(values[0]);getDraft().seed=input.value;}return Number(input.value);}
  function valid(){return isValid()&&(!form.elements.seed.value||form.elements.seed.validity.valid)&&!form.querySelector('[data-world-setting]:invalid');}
  function paint(result,current){
    if(stopped||current!==version)return;
    if(result.state==='ready'){
      lastId=result.id;const expected='/api/world-preview-image?id='+encodeURIComponent(result.id);
      const loaded=()=>{if(current!==version)return;image.hidden=false;empty.hidden=true;image.classList.remove('preview-stale');text('Up to date · Seed '+result.seed);};
      image.onload=loaded;image.onerror=()=>{if(current!==version)return;stale();text('Preview expired or could not load. Choose Refresh now to retry.');};
      if(image.getAttribute('src')===expected&&image.complete&&image.naturalWidth>0)loaded();else image.src=expected;
      return;
    }
    if(result.state==='error'){stale();text(result.error||'Preview could not be generated. Change a setting or refresh to retry.');return;}
    text(result.state==='rendering'?'Rendering your latest settings…':'Preview queued while another operation finishes…');
    poll=setTimeout(async()=>{try{const next=await api('/world-preview',{signal:controller.signal});if(next.id!==result.id){if(current===version)text('A newer preview was requested in another tab. Refresh to show this draft.');return;}paint(next,current);}catch(error){if(!stopped&&current===version&&error.name!=='AbortError')text(error.message);}},900);
  }
  async function request(){
    if(stopped||!outer?.open||document.hidden)return;
    if(!valid()){stale();text('Fix the highlighted settings or apply your advanced edits to update the preview.');return;}
    const chosenSeed=seed(),current=version;controller=new AbortController();stale();text('Requesting preview…');
    try{const result=await api('/world-preview',{method:'POST',body:{configuration:clone(getDraft().configuration),seed:chosenSeed},signal:controller.signal});paint(result,current);}
    catch(error){if(!stopped&&current===version&&error.name!=='AbortError')text(error.message);}
  }
  function schedule(force=false){
    cancel();stale();if(!outer?.open)return;
    if(!automatic.checked&&!force){text('Automatic preview paused. Choose Refresh now to update.');return;}
    if(!valid()){text('Fix the highlighted settings or apply your advanced edits to update the preview.');return;}
    text('Settings changed · updating preview shortly…');timer=setTimeout(request,force?0:900);
  }
  const input=event=>{if(event.target===automatic)return;if(event.target.name==='name'||['preview','activate'].includes(event.target.name))return;schedule();};
  const toggle=()=>{if(outer.open)schedule();else cancel();};
  const visibility=()=>{if(document.hidden)cancel();else if(outer.open&&automatic.checked)schedule();};
  form.addEventListener('input',input);form.addEventListener('change',input);outer?.addEventListener('toggle',toggle);document.addEventListener('visibilitychange',visibility);
  form.querySelector('#refresh-draft-preview').addEventListener('click',()=>schedule(true));automatic.addEventListener('change',()=>schedule());
  image.addEventListener('click',()=>{if(lastId&&!image.classList.contains('preview-stale')){const dialog=document.querySelector('#preview-dialog'),target=document.querySelector('#preview-image');target.src=image.src;dialog.showModal();}});
  cleanup=()=>{stopped=true;cancel();form.removeEventListener('input',input);form.removeEventListener('change',input);outer?.removeEventListener('toggle',toggle);document.removeEventListener('visibilitychange',visibility);};
  schedule();return ()=>schedule();
}
