import {Accounts} from './accounts.js';
import {requireAdmin} from '../../auth.js';
import {assert,json,requestJSON,HttpError} from '../../common.js';
import {diagnosticsReport} from '../../diagnostics.js';

export const web={
  Accounts,sessionCookie:'factorio_session',
  accountExtensions:(accounts,scope)=>({worldSetups:(username,body)=>Accounts.prototype.worldSetups.call(accounts,username,body,scope)}),
  deleteAccountData:(accounts,user)=>Accounts.prototype.onDelete.call(accounts,user),
  accountRoutes:['/api/world-setups'],
  adminReadRoutes:['/mod-library','/world-options','/world-preview','/world-preview-image'],
  assets:{'/mod-library.js':['mod-library.js','text/javascript; charset=utf-8'],'/mod-library.css':['mod-library.css','text/css; charset=utf-8'],'/scope.js':['scope.js','text/javascript; charset=utf-8'],'/game-images.js':['game-images.js','text/javascript'],'/game-update.js':['game-update.js','text/javascript'],'/backup-retention.js':['backup-retention.js','text/javascript'],'/diagnostics.js':['diagnostics.js','text/javascript'], '/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/map.js':['map.js','text/javascript; charset=utf-8'],'/world-fields.js':['world-fields.js','text/javascript; charset=utf-8'],'/world-preview.js':['world-preview.js','text/javascript; charset=utf-8'],'/world-editor.js':['world-editor.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/icons.js':['icons.js','text/javascript; charset=utf-8'],'/onboarding.js':['onboarding.js','text/javascript; charset=utf-8']},
  diagnosticsReport,
  bodyLimit:route=>route==='/upload'?128*1024*1024:1024*1024,
  validateOnboarding(value){assert(value.ready&&value.currentWorld&&value.saveVerified&&!value.activeJob,'Wait for a ready game and a confirmed completed save before finishing setup.',409);},
  async handleAccount(req,res,url,{user,accounts,requireNoUpdate}){
        requireAdmin(user);assert(['GET','POST'].includes(req.method),'Not found.',404);
        if(req.method==='POST')await requireNoUpdate();
        const body=req.method==='POST'?await requestJSON(req):undefined;
        try{return json(res,200,await accounts.worldSetups(user.username,body));}
        catch(error){if(error.status)throw error;throw new HttpError(503,'Saved setups could not be accessed. Check the panel account storage permissions on the host, then try again.');}
  },
};
