import test from 'node:test';
import assert from 'node:assert/strict';
import {rootCertificates} from 'node:tls';
import {verifyUpdaterRuntime} from '../image-readiness.js';

test('installer verifies actual certificate parsing and all updater executables without a daemon or network',async()=>{
  const calls=[];
  const result=await verifyUpdaterRuntime({readFile:async file=>{assert.equal(file,'/etc/ssl/certs/ca-certificates.crt');return rootCertificates[0];},run:async(file,args,options)=>{calls.push([file,...args]);assert.equal(options.timeout,5000);return {stdout:'version fixture'};}});
  assert.equal(result.certificates,1);
  assert.deepEqual(calls,[['docker','--version'],['docker','compose','version'],['docker','buildx','version']]);
});

test('missing, empty or corrupted CA bundles stop setup checks before any executable is called',async()=>{
  for(const bundle of [null,'','not a certificate','-----BEGIN CERTIFICATE-----\ncorrupt\n-----END CERTIFICATE-----']){
    await assert.rejects(verifyUpdaterRuntime({readFile:async()=>{if(bundle===null)throw Error('missing');return bundle;},run:async()=>assert.fail('No commands after a broken CA bundle')}),/trusted certificate bundle.*Rebuild/);
  }
});

test('missing or failed Docker plugins produce an actionable bounded setup error',async()=>{
  for(const missing of ['--version','compose','buildx']){
    await assert.rejects(verifyUpdaterRuntime({readFile:async()=>rootCertificates[0],run:async(file,args)=>{if(args[0]===missing)throw Error('private error details');return {stdout:'version fixture'};}}),error=>{assert.match(error.message,/required for updates.*Rebuild/);assert.doesNotMatch(error.message,/private error/);return true;});
  }
});
