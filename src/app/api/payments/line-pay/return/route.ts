import { handlePaymentReturn } from "@/server/payment-providers/line-platform-payment-return";
export async function GET(request: Request) { return handlePaymentReturn(request,false); }
