export function normalizeApiBaseUrl(value: string | undefined, environment = process.env.EXPO_PUBLIC_APP_ENV ?? "local") {
 const url=new URL(value?.trim()||"http://127.0.0.1:3026");
 const local=environment==="local"&&url.origin==="http://127.0.0.1:3026";
 if((!local&&url.protocol!=="https:")||url.username||url.password||url.search||url.hash||url.pathname!=="/")throw Error("INVALID_MOBILE_API_BASE_URL");
 return url.origin;
}
