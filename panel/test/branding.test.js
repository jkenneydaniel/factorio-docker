import test from 'node:test';
import assert from 'node:assert/strict';
import {makeZip} from '../core/archive.js';
import {sha256,unpackRelease} from '../update-source.js';
import {ReleaseChecks} from '../updates.js';
import {legacySlug,imageLabel} from '../branding.js';
import {validateGameImage} from '../applications/factorio/update-worker.js';

test('historical release bundles and configured repository upgrade without renaming installation state',async()=>{
  const version='0.2.7-alpha',name=legacySlug+'-'+version;
  const files={'compose.yaml':'services: {}','panel/package.json':JSON.stringify({version}),'panel/Dockerfile':'FROM scratch','panel/server.js':'','panel/update-worker.js':''};
  const archive=makeZip(Object.entries(files).map(([file,text])=>({name:name+'/'+file,data:Buffer.from(text)})));
  assert.equal(unpackRelease(archive,sha256(archive)+'  '+name+'.zip',version,{format:1,version,updater:1,stateVersion:1,rollbackSafe:true}).size,5);
  let requested;
  const checks=new ReleaseChecks({current:'0.2.6-alpha',repository:'jkenneydaniel/factorio-docker',fetcher:async url=>{requested=url;return Response.json([]);}});
  await checks.check();assert.equal(requested,'https://api.github.com/repos/jkenneydaniel/lobby-goblin/releases?per_page=100');
});

test('historical Factorio image labels remain compatible and current labels take priority',()=>{
  const labels={'factorio.version':'2.0.77',['io.'+legacySlug+'.compatibility']:'1',['io.'+legacySlug+'.image-revision']:'2'};
  const item={Os:'linux',Architecture:'amd64',Id:'sha256:'+'a'.repeat(64),Config:{Labels:labels,Entrypoint:['/docker-entrypoint.sh'],Volumes:{'/factorio':{}},ExposedPorts:{'34197/udp':{},'27015/tcp':{}},Env:['PUID=845','PGID=845','SAVES=/factorio/saves','CONFIG=/factorio/config','MODS=/factorio/mods','SCENARIOS=/factorio/scenarios','SCRIPTOUTPUT=/factorio/script-output','PORT=34197','RCON_PORT=27015']}};
  assert.equal(validateGameImage(item,{source:'factory',target:'2.0.77',imageRevision:2}),'ghcr.io/jkenneydaniel/factorio-server');
  labels['io.lobby-goblin.compatibility']='2';assert.equal(imageLabel(labels,'compatibility'),'2');assert.throws(()=>validateGameImage(item,{source:'factory',target:'2.0.77',imageRevision:2}),/compatibility/);
});
