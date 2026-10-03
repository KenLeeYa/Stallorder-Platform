import { describe, expect, it, vi } from "vitest";
import { createQrOrderStorage } from "./qr-order-storage";
import { qrCartStorageKey } from "./qr-cart";
import { persistQrOrderCartDraft } from "@/components/qr-order-cart-persistence";
import { persistQrOrderRecovery, readQrOrderRecovery } from "./qr-order-recovery";
import { persistTakeoutCustomerMemory, readTakeoutCustomerMemory } from "./takeout-customer-memory";
const qr="synthetic-store-a-qr-token",otherQr="synthetic-store-b-qr-token",device="11111111-1111-4111-8111-111111111111";
function storage() {
  const data=new Map<string,string>();
  return {getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};
}
function saveAll(target:ReturnType<typeof createQrOrderStorage>) {
  persistQrOrderCartDraft({sessionReady:true,cartReady:true,qrToken:qr,orderingMode:'DELIVERY',scheduledPickupAt:'',customerName:'Synthetic A',customerPhone:'0900000000',customerNote:'',deliveryAddress:'Synthetic private address',lines:[]},()=>target);
  persistTakeoutCustomerMemory(target,'store-a',{customerName:'Synthetic A',customerPhone:'0900000000'});
  persistQrOrderRecovery(target,{qrToken:qr,trackingToken:`sto_${'a'.repeat(43)}`,deviceId:device});
}
function readAll(target:ReturnType<typeof createQrOrderStorage>) {
  return [target.getItem(qrCartStorageKey(qr,'DELIVERY')),readTakeoutCustomerMemory(target,'store-a'),readQrOrderRecovery(target,qr)];
}
describe('MINI owner and store draft isolation',()=>{
  it('restores cart PII, customer memory and order recovery for the same authoritative member and store',()=>{
    const raw=storage();saveAll(createQrOrderStorage(()=>raw,{customerId:'member-a',qrToken:qr}));
    const restored=readAll(createQrOrderStorage(()=>raw,{customerId:'member-a',qrToken:qr}));
    expect(restored[0]).toContain('Synthetic private address');expect(restored[1]).toMatchObject({customerName:'Synthetic A'});expect(restored[2]).toMatchObject({deviceId:device});
  });
  it('does not restore another member, another store, or an unowned original Web draft',()=>{
    const raw=storage();saveAll(createQrOrderStorage(()=>raw));
    expect(readAll(createQrOrderStorage(()=>raw,{customerId:'member-a',qrToken:qr}))).toEqual([null,null,null]);
    saveAll(createQrOrderStorage(()=>raw,{customerId:'member-a',qrToken:qr}));
    expect(readAll(createQrOrderStorage(()=>raw,{customerId:'member-b',qrToken:qr}))).toEqual([null,null,null]);
    expect(readAll(createQrOrderStorage(()=>raw,{customerId:'member-a',qrToken:otherQr}))).toEqual([null,null,null]);
    expect(readAll(createQrOrderStorage(()=>raw))[0]).toContain('Synthetic private address');
  });
  it('clears only the current member draft and preserves original guest keys',()=>{
    const raw=storage(),guest=createQrOrderStorage(()=>raw),a=createQrOrderStorage(()=>raw,{customerId:'member-a',qrToken:qr});
    saveAll(guest);saveAll(a);a.removeItem(qrCartStorageKey(qr,'DELIVERY'));
    expect(a.getItem(qrCartStorageKey(qr,'DELIVERY'))).toBeNull();expect(guest.getItem(qrCartStorageKey(qr,'DELIVERY'))).not.toBeNull();
  });
  it('makes both a denied storage accessor and failing storage operations optional',()=>{
    const denied=()=>{throw new Error('STORAGE_DENIED');};
    for(const target of [createQrOrderStorage(denied,{customerId:'member-a',qrToken:qr}),createQrOrderStorage(()=>({getItem:denied,setItem:denied,removeItem:denied}))]) {
      expect(()=>saveAll(target)).not.toThrow();expect(readAll(target)).toEqual([null,null,null]);expect(()=>target.removeItem('draft')).not.toThrow();
    }
    const load=vi.fn(denied);createQrOrderStorage(load);expect(load).not.toHaveBeenCalled();
  });
});
