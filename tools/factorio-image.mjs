import {imageLabel} from '../panel/branding.js';
import {sourceFile} from '../panel/source-layout.js';
// Explicit build/acceptance tooling. Never targets the installation's containers,
// bind mounts, Compose project, data directory or Docker socket configuration.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {parseGameImage,gameSources} from '../panel/applications/factorio/public/game-images.js';
import {compatibleGameImage,validateGameImage,inspectGameImage,gameImageProbe,reportsGameVersion} from '../panel/applications/factorio/update-worker.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const exec=promisify(execFile);
export async function imageDefinition(directory=root){
  const definition=JSON.parse(await fs.readFile(await sourceFile(directory,'factorio-image/image.json'),'utf8'));
  const image=definition.repository+':'+definition.version+'-fc.'+definition.revision;
  assert.equal(definition.format,1);assert.equal(definition.compatibility,1);assert.equal(definition.platform,'linux/amd64');
  assert.equal(definition.repository,gameSources.factory.repository);
  assert.equal(parseGameImage(image)?.source,'factory','Unsupported image version or revision');
  assert.match(definition.baseImage,/^debian:bookworm-slim@sha256:[a-f0-9]{64}$/);
  assert.match(definition.headlessSha256,/^[a-f0-9]{64}$/);
  const dockerfile=await fs.readFile(await sourceFile(directory,'factorio-image/Dockerfile'),'utf8');
  for(const line of ['ARG BASE_IMAGE='+definition.baseImage,'ARG FACTORIO_VERSION='+definition.version,'ARG IMAGE_REVISION='+definition.revision,'ARG HEADLESS_SHA256='+definition.headlessSha256])assert.ok(dockerfile.split('\n').includes(line),'Dockerfile and image.json disagree: '+line.split('=')[0]);
  return {...definition,image};
}
const docker=async args=>(await exec('docker',args,{maxBuffer:4*1024*1024,timeout:15*60000})).stdout;
export async function buildImage(definition,run=docker){
  const context=path.dirname(await sourceFile(root,'factorio-image/Dockerfile'));
  await run(['buildx','build','--load','--platform',definition.platform,'--tag',definition.image,context]);
}
export async function testImage(definition,run=docker){
  // Test input only, never a build/runtime dependency of our image.
  const legacy='factoriotools/factorio:'+definition.version;
  await run(['pull','--platform',definition.platform,legacy]);
  const inspect=image=>inspectGameImage(image,run);
  const base=await inspect(legacy),owned=await inspect(definition.image);
  assert.equal(owned.Architecture,'amd64');assert.equal(owned.Os,'linux');
  for(const key of ['Entrypoint','Cmd','User','Volumes','ExposedPorts','WorkingDir'])assert.deepEqual(owned.Config[key]||null,base.Config[key]||null,'Changed compatibility '+key);
  for(const key of ['SAVES','CONFIG','MODS','SCENARIOS','SCRIPTOUTPUT','PUID','PGID','PORT','RCON_PORT'])assert.equal(owned.Config.Env.find(v=>v.startsWith(key+'=')),base.Config.Env.find(v=>v.startsWith(key+'=')),'Changed compatibility '+key);
  assert.equal(owned.Config.Labels['factorio.version'],definition.version);
  assert.equal(imageLabel(owned.Config.Labels,'compatibility'),'1');
  assert.equal(imageLabel(owned.Config.Labels,'image-revision'),String(definition.revision));
  // Exercise the same disposable preflight the panel uses, including digest
  // references: platform-specific inspect IDs are not runnable on every engine.
  for(const [image,item] of [[definition.image,owned]]){
    const parsed=parseGameImage(image),selection={target:parsed.version,source:parsed.source,imageRevision:parsed.revision,targetImage:image};
    validateGameImage(item,selection);
    // A just-built image has no registry digest in classic Docker stores.
    // Only this unpublished local build may use its immutable local image ID;
    // the panel always requires a registry digest before installing an image.
    const probeImage=parsed.source==='factory'&&!item.RepoDigests?.length?item.Id:compatibleGameImage(item,selection);
    const output=await run(gameImageProbe(probeImage));
    assert.ok(reportsGameVersion(output,definition.version),'Panel image preflight did not report the expected version');
  }
  const id='fc-image-test-'+crypto.randomUUID(),volume=id+'-data',name=id+'-server';
  const container=['--platform',definition.platform,'--network','none','--mount','type=volume,source='+volume+',target=/factorio'];
  let created=false,started=false;
  try{
    await run(['volume','create',volume]);created=true;
    // Only a new disposable volume is used. Create the save with the old image.
    await run(['run','--rm',...container,'--entrypoint','/bin/bash',legacy,'-ec',`mkdir -p /factorio/{config,saves,mods,script-output}; cp /opt/factorio/data/server-settings.example.json /factorio/config/server-settings.json; jq '.name="Compatibility fixture" | .description="Disposable image acceptance" | .visibility={public:false,lan:false} | .require_user_verification=false' /factorio/config/server-settings.json > /factorio/config/settings.tmp; mv /factorio/config/settings.tmp /factorio/config/server-settings.json; printf 'fixture-rcon-only' > /factorio/config/rconpw; printf 'keep-settings' > /factorio/config/compatibility-marker; printf 'keep-mods' > /factorio/mods/compatibility-marker; printf '{"mods":[{"name":"base","enabled":true},{"name":"space-age","enabled":false},{"name":"quality","enabled":false},{"name":"elevated-rails","enabled":false}]}' > /factorio/mods/mod-list.json; /opt/factorio/bin/x64/factorio --create /factorio/saves/Compatibility.zip --mod-directory /factorio/mods; sha256sum /factorio/config/server-settings.json /factorio/config/rconpw /factorio/mods/mod-list.json > /factorio/config/compatibility.sha256; chown -R 845:845 /factorio`]);
    // A killed first-world publication may leave quarantined scratch output.
    // Make it newer than the real save and verify load-latest still ignores it.
    await run(['run','--rm',...container,'--entrypoint','/bin/bash',definition.image,'-ec','mkdir -p /factorio/config/.lobby-goblin-generation; cp /factorio/saves/Compatibility.zip /factorio/config/.lobby-goblin-generation/Competing.tmp.zip; touch -d "next hour" /factorio/config/.lobby-goblin-generation/Competing.tmp.zip; cp /factorio/saves/Compatibility.zip /factorio/saves/.lobby-goblin-killed.pending; touch -d "next hour" /factorio/saves/.lobby-goblin-killed.pending']);
    await run(['create','--name',name,...container,'-e','LOAD_LATEST_SAVE=true','-e','GENERATE_NEW_SAVE=false','-e','DLC_SPACE_AGE=false','-e','UPDATE_MODS_ON_START=false',definition.image]);started=true;
    await run(['start',name]);
    const deadline=Date.now()+120000;let ready=false;
    while(Date.now()<deadline){
      try{const output=await run(['exec',name,'rcon','/version']);assert.equal(output.trim(),definition.version);ready=true;break;}catch{await new Promise(resolve=>setTimeout(resolve,1000));}
    }
    assert.ok(ready,'Image did not load the existing fixture save and expose RCON');
    const startupLog=await run(['logs',name]);
    assert.match(startupLog,/Loading map \/factorio\/saves\/Compatibility\.zip/,'Load-latest must choose the established world');
    assert.doesNotMatch(startupLog,/Loading map[^\n]*\.lobby-goblin-generation/,'Quarantined generation output must never be selected');
    assert.doesNotMatch(startupLog,/Loading map[^\n]*\.pending/,'Interrupted copy staging must never be selected');
    const tickCommand=['exec',name,'rcon','/silent-command rcon.print(game.tick)'];
    // New saves require the same Lua command twice to acknowledge achievements.
    // This acknowledgement affects only the disposable acceptance save.
    let check=await run(tickCommand);if(!check.trim())check=await run(tickCommand);
    assert.match(check.trim(),/^\d+$/);
    await run(['exec',name,'rcon','/server-save Compatibility']);
    await run(['stop','--time','120',name]);
    const stopped=JSON.parse(await run(['inspect',name]))[0];assert.equal(stopped.State.ExitCode,0,'Graceful shutdown failed');
    const output=await run(['run','--rm',...container,'--entrypoint','/bin/bash',definition.image,'-ec',`test -s /factorio/saves/Compatibility.zip; test "$(cat /factorio/config/compatibility-marker)" = keep-settings; test "$(cat /factorio/mods/compatibility-marker)" = keep-mods; python3 -c 'import json; assert json.load(open("/factorio/config/server-settings.json"))["name"] == "Compatibility fixture"'; test "$(cat /factorio/config/rconpw)" = fixture-rcon-only; test "$(stat -c %u /factorio/saves/Compatibility.zip)" = 845; sha256sum -c /factorio/config/compatibility.sha256; echo compatible`]);
    assert.match(output,/compatible/);
    // Reload the save written by our image with the original binary as well.
    await run(['run','--rm',...container,'--entrypoint','/opt/factorio/bin/x64/factorio',legacy,'--benchmark','/factorio/saves/Compatibility.zip','--benchmark-ticks','1','--benchmark-runs','1','--mod-directory','/factorio/mods']);
    // Exercise the panel's direct-entrypoint creation and preview interfaces.
    const worker=['run','--rm',...container,'--user','845:845','--entrypoint','/opt/factorio/bin/x64/factorio',definition.image];
    await run([...worker,'--create','/factorio/saves/Worker-created.zip','--map-gen-settings','/factorio/config/map-gen-settings.json','--map-settings','/factorio/config/map-settings.json','--mod-directory','/factorio/mods']);
    await run([...worker,'--generate-map-preview','/factorio/compatibility-preview.png','--map-preview-size','128','--map-gen-settings','/factorio/config/map-gen-settings.json','--mod-directory','/factorio/mods']);
    await run(['run','--rm',...container,'--user','845:845','--entrypoint','python3',definition.image,'-c',`from pathlib import Path; import struct,zipfile; image=Path("/factorio/compatibility-preview.png").read_bytes(); assert image[:8] == bytes([137,80,78,71,13,10,26,10]), "Invalid PNG signature"; assert struct.unpack(">II",image[16:24]) == (128,128), "Unexpected preview size"; archive=zipfile.ZipFile("/factorio/saves/Worker-created.zip"); assert archive.testzip() is None, "Corrupt generated world ZIP"; assert any(name.endswith("/level.dat0") for name in archive.namelist()), archive.namelist(); print("Verified generated world ZIP and 128x128 PNG")`]);
  }finally{
    try{if(started)await run(['rm','-f',name]);}
    finally{if(created)await run(['volume','rm',volume]);}
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const definition=await imageDefinition(),action=process.argv[2];
  if(action==='describe')console.log(JSON.stringify(definition,null,2));
  else if(action==='build')await buildImage(definition);
  else if(action==='test')await testImage(definition);
  else throw new Error('Use describe, build or test. These tools do not deploy or publish images.');
}
