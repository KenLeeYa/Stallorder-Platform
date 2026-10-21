import {describe,expect,it} from 'vitest';
import {saveGuestCartHandoff,readGuestCartHandoff,clearGuestCartHandoff} from './guest-cart-handoff';
function storage(){const map=new Map<string,string>();return{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};}
describe('encrypted guest cart handoff storage',()=>{
  it('restores only the intended store and mode without copying original Web keys',()=>{
    const s=storage(),value={sealedDraft:'opaque-server-encrypted-draft',expiresAt:Date.now()+10000};s.setItem('stallorder_qr_cart:store-a','old unowned cart');
    expect(readGuestCartHandoff(s,'store-a','PREORDER')).toBeNull();expect(saveGuestCartHandoff(s,'store-a','PREORDER',value)).toBe(true);
    expect(readGuestCartHandoff(s,'store-a','PREORDER')).toEqual(value);expect(readGuestCartHandoff(s,'store-b','PREORDER')).toBeNull();expect(readGuestCartHandoff(s,'store-a','DELIVERY')).toBeNull();
    clearGuestCartHandoff(s,'store-a','PREORDER');expect(readGuestCartHandoff(s,'store-a','PREORDER')).toBeNull();expect(s.getItem('stallorder_qr_cart:store-a')).toBe('old unowned cart');
  });
  it('does not offer expired handoffs',()=>{const s=storage();saveGuestCartHandoff(s,'store-a','PREORDER',{sealedDraft:'opaque',expiresAt:Date.now()-1});expect(readGuestCartHandoff(s,'store-a','PREORDER')).toBeNull();});
  it('keeps the original cart usable when storage is blocked rather than navigating away',()=>{
    const denied=()=>{throw new Error('DENIED');},s={getItem:denied,setItem:denied,removeItem:denied};
    expect(saveGuestCartHandoff(s,'store-a','PREORDER',{sealedDraft:'opaque',expiresAt:Date.now()+10000})).toBe(false);expect(readGuestCartHandoff(s,'store-a','PREORDER')).toBeNull();expect(()=>clearGuestCartHandoff(s,'store-a','PREORDER')).not.toThrow();
  });
});
