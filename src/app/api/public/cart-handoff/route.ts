import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { getRequestPrincipal } from '@/lib/auth';
import { readJson } from '@/lib/http';
import { checkPublicRateLimit } from '@/lib/rate-limit';
import { assertCircuitBRequest, requireCircuitBClientIp } from '@/server/public-order/circuit-b-http';
import { PublicOrderCircuitError } from '@/server/public-order/circuit-b-service';
import { beginGuestCartHandoff,guestCartBeginSchema,guestCartCookieName,GUEST_CART_TTL_SECONDS } from '@/server/line-platform/guest-cart';
import { platformPrivateHeaders } from '@/server/line-platform/http';
export async function POST(request:Request){
  try{
    assertCircuitBRequest(request);const ip=requireCircuitBClientIp(request);
    const body=await readJson(request,undefined,{maxBytes:131072});if(body.error)return body.error;
    const input=guestCartBeginSchema.safeParse(body.data);if(!input.success)return NextResponse.json({error:'INVALID_REQUEST'},{status:400,headers:platformPrivateHeaders});
    const rate=await checkPublicRateLimit({scope:'line-guest-cart',sourceIdentifier:ip,resourceIdentifier:createHash('sha256').update(input.data.orderSessionToken).digest('hex'),sourceLimit:30,resourceLimit:5,windowMs:60000});
    if(!rate.allowed)return NextResponse.json({error:'RATE_LIMITED'},{status:429,headers:platformPrivateHeaders});
    const result=await beginGuestCartHandoff(input.data,await getRequestPrincipal(request));
    const response=NextResponse.json({sealedDraft:result.sealedDraft,expiresAt:result.expiresAt,href:result.href},{headers:platformPrivateHeaders});
    response.cookies.set(guestCartCookieName(input.data.qrToken,input.data.draft.orderingMode),result.proof,{httpOnly:true,secure:new URL(request.url).protocol==='https:',sameSite:'strict',path:'/api/mini/cart-handoff',maxAge:GUEST_CART_TTL_SECONDS});
    return response;
  }catch(error){return NextResponse.json({error:'購物車無法轉移，請繼續原訪客點餐。'},{status:error instanceof PublicOrderCircuitError?error.status:400,headers:platformPrivateHeaders});}
}
