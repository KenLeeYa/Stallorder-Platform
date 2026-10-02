import type {MobileSession, MobileBootstrapResponse} from "@stallorder/contracts/mobile/v1";
export class RetiredSession extends Error { constructor(){super("登入狀態已變更，請重新操作。");} }
type Dependencies = {
 read():Promise<MobileSession|null>; write(value:MobileSession|null):Promise<void>; device():Promise<string>;
 login(email:string,password:string,device:string):Promise<{session:MobileSession}>;
 rotate(token:string,device:string):Promise<{session:MobileSession}>;
 revoke(token:string,device:string):Promise<unknown>;
 bootstrap(token:string,device:string):Promise<MobileBootstrapResponse>;
 changed(value:{session:MobileSession|null;bootstrapData:MobileBootstrapResponse|null;generation:number}):void;
};
export function createSessionController(d:Dependencies){
 let generation=0, session:MobileSession|null=null, data:MobileBootstrapResponse|null=null;
 let writes:Promise<void>=Promise.resolve();
 let rotation:{generation:number;promise:Promise<MobileSession>}|null=null;
 const check=(g:number)=>{if(g!==generation)throw new RetiredSession();};
 const publish=()=>d.changed({session,bootstrapData:data,generation});
 const persist=(value:MobileSession|null,g:number)=>{const task=writes.catch(()=>undefined).then(async()=>{check(g);await d.write(value);});writes=task;return task;};
 const retire=()=>{generation++;session=null;data=null;publish();return generation;};
 async function rotate(g:number){
  check(g); if(rotation?.generation===g)return rotation.promise;
  const original=session;if(!original)throw new RetiredSession();
  const promise=(async()=>{const device=await d.device();check(g);const next=(await d.rotate(original.token,device)).session;
   // Keep the returned token available to a racing logout, without publishing it.
   if(g===generation){session=next;await persist(next,g);check(g);publish();}return next;})();
  const owner={generation:g,promise};rotation=owner;
  try{return await promise;}finally{if(rotation===owner)rotation=null;}
 }
 async function run<T>(operation:(token:string,device:string)=>Promise<T>):Promise<T>{
  const g=generation;let current=session;if(!current)throw new RetiredSession();
  const status=(error:unknown)=>error&&typeof error==='object'&&'status'in error?error.status:null;
  try{
   const device=await d.device();check(g);
   if(Date.parse(current.expiresAt)-Date.now()<60000){current=await rotate(g);check(g);}
   try{const result=await operation(current.token,device);check(g);return result;}
   catch(error){check(g);if(status(error)!==401)throw error;}
   current=session?.token!==current.token&&session?session:await rotate(g);check(g);
   const result=await operation(current.token,device);check(g);return result;
  }catch(error){check(g);if(status(error)===401||status(error)===403||(error&&typeof error==='object'&&'code'in error&&['MOBILE_NOT_ENABLED','MOBILE_PLATFORM_ADMIN_NOT_ENABLED'].includes(String(error.code))))await signOut();throw error;}
 }
 async function refresh(){const g=generation;const next=await run(d.bootstrap);check(g);data=next;publish();}
 async function signOut(){const original=session,pending=rotation;const g=retire();const clear=persist(null,g);
  let confirmed=true;try{const device=await d.device();const final=pending?await pending.promise.catch(()=>original):original;if(final)await d.revoke(final.token,device);}catch{confirmed=false;}await clear;return confirmed;}
 return {run,refresh,signOut,get generation(){return generation;},
  async initialize(){const g=generation;const stored=await d.read();check(g);session=stored;publish();if(stored)await refresh();},
  async signIn(email:string,password:string){const outgoing=signOut();const g=generation;await outgoing;check(g);const device=await d.device();check(g);const next=(await d.login(email,password,device)).session;
   if(g!==generation){await d.revoke(next.token,device).catch(()=>undefined);throw new RetiredSession();}
   session=next;await persist(next,g);check(g);publish();await refresh();}
 };
}
