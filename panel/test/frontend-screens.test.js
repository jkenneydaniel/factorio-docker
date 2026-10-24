import test from 'node:test';
import assert from 'node:assert/strict';
import {createScreenRouter} from '../public/shared/screens.js';

const deferred = () => {let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const tick = () => new Promise(resolve=>setImmediate(resolve));
function fixture(factories,options={}) {
  const element={innerHTML:''},errors=[];
  const router=createScreenRouter({factories,root:()=>element,request:async()=>({}),onError:error=>errors.push(error),...options});
  return {router,element,errors};
}
test('screen navigation aborts old requests and drops late responses even when transport ignores cancellation',async()=>{
  const response=deferred();let oldSignal,disposed=0;
  const {router,element,errors}=fixture({
    slow:()=>({async mount(ctx){oldSignal=ctx.signal;const value=await ctx.request('/slow');ctx.render(value);},dispose(){disposed++;}}),
    next:()=>({mount(ctx){ctx.render('Next screen');}}),
  },{request:()=>response.promise});
  const pending=router.open('slow');await tick();await router.open('next');response.resolve('Late old response');await pending;
  assert.equal(oldSignal.aborted,true);assert.equal(disposed,1);assert.equal(element.innerHTML,'Next screen');assert.deepEqual(errors,[]);
});
test('a screen owns synchronous event prevention and listeners are replaced on render and removed on leave',async()=>{
  const target=new EventTarget();let handled=0,context;
  const {router}=fixture({one:()=>({mount(ctx){context=ctx;ctx.render('One');ctx.on(target,'submit',event=>{event.preventDefault();handled++;});}}),two:()=>({mount(){}})});
  await router.open('one');const event=new Event('submit',{cancelable:true});target.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(handled,1);
  context.render('Replacement');target.dispatchEvent(new Event('submit'));assert.equal(handled,1);
  context.on(target,'submit',()=>{handled++;});await router.open('two');target.dispatchEvent(new Event('submit'));assert.equal(handled,1);
});
test('navigation preserves a screen that refuses to leave and retains controller-local drafts until session reset',async()=>{
  let dirty=true,factories=0,draft;
  const {router}=fixture({
    editor:()=>{factories++;draft={text:'Unsaved seed'};return {mount(){},beforeLeave:()=>!dirty};},
    next:()=>({mount(){}}),
  });
  await router.open('editor');assert.equal(await router.open('next'),false);assert.equal(router.current,'editor');assert.equal(draft.text,'Unsaved seed');
  dirty=false;await router.open('next');await router.open('editor');assert.equal(factories,1);
  router.reset();await router.open('editor');assert.equal(factories,2);
});
test('pending confirmation cannot authorize an effect after navigation or session loss',async()=>{
  const decision=deferred();let context;
  const {router}=fixture({one:()=>({mount(ctx){context=ctx;}}),two:()=>({mount(){}})},{confirm:()=>decision.promise});
  await router.open('one');const pending=context.confirm('Apply?','Reviewed action');await router.open('two');decision.resolve(true);assert.equal(await pending,false);
  await assert.rejects(context.request('/mutation',{method:'POST',body:{}}),error=>error.name==='AbortError');
});
test('concurrent refresh calls share one screen refresh and completion cannot outlive reset',async()=>{
  const ready=deferred();let refreshes=0,context,disposed=0;
  const {router,element}=fixture({one:()=>({mount(ctx){context=ctx;ctx.render('Ready');ctx.onDispose(()=>disposed++);},async refresh(ctx){refreshes++;await ready.promise;ctx.render('Refreshed');}})});
  await router.open('one');const first=router.refresh(),second=router.refresh();await tick();assert.equal(refreshes,1);router.reset();ready.resolve();await Promise.all([first,second]);
  assert.equal(element.innerHTML,'Ready');assert.equal(context.signal.aborted,true);assert.equal(disposed,1);
});
test('operation completion queues a data reload after an in-flight status refresh',async()=>{
  const ready=deferred(),reasons=[];
  const {router}=fixture({one:()=>({mount(){},async refresh(_ctx,options){reasons.push(options.reason);if(options.reason==='status')await ready.promise;}})});
  await router.open('one');const status=router.refresh({reason:'status'});await tick();
  const completion=router.refresh({reason:'operation'});ready.resolve();await Promise.all([status,completion]);
  assert.deepEqual(reasons,['status','operation']);
});
test('a subroute change cancels an older load while keeping the screen-owned controller',async()=>{
  const delayed=deferred();let created=0;
  const {router,element}=fixture({settings:()=>{created++;return {async mount(ctx,options){if(options.route==='old')await ctx.request('/old');ctx.render(options.route);}};}},{request:()=>delayed.promise});
  const previous=router.open('settings',{route:'old'});await tick();await router.open('settings',{route:'new'});delayed.resolve({});await previous;
  assert.equal(element.innerHTML,'new');assert.equal(created,1);
});
test('retry after failed shared preparation mounts the screen rather than calling an uninitialized refresh',async()=>{
  let fail=true,mounts=0,refreshes=0;
  const {router,errors}=fixture({one:()=>({mount(){mounts++;},refresh(){refreshes++;}})},{prepare:async()=>{if(fail)throw Error('Temporarily unavailable');}});
  await router.open('one');assert.equal(mounts,0);assert.equal(errors.length,1);
  fail=false;await router.refresh({reason:'reload'});assert.equal(mounts,1);assert.equal(refreshes,0);
  await router.refresh({reason:'status'});assert.equal(refreshes,1);
});
