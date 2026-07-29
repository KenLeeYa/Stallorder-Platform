export const merchantBusinessTypes = [
  "NIGHT_MARKET_STALL",
  "FOOD_TRUCK",
  "MARKET_STALL",
  "POPUP_STORE",
  "SMALL_RESTAURANT",
  "BEVERAGE_SHOP",
  "OTHER",
] as const;

export const preferredContactMethods = ["PHONE", "LINE", "EMAIL"] as const;

export const merchantApplicationFieldLabels = {
  phone: "\u806f\u7d61\u96fb\u8a71",
  lineId: "LINE ID",
  preferredContactMethod: "\u504f\u597d\u806f\u7d61\u65b9\u5f0f",
  merchantName: "\u5546\u5bb6\u6216\u54c1\u724c\u540d\u7a31",
  businessType: "\u71df\u696d\u985e\u578b",
  businessRegistrationNumber: "\u7d71\u4e00\u7de8\u865f",
  contactName: "\u8ca0\u8cac\u806f\u7d61\u4eba",
  businessPhone: "\u5546\u5bb6\u96fb\u8a71",
  businessAddress: "\u5546\u5bb6\u5730\u5740",
  city: "\u7e23\u5e02",
  merchantDescription: "\u5546\u5bb6\u7c21\u4ecb",
  stallName: "\u7b2c\u4e00\u500b\u6524\u4f4d\u540d\u7a31",
  stallLocation: "\u4e3b\u8981\u71df\u696d\u5730\u9ede",
  requestedSlug: "\u516c\u958b\u8b58\u5225\u540d\u7a31",
  estimatedDailyOrders: "\u9810\u4f30\u6bcf\u65e5\u8a02\u55ae",
  expectedStartDate: "\u9810\u8a08\u958b\u59cb\u65e5\u671f",
  needsMultipleStaff: "\u9810\u8a08\u9080\u8acb\u5176\u4ed6\u54e1\u5de5\u5171\u540c\u4f7f\u7528",
  needsKitchenView: "\u9810\u8a08\u4f7f\u7528\u5eda\u623f\u751f\u7522\u770b\u677f\uff08KDS\uff09",
  requestedPlanCode: "\u7533\u8acb\u65b9\u6848",
  termsAccepted: "\u670d\u52d9\u689d\u6b3e",
  privacyAccepted: "\u96b1\u79c1\u6b0a\u653f\u7b56",
  dataProcessingAccepted: "\u8cc7\u6599\u8655\u7406\u544a\u77e5\u4e8b\u9805",
  informationConfirmed: "\u7533\u8acb\u8cc7\u6599\u78ba\u8a8d",
} as const;

export const merchantApplicationStatusLabels = {
  DRAFT: "\u8349\u7a3f",
  SUBMITTED: "\u5df2\u9001\u51fa",
  PENDING_REVIEW: "\u7b49\u5f85\u5be9\u6838",
  NEEDS_INFO: "\u9700\u8981\u88dc\u4ef6",
  APPROVED: "\u5df2\u6838\u51c6",
  REJECTED: "\u672a\u6838\u51c6",
  WITHDRAWN: "\u5df2\u64a4\u56de",
  EXPIRED: "\u5df2\u903e\u671f",
} as const;

export const merchantBusinessTypeLabels = {
  NIGHT_MARKET_STALL: "\u591c\u5e02\u6524\u4f4d",
  FOOD_TRUCK: "\u9910\u8eca",
  MARKET_STALL: "\u5e02\u96c6\u6524\u4f4d",
  POPUP_STORE: "\u5feb\u9583\u5e97",
  SMALL_RESTAURANT: "\u5c0f\u578b\u9910\u98f2\u5e97",
  BEVERAGE_SHOP: "\u98f2\u6599\u5e97",
  OTHER: "\u5176\u4ed6",
} as const;
