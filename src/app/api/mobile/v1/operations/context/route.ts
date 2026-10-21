import {z} from 'zod';
import {authorizeMobileApiRequest} from '@/server/mobile/authorization';
import {getMemberWorkspaceAccess} from '@/lib/workspace';
import {createOperationsScope} from '@/server/operations-read-scope';
export async function GET(request:Request){
 const auth=await authorizeMobileApiRequest(request);if(!auth.ok)return auth.response;
 const params=new URL(request.url).searchParams;
 const headers={'cache-control':'private, no-store','x-request-id':auth.requestId};
 const error=(status:number,code:'INVALID_INPUT'|'FORBIDDEN')=>Response.json({version:'v1',code,message:status===400?'通知範圍格式不正確。':'目前無權存取此組織。',requestId:auth.requestId,retryable:false},{status,headers});
 if([...params.keys()].some(k=>k!=='organizationId')||params.getAll('organizationId').length>1)return error(400,'INVALID_INPUT');
 const organizationId=params.get('organizationId');
 if(!organizationId)return Response.json(createOperationsScope(auth.principal),{headers});
 if(!z.uuid().safeParse(organizationId).success)return error(400,'INVALID_INPUT');
 if(auth.principal.user.platformRole==='PLATFORM_ADMIN')return error(403,'FORBIDDEN');
 const workspace=(await getMemberWorkspaceAccess(auth.principal.user.id)).find(w=>w.id===organizationId);
 if(!workspace)return error(403,'FORBIDDEN');
 return Response.json(createOperationsScope(auth.principal,workspace),{headers});
}
