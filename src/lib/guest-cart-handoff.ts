type Handoff={sealedDraft:string;expiresAt:number};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const key=(qr:string,mode:string)=>`stallorder_guest_cart_handoff:v1:${encodeURIComponent(qr)}:${mode}`;
export function saveGuestCartHandoff(storage:Store,qr:string,mode:string,value:Handoff){
  try{storage.setItem(key(qr,mode),JSON.stringify(value));return storage.getItem(key(qr,mode))===JSON.stringify(value);}catch{return false;}
}
export function readGuestCartHandoff(storage:Store,qr:string,mode:string):Handoff|null{
  try{const value=JSON.parse(storage.getItem(key(qr,mode))??'null');return value&&typeof value.sealedDraft==='string'&&Number.isFinite(value.expiresAt)&&value.expiresAt>Date.now()?value:null;}catch{return null;}
}
export function clearGuestCartHandoff(storage:Store,qr:string,mode:string){try{storage.removeItem(key(qr,mode));}catch{/* Optional storage. */}}
