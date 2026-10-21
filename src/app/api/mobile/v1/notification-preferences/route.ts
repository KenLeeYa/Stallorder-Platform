import {mobileInboxHttp} from "@/server/mobile/inbox-http";
export async function GET(request:Request){return mobileInboxHttp(request,"preferences");}
export async function PATCH(request:Request){return mobileInboxHttp(request,"preferences");}
