/** @typedef {'game'|'application'|'service'} ApplicationKind */
/** @typedef {'overview'|'resource'|'table'|'logs'|'settings'|'backups'|'accounts'|'mod-library'|'diagnostics'|'operations'|'extension'} Component */
/**
 * @typedef {{id:string,label:string,component:Component,permission?:string,permissionsAny?:string[],adminOnly?:boolean,ownerOnly?:boolean,feature?:string,actions?:string[],contentPermission?:string,subroutes?:string[],routes?:ApplicationScreen[],options?:Record<string,unknown>}} ApplicationScreen
 */
/**
 * @typedef {{version:1,id:string,revision:number,kind:ApplicationKind,screens:ApplicationScreen[],confirmations?:Record<string,{title:string,message:string}>,onboarding?:{screen:string,resumeLabel:string}}} ApplicationPresentation
 */
/** @typedef {{id:string,parent:ApplicationScreen,screen:ApplicationScreen}} ApplicationRoute */
/** @typedef {ApplicationRoute & {path:string}} ResolvedApplicationRoute */
/** @typedef {'always'|'ready'|'running'|'stopped'} Availability */
/** @typedef {string|number|boolean} FormValue */
/**
 * @typedef {{key:string,label:string,type:'text'|'textarea'|'number'|'boolean'|'password'|'select',min?:number,max?:number,required?:boolean,placeholder?:string,choices?:{label:string,value:string}[]}} FieldDescriptor
 */
/**
 * @typedef {{id:string,heading:string,description?:string,action:string,fields:FieldDescriptor[],submitLabel:string,resultId?:string,confirmation?:{title:string,message:string},availability?:Availability}} ActionFormDescriptor
 */
/**
 * @typedef {{clone(name:string):DocumentFragment,canAction(action:string):boolean,busy():boolean,getStatus():{ready?:boolean,running?:boolean}|null,startJob(action:string,params:Record<string,FormValue>,options:{wait:true}):Promise<import('../shared/contracts.js').OperationJob|undefined>,drafts:Map<string,Record<string,FormValue>>}} ActionFormContext
 */
export {};
