import {mobileInboxHttp} from "@/server/mobile/inbox-http";
export async function GET(request:Request){return mobileInboxHttp(request,"count");}
