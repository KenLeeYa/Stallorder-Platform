import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it,vi} from 'vitest';
import {LinePlatformCartHandoff,type CartHandoffProps} from './line-platform-cart-handoff';
const props:CartHandoffProps={enabled:true,qrToken:'synthetic-qr',orderingMode:'PREORDER',orderSessionToken:'synthetic-session',deviceId:'synthetic-device',allowExport:true,allowImport:true,draft:{orderingMode:'PREORDER',scheduledPickupAt:'',customerName:'',customerPhone:'',customerNote:'',deliveryAddress:'',lines:[{id:'line-a',productId:'product-a',quantity:1,note:'',noteOptionIds:[],bundleChoiceIds:[]}]},onImport:vi.fn()};
describe('explicit guest cart handoff entry',()=>{
  it('offers the explicit transfer only for the current eligible live guest cart',()=>{expect(renderToStaticMarkup(<LinePlatformCartHandoff {...props}/>)).toContain('用 LINE 繼續此購物車');});
  it('does not offer exports for unknown restored drafts, members, disabled pilots or dine-in/default ordering',()=>{
    for(const override of [{allowExport:false},{customerId:'member-a'},{enabled:false},{orderingMode:'DEFAULT' as const}])expect(renderToStaticMarkup(<LinePlatformCartHandoff {...props} {...override}/>)).toBe('');
  });
});
