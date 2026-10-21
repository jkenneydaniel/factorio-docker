// Shared by the review UI and the installer. Repositories are deliberately fixed.
export const gameSources=Object.freeze({
  upstream:{name:'Factorio Tools',repository:'factoriotools/factorio'},
  factory:{name:'Lobby Goblin',repository:'ghcr.io/jkenneydaniel/factorio-server'}
});
const supported=value=>typeof value==='string'&&/^2\.0\.(0|[1-9]\d*)$/.test(value)&&Number.isSafeInteger(Number(value.split('.')[2]));
function requireValue(value,message){if(!value){const error=new Error(message);error.status=400;throw error;}}
export function parseGameImage(value){
  if(typeof value!=='string')return null;
  for(const [source,{repository}] of Object.entries(gameSources)){
    if(!value.startsWith(repository+':'))continue;
    const match=value.slice(repository.length+1).match(/^(2\.0\.(?:0|[1-9]\d*))(?:-fc\.([1-9]\d*))?(?:@sha256:[a-f0-9]{64})?$/);
    if(!match||!supported(match[1])||(source==='factory')!==!!match[2]||match[2]&&!Number.isSafeInteger(Number(match[2])))return null;
    return {source,version:match[1],revision:match[2]?Number(match[2]):null,reference:value};
  }
  return null;
}
export function gameUpdate(currentImage,input){
  const current=parseGameImage(currentImage);
  requireValue(current,'Game updates require a pinned, supported Factorio Tools or Lobby Goblin 2.0.x image.');
  requireValue(supported(input.target),'Choose an exact supported Factorio 2.0.x version.');
  const source=input.source??current.source;
  requireValue(Object.hasOwn(gameSources,source),'Choose Factorio Tools or Lobby Goblin as the image source.');
  const revision=source==='factory'?(input.imageRevision??(current.source==='factory'?current.revision:1)):null;
  requireValue(source!=='factory'||Number.isSafeInteger(revision)&&revision>=1,'Choose a positive whole-number image revision.');
  requireValue(source!=='upstream'||input.imageRevision==null,'Factorio Tools images do not have a Lobby Goblin revision.');
  const change=Number(input.target.split('.')[2])-Number(current.version.split('.')[2]);
  requireValue(change>=0,'Choose the same or a newer game version. Downgrades require a separate save recovery.');
  requireValue(change>0||source!==current.source||source==='factory'&&revision>current.revision,'Choose a newer game version, a different image source, or a newer image revision.');
  const targetImage=gameSources[source].repository+':'+input.target+(source==='factory'?'-fc.'+revision:'');
  return {target:input.target,source,imageRevision:revision,targetImage,operation:change>0?'upgrade':'image-change'};
}
