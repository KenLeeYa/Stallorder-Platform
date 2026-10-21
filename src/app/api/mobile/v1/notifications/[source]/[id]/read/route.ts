import {mobileInboxHttp} from "@/server/mobile/inbox-http";
import {inboxRefSchema} from "@stallorder/contracts/notifications/v1";
export async function PATCH(request:Request,context:{params:Promise<{source:string;id:string}>}){
const ref=inboxRefSchema.safeParse(await context.params);
if(!ref.success)return Response.json({code:"INBOX_REFERENCE_INVALID"},{status:400,headers:{"cache-control":"private, no-store"}});
return mobileInboxHttp(request,"read",ref.data);}
