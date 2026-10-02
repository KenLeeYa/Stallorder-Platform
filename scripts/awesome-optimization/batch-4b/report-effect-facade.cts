// Test-only pause at the original pre-effect function boundary, after immutable snapshot persistence.
import * as actual from '../../../src/server/reports/report-execution';
const holds=new Map<string,{reached:Promise<void>;signal:()=>void;pending:Promise<void>;resume:()=>void}>();
export const {claimReportDeliveries,recoverReportDeliveries,createReportIntent,lockReportClaim,assertCurrentReportEligibility}=actual;
export function holdEffect(id:string){let signal!:()=>void,resume!:()=>void;const reached=new Promise<void>(r=>{signal=r;}),pending=new Promise<void>(r=>{resume=r;});holds.set(id,{reached,signal,pending,resume});}
export function heldEffect(id:string){return holds.get(id)!.reached;}
export function releaseEffect(id:string){holds.get(id)?.resume();holds.delete(id);}
export function releaseAllEffects(){for(const id of holds.keys())releaseEffect(id);}
export async function authorizeReportEffect(...args:Parameters<typeof actual.authorizeReportEffect>){const held=holds.get(args[0].id);if(held){held.signal();await held.pending;}return actual.authorizeReportEffect(...args);}
