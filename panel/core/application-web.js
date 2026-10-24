import {Accounts} from './accounts.js';
import {assert} from '../common.js';

export const applicationAssets={
  '/':['application/index.html','text/html; charset=utf-8'],
  '/app.js':['application-entry.js','text/javascript; charset=utf-8'],
  '/style.css':['application/style.css','text/css; charset=utf-8'],
};
export function applicationWeb(id,contract){
  return {Accounts,sessionCookie:id.replaceAll('-','_')+'_session',accountRoutes:[],
    assets:{},
    adminReadRoutes:Object.entries(contract.routes).filter(([route,methods])=>methods.GET==='admin'&&route!=='/download').map(([route])=>route),
    diagnosticsReport:(version,controller)=>({version,controller}),
    validateOnboarding:value=>assert(value.ready,'Wait for the application to become ready.',409),
  };
}
