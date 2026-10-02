import {assertLegacyNotificationCatalogue as assertOriginalCatalogue} from './legacy-notification-catalogue-guard-v1.mjs';
import {assertLegacyContactRevocationCatalogue} from './legacy-contact-revocation-catalogue-v1.mjs';
export async function assertLegacyNotificationCatalogue(tx){
 return{legacy:await assertOriginalCatalogue(tx),revocation:await assertLegacyContactRevocationCatalogue(tx)};
}
