import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationRoutes,resolveApplicationRoute} from '../public/application/definition.js';

const presentation={screens:[{id:'overview'},{id:'settings',permissionsAny:['settings.read','images.change'],contentPermission:'settings.read',routes:[{id:'updates',permission:'images.change'},{id:'diagnostics',adminOnly:true}]},{id:'worlds',subroutes:['create','import','created']},{id:'accounts'}]};
test('application routing keeps one controller for declared extension stages and rejects unknown paths',()=>{
  assert.deepEqual(applicationRoutes(presentation).map(route=>route.id),['overview','settings','settings/updates','settings/diagnostics','worlds','accounts']);
  const route=resolveApplicationRoute(presentation,'#worlds/create',()=>true);assert.equal(route.id,'worlds');assert.equal(route.path,'worlds/create');
  assert.equal(resolveApplicationRoute(presentation,'#worlds/unknown',()=>true).id,'overview');
});
test('application routing resolves delegated section links without granting their general content or admin tools',()=>{
  const allowed=(screen,content)=>!screen.adminOnly&&(!content||!screen.contentPermission)&&screen.permission!=='settings.read';
  assert.equal(resolveApplicationRoute(presentation,'#settings',allowed).id,'settings/updates');
  assert.equal(resolveApplicationRoute(presentation,'#settings/diagnostics',allowed).id,'overview');
  assert.equal(resolveApplicationRoute(presentation,'#settings/updates',()=>false),null);
});
