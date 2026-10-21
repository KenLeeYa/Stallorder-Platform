import { NextResponse } from 'next/server';
import { getCookieValue } from '@/lib/security';
import { readJson } from '@/lib/http';
import { consumeGuestCartHandoff,guestCartConsumeSchema,guestCartCookieName } from '@/server/line-platform/guest-cart';
import { requirePlatformRequest,platformPrivateHeaders,platformErrorResponse } from '@/server/line-platform/http';
export async function POST(request:Request){
  try{
    const {principal}=await requirePlatformRequest(request,true);
    const body=await readJson(request,undefined,{maxBytes:262144});if(body.error)return body.error;
    const input=guestCartConsumeSchema.parse(body.data);
    const result=await consumeGuestCartHandoff(input,getCookieValue(request,'stallorder_device')??'',getCookieValue(request,guestCartCookieName(input.qrToken,input.orderingMode))??'',principal);
    return NextResponse.json(result,{headers:platformPrivateHeaders});
  }catch(error){return platformErrorResponse(error);}
}
