// Historical identifiers remain readable so existing installations and published
// Factorio images can upgrade without renaming their data, containers or images.
export const legacySlug='factory-control';
export const releasePrefixes=version=>['lobby-goblin-'+version,legacySlug+'-'+version];
export const canonicalRepository=value=>value==='jkenneydaniel/factorio-docker'?'jkenneydaniel/lobby-goblin':value;
export const imageLabel=(labels,key)=>labels['io.lobby-goblin.'+key]??labels['io.'+legacySlug+'.'+key];
