import test from 'node:test';
import assert from 'node:assert/strict';
import {rust} from '../applications/rust/index.js';
import {factorio} from '../applications/factorio/index.js';
import {validateApplicationModule} from '../core/application-module.js';
import {presentationScreens} from '../core/application-presentation.js';
import {publicContract} from '../core/game-contract.js';
import {fields,validateSettings} from '../applications/rust/settings.js';

test('Rust derives navigation and settings metadata from one declarative presentation',()=>{
  validateApplicationModule(rust);
  assert.deepEqual(rust.contract.screens,presentationScreens(rust.presentation));
  assert.equal(fields,rust.presentation.screens.find(screen=>screen.id==='settings').options.fields);
  assert.deepEqual(publicContract(rust).presentation,rust.presentation);
  validateSettings(Object.fromEntries(fields.map(field=>[field.key,field.default])));
});
test('Factorio registers shared screens, bounded action forms and permission-aware child sections',()=>{
  validateApplicationModule(factorio);assert.equal(factorio.presentation.screens.find(screen=>screen.id==='overview').component,'overview');
  const general=['overview','players','logs','settings','backups','accounts','mods'];assert.ok(general.every(id=>factorio.presentation.screens.find(screen=>screen.id===id).component!=='extension'));
  const changes=[p=>{p.screens.find(screen=>screen.id==='worlds').subroutes=['../../escape'];},p=>{p.onboarding.screen='players';},p=>{p.screens.find(screen=>screen.id==='settings').routes[1].permission='server.view';},p=>{p.screens.find(screen=>screen.id==='settings').routes[0].options.requiresStatus='yes';},p=>{p.screens.find(screen=>screen.id==='players').options.forms[0].action='unregistered';},p=>{p.screens.find(screen=>screen.id==='players').options.forms[0].fields[1].choices[0].value=()=>{};},p=>{p.screens.find(screen=>screen.id==='logs').options.forms[0].resultId='logs';}];
  for(const change of changes){const presentation=structuredClone(factorio.presentation);change(presentation);assert.throws(()=>validateApplicationModule({...factorio,presentation,contract:{...factorio.contract,screens:presentationScreens(presentation)}}));}
  assert.throws(()=>validateApplicationModule({...factorio,contract:{...factorio.contract,features:{...factorio.contract.features,mods:false}}}),/declared mod support/);
});
test('presentation registration rejects executable markup, unknown components, endpoints, fields and conflicting contracts',()=>{
  function changed(mutate){const presentation=structuredClone(rust.presentation);mutate(presentation);return {...rust,presentation,contract:{...rust.contract,screens:presentationScreens(presentation)}};}
  const settings=p=>p.screens.find(screen=>screen.id==='settings');
  const examples=[
    changed(p=>{p.version=99;}),
    changed(p=>{p.id='other';}),
    changed(p=>{p.screens.find(screen=>screen.id==='operations').adminOnly=false;}),
    changed(p=>{p.screens[0].component='custom-html';}),
    changed(p=>{p.screens[0].html='<h1>Injected</h1>';}),
    changed(p=>{p.screens[0].options.import='/unreviewed.js';}),
    changed(p=>{p.screens[0].options.fields[0].key='constructor.prototype';}),
    changed(p=>{p.screens[0].options.fields[0].id='server-name';}),
    changed(p=>{settings(p).options.source='/accounts';}),
    changed(p=>{settings(p).options.action='start';}),
    changed(p=>{settings(p).options.fields[0].onchange=()=>{};}),
    changed(p=>{settings(p).options.fields.push({...settings(p).options.fields[0]});}),
    changed(p=>{settings(p).options.fields[0].type='password';settings(p).options.fields[0].default='public-secret';}),
    changed(p=>{p.screens[0].actions.push('unregistered');}),
    changed(p=>{p.confirmations.backup.title='';}),
    changed(p=>{p.screens.find(screen=>screen.component==='extension').options.provider='unreviewed.plugin';}),
    changed(p=>{settings(p).options.fields.find(field=>field.type==='number').default=999999;}),
    {...rust,contract:{...rust.contract,screens:rust.contract.screens.slice(1)}},
  ];
  for(const module of examples)assert.throws(()=>validateApplicationModule(module));
});
