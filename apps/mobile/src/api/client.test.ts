import {describe,it,expect} from 'vitest';
import {retryAfterDeadline,responseJson,MobileApiError} from './client';
describe('Native transport retry and shared errors',()=>{
 it('preserves integer and HTTP date 429 retry floors',()=>{expect(retryAfterDeadline('120',1000)).toBe(121000);expect(retryAfterDeadline('Thu, 01 Oct 2026 00:02:00 GMT',Date.parse('2026-10-01T00:00:00Z'))).toBe(Date.parse('2026-10-01T00:02:00Z'));expect(retryAfterDeadline(null,1000)).toBe(61000);});
 it('preserves the current shared CAS conflict instead of flattening it',async()=>{const body={version:'v1',code:'CONFLICT',message:'偏好已變更',requestId:'test',retryable:false};await expect(responseJson(Response.json(body,{status:409}))).rejects.toMatchObject({code:'CONFLICT',status:409,message:'偏好已變更'});});
 it('rejects a malformed successful body at the consuming schema boundary',async()=>{await expect(responseJson(new Response('not json',{status:503}))).rejects.toBeInstanceOf(MobileApiError);});
});
