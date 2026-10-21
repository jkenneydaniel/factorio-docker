import {gameSources,parseGameImage,gameUpdate} from './game-images.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function gameUpdateForm(image,disabled=''){
  const current=parseGameImage(image),blocked=disabled||(!current?'disabled':'');
  return `<p class="hint">Current image: <code>${esc(image||'Unavailable')}</code></p>${!current?'<p class="warning">This image needs a reviewed host upgrade. In-panel changes support Lobby Goblin 2.0.x images.</p>':''}<form id="game-update-form"><div class="form-grid"><label>Image source<select name="source" aria-label="Image source" ${blocked}>${Object.entries(gameSources).map(([key,source])=>`<option value="${key}" ${key===current?.source?'selected':''}>${source.name}</option>`).join('')}</select></label><label>Factorio version<input name="version" value="${esc(current?.version)}" placeholder="2.0.x" pattern="2\\.0\\.[0-9]+" required ${blocked}></label><label id="image-revision-field" ${current?.source==='factory'?'':'hidden'}>Image revision<input name="imageRevision" type="number" min="1" max="9007199254740991" step="1" value="${current?.revision||1}" required ${blocked}></label></div><p class="form-note" id="game-image-choice" role="status"></p><button class="button" ${blocked}>Review image change</button></form><p class="hint">Keep the Factorio version unchanged to update the image revision. Lobby Goblin tags use an image revision, starting at 1. The exact tag must be published first. Saves, settings, mods and ports are preserved; players disconnect during replacement.</p>`;
}
export function bindGameUpdate(image,review,notify){
  const form=document.querySelector('#game-update-form');if(!form)return;
  const source=form.elements.source,revision=form.elements.imageRevision;
  const update=()=>{
    const owned=source.value==='factory';document.querySelector('#image-revision-field').hidden=!owned;revision.disabled=source.disabled||!owned;
    document.querySelector('#game-image-choice').textContent=owned?'Lobby Goblin is built directly from Debian and the official Factorio download.':'Lobby Goblin is the supported image source.';
  };
  source.addEventListener('change',update);update();
  form.addEventListener('submit',event=>{
    event.preventDefault();try{
      const selection=gameUpdate(image,{target:form.elements.version.value,source:source.value,...(source.value==='factory'?{imageRevision:Number(revision.value)}:{})});
      review('game',selection.target,{source:selection.source,imageRevision:selection.imageRevision});
    }catch(error){notify(error.message,true);}
  });
}
