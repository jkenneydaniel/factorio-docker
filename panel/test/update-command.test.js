import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {command,commandFailure} from '../update-worker.js';

function processFixture(run){
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  let killed=0;
  child.kill=()=>{killed++;queueMicrotask(()=>child.emit('close',null,'SIGKILL'));};
  const spawnProcess=(name,args,options)=>{assert.equal(name,'docker');queueMicrotask(()=>run(child,args,options));return child;};
  return {spawnProcess,killed:()=>killed};
}

test('Docker commands retain successful machine-readable output and use a private client configuration',async()=>{
  const f=processFixture((child,args,options)=>{
    assert.deepEqual(args,['inspect','fixture']);
    assert.equal(options.env.DOCKER_HOST,'unix:///var/run/docker.sock');
    assert.equal(options.env.DOCKER_CONFIG,'/tmp/lobby-goblin-docker');
    child.stdout.write('[{"Image":"fixture"}]');child.emit('close',0,null);
  });
  assert.equal(await command(['inspect','fixture'],f),'[{"Image":"fixture"}]');
});

test('TLS build failures retain a bounded, readable diagnostic with credentials removed',async()=>{
  const f=processFixture(child=>{
    child.stderr.write('\u001b[31mfailed to fetch anonymous token: x509: certificate signed by unknown authority\u001b[0m\nAuthorization: Bearer private-auth\npassword=private-password\nhttps://user:private-url@example.test/path?token=private-query\nrcon-password private-rcon\n');
    child.emit('close',1,null);
  });
  await assert.rejects(command(['build','--tag','fixture'],f),error=>{
    assert.match(error.message,/CA certificate bundle/);assert.equal(error.diagnostic.exitCode,1);
    assert.match(error.diagnostic.output,/certificate signed by unknown authority/);
    assert.doesNotMatch(error.diagnostic.output,/private-|\u001b/);return true;
  });
  const error=commandFailure(['build'],{output:'x'.repeat(20000),code:1});assert.equal(error.diagnostic.output.length,8192);
});

test('timeouts kill Docker commands and record the reason',async()=>{
  const f=processFixture(()=>{});
  await assert.rejects(command(['build'],{...f,timeout:5}),error=>{assert.equal(error.diagnostic.timedOut,true);assert.match(error.message,/timed out/);return true;});
  assert.equal(f.killed(),1);
});

test('excessive build output is bounded and terminates the child once',async()=>{
  const f=processFixture(child=>{child.stderr.write(Buffer.alloc(8*1024*1024+1,120));});
  await assert.rejects(command(['build'],f),error=>{assert.equal(error.diagnostic.outputLimit,true);assert.ok(error.diagnostic.output.length<=8192);return true;});
  assert.equal(f.killed(),1);
});

test('failure to launch Docker is recorded without exposing arbitrary exception text',async()=>{
  const f=processFixture(child=>{const error=new Error('private-error');error.code='ENOENT';child.emit('error',error);});
  await assert.rejects(command(['compose','config'],f),error=>{assert.equal(error.diagnostic.operation,'Docker Compose');assert.equal(error.diagnostic.output,'ENOENT');assert.doesNotMatch(error.message,/private-error/);return true;});
});
