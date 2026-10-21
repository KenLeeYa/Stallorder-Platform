// Declared test-only module facade. No database method is overwritten.
import {prisma as realPrisma} from '../../../src/lib/prisma';
let injected:unknown, calls=0;
const rejectTransaction=async()=>{calls++;throw injected;};
export function armFailure(error:unknown){if(injected!==undefined)throw Error('FACADE_ALREADY_ARMED');injected=error;calls=0;}
export function disarmFailure(){injected=undefined;}
export function injectionState(){return{armed:injected!==undefined,calls,transaction:rejectTransaction};}
export const prisma=new Proxy(realPrisma,{get(target,key){if(key==='$transaction'&&injected!==undefined)return rejectTransaction;return Reflect.get(target,key);}});
