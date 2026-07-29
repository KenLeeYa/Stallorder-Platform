# New Merchant Operational Defaults

These defaults apply only to merchants and stalls created after this change.
Existing stall settings are not backfilled or disabled.

## Enabled by default

| Function | Initial state | Configuration area |
| --- | --- | --- |
| Traditional Chinese QR locale | Enabled and required | Stall settings > Operations modules and dine-in tables > QR ordering locales |
| Cash payment | Enabled as the only created payment option | Stall settings > Operations modules and dine-in tables > Payment options |
| Takeout ordering workflow | Available after setup go-live | Opening setup and stall operating status |

QR ordering remains `PAUSED`, and the stall remains `CLOSED`, until the merchant
finishes the opening checklist, completes the test order, and explicitly opens
ordering.

## Disabled or inactive by default

| Function | Initial state | Configuration area |
| --- | --- | --- |
| Dine-in tables | Disabled | Stall settings > Operations modules and dine-in tables |
| Online delivery | Disabled | Stall settings > Operations modules and dine-in tables |
| Order printing | Disabled | Stall settings > Operations modules and dine-in tables |
| Checkout discounts | Disabled | Stall settings > Operations modules and dine-in tables |
| English, Japanese, Korean, Vietnamese, Thai | Disabled | Stall settings > Operations modules and dine-in tables > QR ordering locales |
| Additional payment methods | Not created | Stall settings > Operations modules and dine-in tables > Payment options |
| CDS pickup display | Inactive until saved and enabled | Stall settings > CDS pickup display |
| Capacity automation | Disabled until configured | Stall settings > Capacity and waiting time |
| LINE notifications | Inactive without integration credentials | Stall settings > LINE notifications |
| Market schedules and locations | No schedule or location is created | Stall settings > Locations and schedule |
| KDS stations | No station is created automatically | Stall settings > KDS stations and KDS settings |

Plan entitlements remain available during Trial so merchants can enable and
evaluate optional functions themselves. An entitlement grants access; it does
not activate an operational module or create public configuration.
