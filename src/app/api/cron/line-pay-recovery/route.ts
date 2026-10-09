import { safeEqual } from "@/lib/security";
import { processPlatformPaymentRecovery } from "@/server/payment-providers/line-platform-payment-worker";
import { paymentError,paymentHeaders } from "@/server/payment-providers/line-platform-payment-http";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=120;
export async function GET(request:Request){
  const secret=process.env.CRON_SECRET?.trim();
  if(!secret)return Response.json({error:"CRON_NOT_CONFIGURED"},{status:503,headers:paymentHeaders});
  if(!safeEqual(request.headers.get("authorization")??"",`Bearer ${secret}`))return Response.json({error:"UNAUTHORIZED"},{status:401,headers:paymentHeaders});
  try{const results=await processPlatformPaymentRecovery();return Response.json({processed:results.length,results},{headers:paymentHeaders});}
  catch(error){return paymentError(error);}
}
