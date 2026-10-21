import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {z} from "zod";
import {readJson} from "@/lib/http";
import {checkPublicRateLimit} from "@/lib/rate-limit";
import {assertCircuitBRequest,requireCircuitBClientIp} from "@/server/public-order/circuit-b-http";
import {PublicOrderCircuitError} from "@/server/public-order/circuit-b-service";
import {exchangeGuestClaimProof,guestClaimCookieName} from "@/server/line-platform/guest-claim";

export const dynamic="force-dynamic";
const headers={"cache-control":"private, no-store","referrer-policy":"no-referrer"};
const inputSchema=z.object({orderSessionToken:z.string().min(40).max(200),trackingToken:z.string().regex(/^sto_[A-Za-z0-9_-]{43}$/),deviceId:z.string().uuid()}).strict();
export async function POST(request:Request) {
  try {
    assertCircuitBRequest(request);
    const clientIp=requireCircuitBClientIp(request);
    const body=await readJson(request,undefined,{maxBytes:1024});
    if(body.error)return body.error;
    const input=inputSchema.safeParse(body.data);
    if(!input.success)return NextResponse.json({error:"INVALID_REQUEST"},{status:400,headers});
    const rate=await checkPublicRateLimit({scope:"line-guest-claim-proof",sourceIdentifier:clientIp,
      resourceIdentifier:createHash("sha256").update(input.data.trackingToken).digest("hex"),sourceLimit:60,resourceLimit:10,windowMs:60_000});
    if(!rate.allowed)return NextResponse.json({error:"RATE_LIMITED"},{status:429,headers:{...headers,"retry-after":String(rate.retryAfterSeconds)}});
    const proof=await exchangeGuestClaimProof(input.data.orderSessionToken,input.data.trackingToken,input.data.deviceId);
    if(!proof)return NextResponse.json({error:"NOT_AVAILABLE"},{status:404,headers});
    const response=NextResponse.json({ok:true},{headers});
    response.cookies.set(guestClaimCookieName(input.data.trackingToken),proof,{httpOnly:true,secure:new URL(request.url).protocol==="https:",sameSite:"strict",path:"/",maxAge:24*60*60});
    return response;
  }catch(error){return NextResponse.json({error:"PROOF_UNAVAILABLE"},{status:error instanceof PublicOrderCircuitError ? error.status : 503,headers});}
}
