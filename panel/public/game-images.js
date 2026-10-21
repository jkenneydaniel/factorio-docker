// Shared by the review UI and installer. Only the first-party source is supported.
export const gameSources=Object.freeze({factory:{name:'Lobby Goblin',repository:'ghcr.io/jkenneydaniel/factorio-server'}});
const supported=value=>typeof value==='string'&&/^2\.0\.(0|[1-9]\d*)$/.test(value)&&Number.isSafeInteger(Number(value.split('.')[2]));
function requireValue(value,message){if(!value)throw Object.assign(Error(message),{status:400});}
export function parseGameImage(value){
 if(typeof value!=='string')return null;
 const prefix=gameSources.factory.repository+':';if(!value.startsWith(prefix))return null;
 const match=value.slice(prefix.length).match(/^(2\.0\.(?:0|[1-9]\d*))-fc\.([1-9]\d*)(?:@sha256:[a-f0-9]{64})?$/);
 if(!match||!supported(match[1])||!Number.isSafeInteger(Number(match[2])))return null;
 return {source:'factory',version:match[1],revision:Number(match[2]),reference:value};
}
export function gameUpdate(currentImage,input){
 const current=parseGameImage(currentImage);
 requireValue(current,'Game updates require a pinned Lobby Goblin 2.0.x image. Legacy images must migrate first.');
 requireValue(supported(input.target),'Choose an exact supported Factorio 2.0.x version.');
 requireValue(input.source==null||input.source==='factory','Only Lobby Goblin images are supported.');
 const revision=input.imageRevision??current.revision;
 requireValue(Number.isSafeInteger(revision)&&revision>=1,'Choose a positive whole-number image revision.');
 const change=Number(input.target.split('.')[2])-Number(current.version.split('.')[2]);
 requireValue(change>=0,'Choose the same or a newer game version. Downgrades require a separate save recovery.');
 requireValue(change>0||revision>current.revision,'Choose a newer game version or a newer image revision.');
 return {target:input.target,source:'factory',imageRevision:revision,targetImage:gameSources.factory.repository+':'+input.target+'-fc.'+revision,operation:change>0?'upgrade':'image-change'};
}
