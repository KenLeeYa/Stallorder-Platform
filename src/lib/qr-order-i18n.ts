export const QR_LOCALES = ["zh-TW", "en", "ja", "ko", "vi", "th"] as const;
export const QR_LOCALE_STORAGE_KEY = "stallorder_qr_locale";
export const QR_UI_LOCALE_STORAGE_KEY = "stallorder_qr_ui_locale_v2";

export type QrLocale = (typeof QR_LOCALES)[number];
export type QrLocalePreferenceSource = "manual" | "query";

export type QrLocalePreference = {
  version: 2;
  locale: QrLocale;
  source: QrLocalePreferenceSource;
};

export type ResolvedQrUiLocale = {
  locale: QrLocale;
  source: "app" | "legacy" | QrLocalePreferenceSource;
  shouldMigrateLegacy: boolean;
};

type ErrorMessageKey =
  | "invalidRequest"
  | "qrUnavailable"
  | "orderingUnavailable"
  | "capacityPaused"
  | "sessionInvalid"
  | "rateLimited"
  | "securityFailed"
  | "securityUnavailable"
  | "customerDetails"
  | "selectionInvalid"
  | "orderLimits"
  | "productUnavailable"
  | "waitAcknowledgment"
  | "pendingLimit"
  | "trialOrderLimit"
  | "subscriptionSuspended"
  | "orderFailed";

export type QrOrderMessages = {
  localeName: string;
  language: string;
  menuLanguage: string;
  sessionLoading: string;
  sessionStartError: string;
  sessionExpiringTitle: string;
  sessionExpiringDescription: string;
  sessionExpiredTitle: string;
  sessionExpiredRefreshDescription: string;
  refreshSession: string;
  lotteryRegionLabel: string;
  lotterySectionTitle: string;
  lotterySectionDescription: string;
  lotterySpendProgress: (amount: string) => string;
  lotteryStart: string;
  lotteryDrawingButton: string;
  lotteryAlreadyDrawn: string;
  lotteryDrawingTitle: string;
  lotteryDrawingDescription: string;
  lotteryResultTitle: string;
  lotteryBestSellerBasis: string;
  lotteryDiscoveryBasis: string;
  lotteryRecommendation: (product: string) => string;
  lotteryFreeRewardResult: (product: string) => string;
  lotteryFreeRewardNotice: string;
  lotteryDiscountResult: (discount: string) => string;
  lotteryNoDiscountResult: string;
  lotteryDiscountNotice: string;
  lotteryAccept: string;
  lotteryFreeRewardAccept: string;
  lotteryCancel: string;
  lotteryDailyLimitTitle: string;
  lotteryDailyLimitDescription: string;
  lotteryAcknowledge: string;
  lotteryUnavailable: string;
  lotteryUnavailableProduct: string;
  lotteryNotEligible: string;
  hotSellerBadge: string;
  qrUnavailableTitle: string;
  degradedTitle: string;
  degradedMessage: string;
  retryAvailability: string;
  dineIn: (table: string) => string;
  takeout: string;
  timeRemaining: (minutes: number, seconds: string) => string;
  estimatedWait: (minutes: number) => string;
  estimatedWaitRange: (minimumMinutes: number, maximumMinutes: number) => string;
  waitAcknowledgment: (minimumMinutes: number, maximumMinutes: number) => string;
  waitAcknowledgmentRequired: string;
  lastTableOrder: (time: string) => string;
  cartRestored: string;
  productImage: (name: string) => string;
  decrease: (name: string) => string;
  increase: (name: string) => string;
  addToCart: string;
  editCartItem: string;
  finishEditingCartItem: string;
  removeCartItem: string;
  cartProductQuantity: (count: number) => string;
  additionalQuantity: string;
  backToTop: string;
  quantityLimit: string;
  singleChoice: string;
  multipleChoice: string;
  maxSelections: (count: number) => string;
  noSelection: string;
  yourOrder: string;
  viewOrder: string;
  continueToCheckout: string;
  backToCart: string;
  checkoutDetails: string;
  preorderSelectTimeFirst: string;
  close: string;
  categoryNavigation: string;
  customerName: string;
  customerNamePlaceholder: string;
  customerNameRequiredPlaceholder: string;
  customerDetailsRequired: string;
  orderNote: string;
  orderNotePlaceholder: (count: number) => string;
  itemCount: (count: number) => string;
  securityVerification: string;
  securityNotConfigured: string;
  securityRequired: string;
  selectAtLeastOne: string;
  sessionExpired: string;
  requiredNotes: (product: string) => string;
  orderSubmitError: string;
  networkError: string;
  submitting: string;
  submitOrder: string;
  saveOrderChanges: string;
  confirmationNotice: string;
  editConfirmationNotice: string;
  preorderPickupTime: string;
  optionalDeliveryTime: string;
  optionalPickupTime: string;
  applyPickupTimeRequired: string;
  selectPreorderTimeRequired: string;
  scheduledDeliveryTime: string;
  scheduledPickupTime: string;
  preorderPickupDate: string;
  deliveryDate: string;
  pickupDate: string;
  deliveryTime: string;
  pickupTime: string;
  unavailableDate: string;
  applyTime: string;
  timeApplied: string;
  unappliedTimeNotice: string;
  preorderOnlyNotice: string;
  preorderTimeGuidance: string;
  applyPreorderTimeGuidance: string;
  noProductsForSlot: string;
  discountIneligible: string;
  bundleGroup: string;
  selectionRange: (minimum: number, maximum: number) => string;
  errors: Record<ErrorMessageKey, string>;
};

export const qrOrderMessages: Record<QrLocale, QrOrderMessages> = {
  "zh-TW": {
    localeName: "繁體中文",
    language: "語言",
    menuLanguage: "點餐語言",
    sessionLoading: "正在建立安全點餐工作階段...",
    sessionStartError: "目前無法開始點餐。",
    sessionExpiringTitle: "即將逾時",
    sessionExpiringDescription: "點餐工作階段即將結束，請重新整理以繼續點餐；已加入購物車的內容會保留。",
    sessionExpiredTitle: "已逾時",
    sessionExpiredRefreshDescription: "點餐工作階段已結束，請重新整理建立新的安全工作階段；已加入購物車的內容會保留。",
    refreshSession: "重新整理並繼續點餐",
    lotteryRegionLabel: "抽抽樂推薦",
    lotterySectionTitle: "不知道點什麼？幫我抽",
    lotterySectionDescription: "依近 30 天完成訂單的熱銷趨勢推薦，也保留探索其他商品的機會；結帳折扣會另外獨立抽取。",
    lotterySpendProgress: (amount) => `再消費 ${amount} 即可獲得一次免費餐點抽獎。`,
    lotteryStart: "開始抽抽樂",
    lotteryDrawingButton: "抽取中…",
    lotteryAlreadyDrawn: "今日已抽取",
    lotteryDrawingTitle: "正在為你抽選",
    lotteryDrawingDescription: "正在從今日供應的商品中找一個推薦。",
    lotteryResultTitle: "今天推薦你點",
    lotteryBestSellerBasis: "熱銷推薦",
    lotteryDiscoveryBasis: "探索人氣推薦",
    lotteryRecommendation: (product) => `推薦你點「${product}」`,
    lotteryFreeRewardResult: (product) => `恭喜抽中「${product}」免費一份！`,
    lotteryFreeRewardNotice: "贈品會在送出訂單時自動以 0 元加入，不需再加入購物車。",
    lotteryDiscountResult: (discount) => `同時抽中 ${discount}！`,
    lotteryNoDiscountResult: "這次沒有抽中折扣。",
    lotteryDiscountNotice: "折扣僅套用未標示「不適用訂單折扣」的商品。",
    lotteryAccept: "接受推薦",
    lotteryFreeRewardAccept: "領取免費餐點",
    lotteryCancel: "取消",
    lotteryDailyLimitTitle: "此瀏覽器今日已抽取過",
    lotteryDailyLimitDescription: "同一瀏覽器資料每日只能抽取一次；今天的商品推薦與折扣結果已保留，明天可再次抽取。",
    lotteryAcknowledge: "我知道了",
    lotteryUnavailable: "抽抽樂目前無法使用。",
    lotteryUnavailableProduct: "抽中的商品目前無法供應，請稍後再試。",
    lotteryNotEligible: "目前尚未符合免費抽獎資格。",
    hotSellerBadge: "熱銷",
    qrUnavailableTitle: "目前無法使用此 QR Code",
    degradedTitle: "線上送單暫時停用",
    degradedMessage: "您仍可查看菜單，請至攤位櫃台點餐。",
    retryAvailability: "重新檢查",
    dineIn: (table) => `內用 · ${table}`,
    takeout: "外帶取餐",
    timeRemaining: (minutes, seconds) => `點餐時間剩餘 ${minutes}:${seconds}`,
    estimatedWait: (minutes) => minutes > 0 ? `目前預估等候約 ${minutes} 分鐘` : "目前可立即處理",
    estimatedWaitRange: (minimum, maximum) => minimum === maximum
      ? `目前預估等候約 ${maximum} 分鐘`
      : `目前預估等候時間：${minimum}～${maximum} 分鐘`,
    waitAcknowledgment: (minimum, maximum) => `我已了解目前預估等候時間為 ${minimum === maximum ? `${maximum}` : `${minimum}～${maximum}`} 分鐘。`,
    waitAcknowledgmentRequired: "請先確認目前預估等候時間。",
    lastTableOrder: (time) => `此桌最近追加點餐：${time}`,
    cartRestored: "已恢復上次尚未送出的點餐內容。",
    productImage: (name) => `${name}圖片`,
    decrease: (name) => `減少 ${name}`,
    increase: (name) => `增加 ${name}`,
    addToCart: "加入購物車",
    editCartItem: "修改客製",
    finishEditingCartItem: "修改完成",
    removeCartItem: "移除",
    cartProductQuantity: (count) => `購物車已有 ${count} 份`,
    additionalQuantity: "本次再加",
    backToTop: "返回頁面頂端",
    quantityLimit: "已達本攤位的點餐數量限制。",
    singleChoice: "單選",
    multipleChoice: "複選",
    maxSelections: (count) => `最多 ${count} 項`,
    noSelection: "不選擇",
    yourOrder: "您的訂單",
    viewOrder: "查看訂單",
    continueToCheckout: "繼續填寫訂購資料",
    backToCart: "返回購物車",
    checkoutDetails: "訂購資料與確認",
    preorderSelectTimeFirst: "先確認取餐時間，再瀏覽該時段可訂購的商品。",
    close: "關閉",
    categoryNavigation: "商品分類",
    customerName: "顧客稱呼",
    customerNamePlaceholder: "稱呼（選填）",
    customerNameRequiredPlaceholder: "請輸入顧客姓名",
    customerDetailsRequired: "請填寫顧客姓名與有效的聯絡電話。",
    orderNote: "訂單備註",
    orderNotePlaceholder: (count) => `備註（最多 ${count} 字）`,
    itemCount: (count) => `共 ${count} 份`,
    securityVerification: "安全驗證",
    securityNotConfigured: "尚未設定安全驗證服務。",
    securityRequired: "請先完成安全驗證。",
    selectAtLeastOne: "請至少選擇一項商品。",
    sessionExpired: "點餐工作階段已逾時，請重新掃描 QR Code。",
    requiredNotes: (product) => `請完成「${product}」的必選註記。`,
    orderSubmitError: "目前無法送出訂單。",
    networkError: "網路連線中斷，請稍後再試。",
    submitting: "送出中...",
    submitOrder: "送出訂單",
    saveOrderChanges: "儲存訂單修改",
    confirmationNotice: "送出後須由店員確認，確認前不會開始製作。",
    editConfirmationNotice: "修改後須由店員重新確認；若餐點或列印已開始，系統會拒絕修改。",
    preorderPickupTime: "預約取餐時間", optionalDeliveryTime: "指定送達時間（選填）", optionalPickupTime: "預計取餐時間（選填）", applyPickupTimeRequired: "取餐時間尚未套用，請先按下「套用這個時間」。", selectPreorderTimeRequired: "請先選擇預約取餐時間。", scheduledDeliveryTime: "指定送達時間", scheduledPickupTime: "指定取餐時間", preorderPickupDate: "預約取餐日期", deliveryDate: "送達日期", pickupDate: "取餐日期", deliveryTime: "送達時間", pickupTime: "取餐時間", unavailableDate: "所選日期目前沒有可接受的時段。", applyTime: "套用這個時間", timeApplied: "時間已套用", unappliedTimeNotice: "尚未套用新的取餐時間；套用後才會更新可點商品與購物車。", preorderOnlyNotice: "目前為非營業時間，僅接受外帶自取預約。", preorderTimeGuidance: "請依選擇的預約時段取餐", applyPreorderTimeGuidance: "請先確認並套用預約取餐時間，完成後才會顯示可點商品。", noProductsForSlot: "此時段暫無可預約商品，請選擇其他取餐時間。", discountIneligible: "不適用訂單折扣", bundleGroup: "套餐群組", selectionRange: (minimum, maximum) => `選 ${minimum}～${maximum} 項`,
    errors: {
      invalidRequest: "訂單資料不正確，請重新確認。",
      qrUnavailable: "此 QR Code 目前無法使用，請洽詢店員。",
      orderingUnavailable: "攤位目前暫停或關閉點餐。",
      capacityPaused: "目前訂單較多，暫停接單，請稍後再試。",
      sessionInvalid: "點餐工作階段已失效，請重新掃描 QR Code。",
      rateLimited: "操作過於頻繁，請稍後再試。",
      securityFailed: "安全驗證失敗，請重新完成驗證。",
      securityUnavailable: "安全驗證暫時無法使用，請稍後再試。",
      customerDetails: "請填寫顧客姓名與有效的聯絡電話。",
      selectionInvalid: "商品選項不完整或已變更，請重新確認。",
      orderLimits: "訂單內容超過攤位限制，請調整後再試。",
      productUnavailable: "部分商品已售完或無法供應。",
      waitAcknowledgment: "請先確認目前預估等候時間，再送出訂單。",
      pendingLimit: "此裝置尚有過多待確認訂單。",
      trialOrderLimit: "試用訂單額度已用完，請洽商家人員。",
      subscriptionSuspended: "商家訂閱已停權，暫時無法接受新訂單。",
      orderFailed: "目前無法建立或查詢訂單，請稍後再試。",
    },
  },
  en: {
    localeName: "English",
    language: "Language",
    menuLanguage: "Menu language",
    sessionLoading: "Starting a secure ordering session...",
    sessionStartError: "Unable to start ordering right now.",
    sessionExpiringTitle: "Session expiring soon",
    sessionExpiringDescription: "Refresh to keep ordering. Items already in your cart will be kept.",
    sessionExpiredTitle: "Session expired",
    sessionExpiredRefreshDescription: "Refresh to start a new secure session. Items already in your cart will be kept.",
    refreshSession: "Refresh and continue ordering",
    lotteryRegionLabel: "Lucky draw recommendation",
    lotterySectionTitle: "Not sure what to order? Let us pick",
    lotterySectionDescription: "Recommendations follow completed-order trends from the last 30 days, with room to discover other items. Checkout discounts are drawn separately.",
    lotterySpendProgress: (amount) => `Add ${amount} more to unlock one free-meal draw.`,
    lotteryStart: "Start lucky draw",
    lotteryDrawingButton: "Drawing…",
    lotteryAlreadyDrawn: "Draw completed today",
    lotteryDrawingTitle: "Picking for you",
    lotteryDrawingDescription: "We are choosing a recommendation from today’s available items.",
    lotteryResultTitle: "Today’s recommendation",
    lotteryBestSellerBasis: "Popular pick",
    lotteryDiscoveryBasis: "Discovery pick",
    lotteryRecommendation: (product) => `We recommend “${product}”`,
    lotteryFreeRewardResult: (product) => `Congratulations! You won one free “${product}”.`,
    lotteryFreeRewardNotice: "The reward will be added to this order at $0 when you submit it. Do not add it to the cart again.",
    lotteryDiscountResult: (discount) => `You also won ${discount}!`,
    lotteryNoDiscountResult: "No discount was won this time.",
    lotteryDiscountNotice: "The discount only applies to items not marked as excluded from order discounts.",
    lotteryAccept: "Accept recommendation",
    lotteryFreeRewardAccept: "Claim free item",
    lotteryCancel: "Cancel",
    lotteryDailyLimitTitle: "This browser has already drawn today",
    lotteryDailyLimitDescription: "Each browser profile can draw once per day. Today’s item and discount result have been saved; you can draw again tomorrow.",
    lotteryAcknowledge: "Got it",
    lotteryUnavailable: "Lucky draw is unavailable right now.",
    lotteryUnavailableProduct: "The selected item is currently unavailable. Try again later.",
    lotteryNotEligible: "This order is not yet eligible for the free draw.",
    hotSellerBadge: "Popular",
    qrUnavailableTitle: "This QR code is currently unavailable",
    degradedTitle: "Online ordering is temporarily unavailable",
    degradedMessage: "You can still view the menu. Please order at the stall counter.",
    retryAvailability: "Check again",
    dineIn: (table) => `Dine-in · ${table}`,
    takeout: "Takeout",
    timeRemaining: (minutes, seconds) => `Time remaining ${minutes}:${seconds}`,
    estimatedWait: (minutes) => minutes > 0 ? `Estimated wait: about ${minutes} minutes` : "Ready to prepare now",
    estimatedWaitRange: (minimum, maximum) => minimum === maximum
      ? `Estimated wait: about ${maximum} minutes`
      : `Estimated wait: ${minimum}–${maximum} minutes`,
    waitAcknowledgment: (minimum, maximum) => `I understand the estimated wait is ${minimum === maximum ? `${maximum}` : `${minimum}–${maximum}`} minutes.`,
    waitAcknowledgmentRequired: "Confirm the estimated wait before placing your order.",
    lastTableOrder: (time) => `Latest order for this table: ${time}`,
    cartRestored: "Your unsent cart has been restored.",
    productImage: (name) => `${name} image`,
    decrease: (name) => `Decrease ${name}`,
    increase: (name) => `Increase ${name}`,
    addToCart: "Add to cart",
    editCartItem: "Edit options",
    finishEditingCartItem: "Save changes",
    removeCartItem: "Remove",
    cartProductQuantity: (count) => `${count} already in cart`,
    additionalQuantity: "Add more",
    backToTop: "Back to top",
    quantityLimit: "You have reached this stall's ordering limit.",
    singleChoice: "Choose one",
    multipleChoice: "Choose multiple",
    maxSelections: (count) => `Up to ${count}`,
    noSelection: "None",
    yourOrder: "Your order",
    viewOrder: "View order",
    continueToCheckout: "Continue to checkout",
    backToCart: "Back to cart",
    checkoutDetails: "Details and confirmation",
    preorderSelectTimeFirst: "Choose a pickup time before browsing the items available for that slot.",
    close: "Close",
    categoryNavigation: "Menu categories",
    customerName: "Customer name",
    customerNamePlaceholder: "Name (optional)",
    customerNameRequiredPlaceholder: "Enter the customer name",
    customerDetailsRequired: "Enter the customer name and a valid contact phone number.",
    orderNote: "Order notes",
    orderNotePlaceholder: (count) => `Notes (up to ${count} characters)`,
    itemCount: (count) => `${count} item${count === 1 ? "" : "s"}`,
    securityVerification: "Security verification",
    securityNotConfigured: "Security verification is not configured.",
    securityRequired: "Complete the security check first.",
    selectAtLeastOne: "Select at least one item.",
    sessionExpired: "Your ordering session has expired. Scan the QR code again.",
    requiredNotes: (product) => `Complete the required options for “${product}”.`,
    orderSubmitError: "Unable to submit your order right now.",
    networkError: "The network connection was interrupted. Try again shortly.",
    submitting: "Submitting...",
    submitOrder: "Place order",
    saveOrderChanges: "Save order changes",
    confirmationNotice: "Staff must confirm your order before preparation begins.",
    editConfirmationNotice: "Staff must reconfirm changes. Changes are blocked once preparation or printing starts.",
    preorderPickupTime: "Scheduled pickup time", optionalDeliveryTime: "Delivery time (optional)", optionalPickupTime: "Pickup time (optional)", applyPickupTimeRequired: "Apply the pickup time before continuing.", selectPreorderTimeRequired: "Choose a pickup time first.", scheduledDeliveryTime: "Delivery time", scheduledPickupTime: "Pickup time", preorderPickupDate: "Pickup date", deliveryDate: "Delivery date", pickupDate: "Pickup date", deliveryTime: "Delivery time", pickupTime: "Pickup time", unavailableDate: "No available time slots on the selected date.", applyTime: "Apply this time", timeApplied: "Time applied", unappliedTimeNotice: "The new pickup time has not been applied. Applying it updates available items and the cart.", preorderOnlyNotice: "Outside business hours, only scheduled pickup orders are accepted.", preorderTimeGuidance: "Pick up during your selected time slot", applyPreorderTimeGuidance: "Choose and apply a pickup time to see available items.", noProductsForSlot: "No items are available for this time slot. Choose another pickup time.", discountIneligible: "Not eligible for order discount", bundleGroup: "Set group", selectionRange: (minimum, maximum) => `Choose ${minimum}–${maximum}`,
    errors: {
      invalidRequest: "The order details are invalid. Review them and try again.",
      qrUnavailable: "This QR code is unavailable. Please ask a staff member for help.",
      orderingUnavailable: "This stall is not accepting orders right now.",
      capacityPaused: "Order volume is currently high. Ordering is paused; please try again shortly.",
      sessionInvalid: "Your ordering session is no longer valid. Scan the QR code again.",
      rateLimited: "Too many attempts. Please wait and try again.",
      securityFailed: "Security verification failed. Complete the check again.",
      securityUnavailable: "Security verification is temporarily unavailable. Try again shortly.",
      customerDetails: "Enter the customer name and a valid contact phone number.",
      selectionInvalid: "Some product options are incomplete or have changed. Review your selections.",
      orderLimits: "The order exceeds this stall's limits. Adjust it and try again.",
      productUnavailable: "Some products are sold out or unavailable.",
      waitAcknowledgment: "Confirm the current estimated wait before placing your order.",
      pendingLimit: "This device already has too many orders awaiting confirmation.",
      trialOrderLimit: "This trial has reached its order limit. Please ask the merchant for assistance.",
      subscriptionSuspended: "This merchant subscription is suspended and cannot accept new orders.",
      orderFailed: "Unable to create or retrieve the order right now. Try again shortly.",
    },
  },
  ja: {
    localeName: "日本語",
    language: "言語",
    menuLanguage: "メニュー言語",
    sessionLoading: "安全な注文セッションを開始しています...",
    sessionStartError: "現在、注文を開始できません。",
    sessionExpiringTitle: "まもなく期限切れです",
    sessionExpiringDescription: "注文を続けるには更新してください。カートに追加済みの商品は保持されます。",
    sessionExpiredTitle: "期限切れです",
    sessionExpiredRefreshDescription: "更新して新しい安全なセッションを開始してください。カートの商品は保持されます。",
    refreshSession: "更新して注文を続ける",
    lotteryRegionLabel: "おすすめ抽選",
    lotterySectionTitle: "何を注文するか迷ったら抽選",
    lotterySectionDescription: "過去30日間の完了注文の人気傾向をもとに、ほかの商品も発見できるようおすすめします。会計割引は別に抽選されます。",
    lotterySpendProgress: (amount) => `あと${amount}で無料メニュー抽選を1回利用できます。`,
    lotteryStart: "抽選を始める",
    lotteryDrawingButton: "抽選中…",
    lotteryAlreadyDrawn: "本日は抽選済み",
    lotteryDrawingTitle: "おすすめを抽選中",
    lotteryDrawingDescription: "本日注文できる商品の中からおすすめを選んでいます。",
    lotteryResultTitle: "今日のおすすめ",
    lotteryBestSellerBasis: "人気商品",
    lotteryDiscoveryBasis: "新しいおすすめ",
    lotteryRecommendation: (product) => `「${product}」がおすすめです`,
    lotteryFreeRewardResult: (product) => `おめでとうございます。「${product}」1点が無料で当たりました！`,
    lotteryFreeRewardNotice: "注文送信時に0円の景品として自動追加されます。カートに追加する必要はありません。",
    lotteryDiscountResult: (discount) => `${discount}も当たりました！`,
    lotteryNoDiscountResult: "今回は割引が当たりませんでした。",
    lotteryDiscountNotice: "割引は「注文割引対象外」と表示されていない商品にのみ適用されます。",
    lotteryAccept: "おすすめを選ぶ",
    lotteryFreeRewardAccept: "無料商品を受け取る",
    lotteryCancel: "キャンセル",
    lotteryDailyLimitTitle: "このブラウザでは本日すでに抽選済みです",
    lotteryDailyLimitDescription: "同じブラウザデータでは1日1回のみ抽選できます。本日の商品と割引結果は保存され、明日また抽選できます。",
    lotteryAcknowledge: "確認しました",
    lotteryUnavailable: "現在、抽選をご利用いただけません。",
    lotteryUnavailableProduct: "抽選された商品は現在ご注文いただけません。しばらくしてからお試しください。",
    lotteryNotEligible: "この注文はまだ無料抽選の条件を満たしていません。",
    hotSellerBadge: "人気",
    qrUnavailableTitle: "このQRコードは現在ご利用いただけません",
    degradedTitle: "オンライン注文は一時的にご利用いただけません",
    degradedMessage: "メニューは引き続きご覧いただけます。ご注文は売り場カウンターにてお願いいたします。",
    retryAvailability: "再確認",
    dineIn: (table) => `店内 · ${table}`,
    takeout: "テイクアウト",
    timeRemaining: (minutes, seconds) => `注文可能時間 残り ${minutes}:${seconds}`,
    estimatedWait: (minutes) => minutes > 0 ? `現在の待ち時間目安：約${minutes}分` : "ただいますぐに調理可能です",
    estimatedWaitRange: (minimum, maximum) => minimum === maximum
      ? `現在の待ち時間目安：約${maximum}分`
      : `現在の待ち時間目安：${minimum}～${maximum}分`,
    waitAcknowledgment: (minimum, maximum) => `待ち時間の目安が${minimum === maximum ? `${maximum}` : `${minimum}～${maximum}`}分であることを確認しました。`,
    waitAcknowledgmentRequired: "待ち時間の目安をご確認ください。",
    lastTableOrder: (time) => `このテーブルの最終追加注文：${time}`,
    cartRestored: "未送信のカート内容を復元しました。",
    productImage: (name) => `${name}の画像`,
    decrease: (name) => `${name}を減らす`,
    increase: (name) => `${name}を増やす`,
    addToCart: "カートに追加",
    editCartItem: "オプションを変更",
    finishEditingCartItem: "変更を保存",
    removeCartItem: "削除",
    cartProductQuantity: (count) => `カートに${count}点`,
    additionalQuantity: "追加",
    backToTop: "ページ上部へ戻る",
    quantityLimit: "この店舗の注文数量上限に達しました。",
    singleChoice: "1つ選択",
    multipleChoice: "複数選択",
    maxSelections: (count) => `最大${count}個`,
    noSelection: "選択しない",
    yourOrder: "ご注文",
    viewOrder: "注文内容を見る",
    continueToCheckout: "注文情報の入力へ進む",
    backToCart: "カートに戻る",
    checkoutDetails: "注文情報と確認",
    preorderSelectTimeFirst: "受取時間を先に確認してから、その時間帯に注文できる商品をご覧ください。",
    close: "閉じる",
    categoryNavigation: "メニューカテゴリー",
    customerName: "お名前",
    customerNamePlaceholder: "お名前（任意）",
    customerNameRequiredPlaceholder: "お名前を入力してください",
    customerDetailsRequired: "お名前と有効な連絡先電話番号を入力してください。",
    orderNote: "注文メモ",
    orderNotePlaceholder: (count) => `メモ（最大${count}文字）`,
    itemCount: (count) => `合計${count}点`,
    securityVerification: "セキュリティ認証",
    securityNotConfigured: "セキュリティ認証が設定されていません。",
    securityRequired: "セキュリティ認証を完了してください。",
    selectAtLeastOne: "商品を1点以上選択してください。",
    sessionExpired: "注文セッションの有効期限が切れました。QRコードを再度読み取ってください。",
    requiredNotes: (product) => `「${product}」の必須オプションを選択してください。`,
    orderSubmitError: "現在、ご注文を送信できません。",
    networkError: "ネットワーク接続が中断されました。しばらくしてから再度お試しください。",
    submitting: "送信中...",
    submitOrder: "注文を送信",
    saveOrderChanges: "注文変更を保存",
    confirmationNotice: "送信後、スタッフの確認が完了するまで調理は開始されません。",
    editConfirmationNotice: "変更後はスタッフの再確認が必要です。調理または印刷開始後は変更できません。",
    preorderPickupTime: "予約受取時間", optionalDeliveryTime: "配達時間（任意）", optionalPickupTime: "受取時間（任意）", applyPickupTimeRequired: "受取時間を適用してください。", selectPreorderTimeRequired: "先に受取時間を選択してください。", scheduledDeliveryTime: "配達時間", scheduledPickupTime: "受取時間", preorderPickupDate: "受取日", deliveryDate: "配達日", pickupDate: "受取日", deliveryTime: "配達時間", pickupTime: "受取時間", unavailableDate: "選択した日に利用可能な時間帯がありません。", applyTime: "この時間を適用", timeApplied: "適用済み", unappliedTimeNotice: "新しい受取時間は未適用です。適用すると商品とカートが更新されます。", preorderOnlyNotice: "営業時間外は予約受取のみ受け付けています。", preorderTimeGuidance: "選択した時間帯にお受け取りください", applyPreorderTimeGuidance: "受取時間を選択して適用すると、注文可能な商品が表示されます。", noProductsForSlot: "この時間帯に予約できる商品はありません。別の時間を選択してください。", discountIneligible: "注文割引対象外", bundleGroup: "セットグループ", selectionRange: (minimum, maximum) => `${minimum}～${maximum}品を選択`,
    errors: {
      invalidRequest: "注文内容が正しくありません。確認して再度お試しください。",
      qrUnavailable: "このQRコードはご利用いただけません。スタッフにお尋ねください。",
      orderingUnavailable: "この店舗は現在注文を受け付けていません。",
      capacityPaused: "現在注文が集中しているため、受付を一時停止しています。しばらくしてからお試しください。",
      sessionInvalid: "注文セッションが無効です。QRコードを再度読み取ってください。",
      rateLimited: "操作回数が多すぎます。しばらくしてから再度お試しください。",
      securityFailed: "セキュリティ認証に失敗しました。もう一度認証してください。",
      securityUnavailable: "セキュリティ認証を一時的に利用できません。しばらくしてからお試しください。",
      customerDetails: "お名前と有効な連絡先電話番号を入力してください。",
      selectionInvalid: "商品のオプションが未選択、または変更されています。選択内容をご確認ください。",
      orderLimits: "注文内容が店舗の上限を超えています。数量を調整してください。",
      productUnavailable: "一部の商品は売り切れ、または提供できません。",
      waitAcknowledgment: "現在の待ち時間の目安を確認してから注文を送信してください。",
      pendingLimit: "この端末には確認待ちの注文が多すぎます。",
      trialOrderLimit: "トライアルの注文上限に達しました。店舗スタッフにお問い合わせください。",
      subscriptionSuspended: "店舗の契約が停止中のため、新しい注文を受け付けられません。",
      orderFailed: "現在、注文を作成または確認できません。しばらくしてからお試しください。",
    },
  },
  ko: {
    localeName: "한국어",
    language: "언어",
    menuLanguage: "메뉴 언어",
    sessionLoading: "안전한 주문 세션을 시작하는 중입니다...",
    sessionStartError: "현재 주문을 시작할 수 없습니다.",
    sessionExpiringTitle: "곧 만료됩니다",
    sessionExpiringDescription: "계속 주문하려면 새로고침하세요. 장바구니에 담은 항목은 유지됩니다.",
    sessionExpiredTitle: "만료되었습니다",
    sessionExpiredRefreshDescription: "새 보안 세션을 시작하려면 새로고침하세요. 장바구니 항목은 유지됩니다.",
    refreshSession: "새로고침하고 주문 계속하기",
    lotteryRegionLabel: "추천 추첨",
    lotterySectionTitle: "무엇을 주문할지 고민되나요? 뽑아 드릴게요",
    lotterySectionDescription: "최근 30일 완료 주문의 인기 추세를 바탕으로 추천하며 다른 메뉴를 발견할 기회도 제공합니다. 결제 할인은 별도로 추첨됩니다.",
    lotterySpendProgress: (amount) => `${amount} 더 주문하면 무료 메뉴 추첨 1회를 받을 수 있습니다.`,
    lotteryStart: "추첨 시작",
    lotteryDrawingButton: "추첨 중…",
    lotteryAlreadyDrawn: "오늘 추첨 완료",
    lotteryDrawingTitle: "추천 메뉴를 고르는 중",
    lotteryDrawingDescription: "오늘 주문 가능한 메뉴에서 추천 항목을 찾고 있습니다.",
    lotteryResultTitle: "오늘의 추천",
    lotteryBestSellerBasis: "인기 추천",
    lotteryDiscoveryBasis: "새로운 메뉴 추천",
    lotteryRecommendation: (product) => `“${product}”을(를) 추천합니다`,
    lotteryFreeRewardResult: (product) => `축하합니다! “${product}” 1개를 무료로 받았습니다.`,
    lotteryFreeRewardNotice: "주문 전송 시 0원 증정품으로 자동 추가됩니다. 장바구니에 다시 담지 마세요.",
    lotteryDiscountResult: (discount) => `${discount}도 당첨되었습니다!`,
    lotteryNoDiscountResult: "이번에는 할인에 당첨되지 않았습니다.",
    lotteryDiscountNotice: "할인은 ‘주문 할인 제외’로 표시되지 않은 상품에만 적용됩니다.",
    lotteryAccept: "추천 수락",
    lotteryFreeRewardAccept: "무료 메뉴 받기",
    lotteryCancel: "취소",
    lotteryDailyLimitTitle: "이 브라우저는 오늘 이미 추첨했습니다",
    lotteryDailyLimitDescription: "동일한 브라우저 데이터에서는 하루 한 번만 추첨할 수 있습니다. 오늘의 상품과 할인 결과는 저장되며 내일 다시 추첨할 수 있습니다.",
    lotteryAcknowledge: "확인",
    lotteryUnavailable: "현재 추첨을 이용할 수 없습니다.",
    lotteryUnavailableProduct: "추첨된 상품은 현재 주문할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    lotteryNotEligible: "이 주문은 아직 무료 추첨 조건을 충족하지 않았습니다.",
    hotSellerBadge: "인기",
    qrUnavailableTitle: "현재 이 QR 코드를 사용할 수 없습니다",
    degradedTitle: "온라인 주문을 일시적으로 이용할 수 없습니다",
    degradedMessage: "메뉴는 계속 확인할 수 있습니다. 매장 카운터에서 주문해 주세요.",
    retryAvailability: "다시 확인",
    dineIn: (table) => `매장 식사 · ${table}`,
    takeout: "포장 주문",
    timeRemaining: (minutes, seconds) => `주문 가능 시간 ${minutes}:${seconds}`,
    estimatedWait: (minutes) => minutes > 0 ? `현재 예상 대기 시간: 약 ${minutes}분` : "현재 바로 준비할 수 있습니다",
    estimatedWaitRange: (minimum, maximum) => minimum === maximum
      ? `현재 예상 대기 시간: 약 ${maximum}분`
      : `현재 예상 대기 시간: ${minimum}~${maximum}분`,
    waitAcknowledgment: (minimum, maximum) => `예상 대기 시간이 ${minimum === maximum ? `${maximum}` : `${minimum}~${maximum}`}분임을 확인했습니다.`,
    waitAcknowledgmentRequired: "예상 대기 시간을 먼저 확인해 주세요.",
    lastTableOrder: (time) => `이 테이블의 최근 추가 주문: ${time}`,
    cartRestored: "전송하지 않은 장바구니를 복원했습니다.",
    productImage: (name) => `${name} 이미지`,
    decrease: (name) => `${name} 수량 줄이기`,
    increase: (name) => `${name} 수량 늘리기`,
    addToCart: "장바구니에 담기",
    editCartItem: "옵션 수정",
    finishEditingCartItem: "수정 완료",
    removeCartItem: "삭제",
    cartProductQuantity: (count) => `장바구니에 ${count}개`,
    additionalQuantity: "추가 수량",
    backToTop: "맨 위로",
    quantityLimit: "이 매장의 주문 수량 한도에 도달했습니다.",
    singleChoice: "1개 선택",
    multipleChoice: "복수 선택",
    maxSelections: (count) => `최대 ${count}개`,
    noSelection: "선택 안 함",
    yourOrder: "주문 내역",
    viewOrder: "주문 내역 보기",
    continueToCheckout: "주문 정보 입력하기",
    backToCart: "장바구니로 돌아가기",
    checkoutDetails: "주문 정보 및 확인",
    preorderSelectTimeFirst: "수령 시간을 먼저 확인한 뒤 해당 시간대에 주문 가능한 메뉴를 확인해 주세요.",
    close: "닫기",
    categoryNavigation: "메뉴 카테고리",
    customerName: "고객명",
    customerNamePlaceholder: "이름 (선택)",
    customerNameRequiredPlaceholder: "고객명을 입력해 주세요",
    customerDetailsRequired: "고객명과 올바른 연락처를 입력해 주세요.",
    orderNote: "요청 사항",
    orderNotePlaceholder: (count) => `요청 사항 (최대 ${count}자)`,
    itemCount: (count) => `총 ${count}개`,
    securityVerification: "보안 인증",
    securityNotConfigured: "보안 인증이 설정되지 않았습니다.",
    securityRequired: "보안 인증을 완료해 주세요.",
    selectAtLeastOne: "상품을 1개 이상 선택해 주세요.",
    sessionExpired: "주문 세션이 만료되었습니다. QR 코드를 다시 스캔해 주세요.",
    requiredNotes: (product) => `“${product}”의 필수 옵션을 선택해 주세요.`,
    orderSubmitError: "현재 주문을 전송할 수 없습니다.",
    networkError: "네트워크 연결이 끊겼습니다. 잠시 후 다시 시도해 주세요.",
    submitting: "전송 중...",
    submitOrder: "주문하기",
    saveOrderChanges: "주문 변경 저장",
    confirmationNotice: "주문 후 직원이 확인해야 조리가 시작됩니다.",
    editConfirmationNotice: "변경 후 직원의 재확인이 필요하며 조리 또는 인쇄 시작 후에는 변경할 수 없습니다.",
    preorderPickupTime: "예약 수령 시간", optionalDeliveryTime: "배송 시간(선택)", optionalPickupTime: "수령 시간(선택)", applyPickupTimeRequired: "수령 시간을 적용해 주세요.", selectPreorderTimeRequired: "먼저 예약 수령 시간을 선택해 주세요.", scheduledDeliveryTime: "배송 시간", scheduledPickupTime: "수령 시간", preorderPickupDate: "수령 날짜", deliveryDate: "배송 날짜", pickupDate: "수령 날짜", deliveryTime: "배송 시간", pickupTime: "수령 시간", unavailableDate: "선택한 날짜에 이용 가능한 시간이 없습니다.", applyTime: "이 시간 적용", timeApplied: "시간 적용됨", unappliedTimeNotice: "새 수령 시간이 아직 적용되지 않았습니다. 적용하면 상품과 장바구니가 업데이트됩니다.", preorderOnlyNotice: "영업시간 외에는 예약 수령 주문만 받습니다.", preorderTimeGuidance: "선택한 예약 시간에 수령해 주세요", applyPreorderTimeGuidance: "수령 시간을 선택하고 적용하면 주문 가능한 상품이 표시됩니다.", noProductsForSlot: "이 시간에는 예약 가능한 상품이 없습니다. 다른 시간을 선택해 주세요.", discountIneligible: "주문 할인 제외", bundleGroup: "세트 그룹", selectionRange: (minimum, maximum) => `${minimum}–${maximum}개 선택`,
    errors: {
      invalidRequest: "주문 정보가 올바르지 않습니다. 다시 확인해 주세요.",
      qrUnavailable: "이 QR 코드를 사용할 수 없습니다. 직원에게 문의해 주세요.",
      orderingUnavailable: "이 매장은 현재 주문을 받고 있지 않습니다.",
      capacityPaused: "현재 주문이 많아 주문 접수를 잠시 중단했습니다. 잠시 후 다시 시도해 주세요.",
      sessionInvalid: "주문 세션이 유효하지 않습니다. QR 코드를 다시 스캔해 주세요.",
      rateLimited: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      securityFailed: "보안 인증에 실패했습니다. 다시 인증해 주세요.",
      securityUnavailable: "보안 인증을 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      customerDetails: "고객명과 올바른 연락처를 입력해 주세요.",
      selectionInvalid: "상품 옵션이 누락되었거나 변경되었습니다. 선택 내용을 확인해 주세요.",
      orderLimits: "주문 내용이 매장 한도를 초과했습니다. 수량을 조정해 주세요.",
      productUnavailable: "일부 상품이 품절되었거나 주문할 수 없습니다.",
      waitAcknowledgment: "현재 예상 대기 시간을 확인한 후 주문해 주세요.",
      pendingLimit: "이 기기에 확인 대기 중인 주문이 너무 많습니다.",
      trialOrderLimit: "체험 주문 한도에 도달했습니다. 매장 직원에게 문의해 주세요.",
      subscriptionSuspended: "매장 구독이 정지되어 새 주문을 받을 수 없습니다.",
      orderFailed: "현재 주문을 생성하거나 조회할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    },
  },
  vi: {
    localeName: "Tiếng Việt",
    language: "Ngôn ngữ",
    menuLanguage: "Ngôn ngữ thực đơn",
    sessionLoading: "Đang khởi tạo phiên đặt món an toàn...",
    sessionStartError: "Hiện không thể bắt đầu đặt món.",
    sessionExpiringTitle: "Phiên sắp hết hạn",
    sessionExpiringDescription: "Hãy tải lại để tiếp tục đặt món. Các món đã thêm vào giỏ sẽ được giữ lại.",
    sessionExpiredTitle: "Phiên đã hết hạn",
    sessionExpiredRefreshDescription: "Hãy tải lại để bắt đầu phiên bảo mật mới. Các món trong giỏ sẽ được giữ lại.",
    refreshSession: "Tải lại và tiếp tục đặt món",
    lotteryRegionLabel: "Gợi ý vòng quay",
    lotterySectionTitle: "Chưa biết gọi món gì? Để chúng tôi chọn",
    lotterySectionDescription: "Gợi ý dựa trên xu hướng đơn hoàn tất trong 30 ngày qua, đồng thời giúp bạn khám phá món khác. Ưu đãi thanh toán được quay riêng.",
    lotterySpendProgress: (amount) => `Mua thêm ${amount} để nhận một lượt quay món miễn phí.`,
    lotteryStart: "Bắt đầu quay",
    lotteryDrawingButton: "Đang quay…",
    lotteryAlreadyDrawn: "Đã quay hôm nay",
    lotteryDrawingTitle: "Đang chọn món cho bạn",
    lotteryDrawingDescription: "Chúng tôi đang chọn một món từ các món hiện có hôm nay.",
    lotteryResultTitle: "Gợi ý hôm nay",
    lotteryBestSellerBasis: "Món bán chạy",
    lotteryDiscoveryBasis: "Gợi ý khám phá",
    lotteryRecommendation: (product) => `Chúng tôi gợi ý “${product}”`,
    lotteryFreeRewardResult: (product) => `Chúc mừng! Bạn nhận miễn phí một phần “${product}”.`,
    lotteryFreeRewardNotice: "Món tặng sẽ tự động được thêm với giá 0 khi gửi đơn. Không cần thêm lại vào giỏ.",
    lotteryDiscountResult: (discount) => `Bạn còn trúng ${discount}!`,
    lotteryNoDiscountResult: "Lần này bạn chưa trúng ưu đãi.",
    lotteryDiscountNotice: "Ưu đãi chỉ áp dụng cho món không được đánh dấu loại trừ giảm giá đơn hàng.",
    lotteryAccept: "Chọn món gợi ý",
    lotteryFreeRewardAccept: "Nhận món miễn phí",
    lotteryCancel: "Hủy",
    lotteryDailyLimitTitle: "Trình duyệt này đã quay hôm nay",
    lotteryDailyLimitDescription: "Mỗi dữ liệu trình duyệt chỉ được quay một lần mỗi ngày. Kết quả món và ưu đãi hôm nay đã được lưu; bạn có thể quay lại vào ngày mai.",
    lotteryAcknowledge: "Đã hiểu",
    lotteryUnavailable: "Vòng quay hiện không khả dụng.",
    lotteryUnavailableProduct: "Món được chọn hiện không khả dụng. Vui lòng thử lại sau.",
    lotteryNotEligible: "Đơn này chưa đủ điều kiện quay miễn phí.",
    hotSellerBadge: "Bán chạy",
    qrUnavailableTitle: "Mã QR này hiện không khả dụng",
    degradedTitle: "Tạm thời không thể gửi đơn trực tuyến",
    degradedMessage: "Bạn vẫn có thể xem thực đơn. Vui lòng gọi món tại quầy.",
    retryAvailability: "Kiểm tra lại",
    dineIn: (table) => `Dùng tại chỗ · ${table}`,
    takeout: "Mang đi",
    timeRemaining: (minutes, seconds) => `Thời gian đặt món còn lại ${minutes}:${seconds}`,
    estimatedWait: (minutes) => minutes > 0 ? `Thời gian chờ dự kiến: khoảng ${minutes} phút` : "Có thể chuẩn bị ngay",
    estimatedWaitRange: (minimum, maximum) => minimum === maximum
      ? `Thời gian chờ dự kiến: khoảng ${maximum} phút`
      : `Thời gian chờ dự kiến: ${minimum}–${maximum} phút`,
    waitAcknowledgment: (minimum, maximum) => `Tôi xác nhận thời gian chờ dự kiến là ${minimum === maximum ? `${maximum}` : `${minimum}–${maximum}`} phút.`,
    waitAcknowledgmentRequired: "Vui lòng xác nhận thời gian chờ dự kiến.",
    lastTableOrder: (time) => `Lần gọi thêm gần nhất của bàn này: ${time}`,
    cartRestored: "Đã khôi phục giỏ hàng chưa gửi.",
    productImage: (name) => `Hình ảnh ${name}`,
    decrease: (name) => `Giảm ${name}`,
    increase: (name) => `Tăng ${name}`,
    addToCart: "Thêm vào giỏ",
    editCartItem: "Sửa tùy chọn",
    finishEditingCartItem: "Lưu thay đổi",
    removeCartItem: "Xóa",
    cartProductQuantity: (count) => `Đã có ${count} phần trong giỏ`,
    additionalQuantity: "Thêm",
    backToTop: "Về đầu trang",
    quantityLimit: "Bạn đã đạt giới hạn số lượng đặt món của quầy.",
    singleChoice: "Chọn một",
    multipleChoice: "Chọn nhiều",
    maxSelections: (count) => `Tối đa ${count} lựa chọn`,
    noSelection: "Không chọn",
    yourOrder: "Đơn hàng của bạn",
    viewOrder: "Xem đơn hàng",
    continueToCheckout: "Tiếp tục nhập thông tin",
    backToCart: "Quay lại giỏ hàng",
    checkoutDetails: "Thông tin và xác nhận",
    preorderSelectTimeFirst: "Hãy xác nhận giờ nhận trước, rồi xem các món có thể đặt trong khung giờ đó.",
    close: "Đóng",
    categoryNavigation: "Danh mục món",
    customerName: "Tên khách hàng",
    customerNamePlaceholder: "Tên (không bắt buộc)",
    customerNameRequiredPlaceholder: "Nhập tên khách hàng",
    customerDetailsRequired: "Vui lòng nhập tên khách hàng và số điện thoại liên hệ hợp lệ.",
    orderNote: "Ghi chú đơn hàng",
    orderNotePlaceholder: (count) => `Ghi chú (tối đa ${count} ký tự)`,
    itemCount: (count) => `Tổng ${count} món`,
    securityVerification: "Xác minh bảo mật",
    securityNotConfigured: "Chưa cấu hình dịch vụ xác minh bảo mật.",
    securityRequired: "Vui lòng hoàn tất bước xác minh bảo mật.",
    selectAtLeastOne: "Vui lòng chọn ít nhất một món.",
    sessionExpired: "Phiên đặt món đã hết hạn. Vui lòng quét lại mã QR.",
    requiredNotes: (product) => `Vui lòng chọn đầy đủ tùy chọn bắt buộc cho “${product}”.`,
    orderSubmitError: "Hiện không thể gửi đơn hàng.",
    networkError: "Kết nối mạng bị gián đoạn. Vui lòng thử lại sau.",
    submitting: "Đang gửi...",
    submitOrder: "Gửi đơn hàng",
    saveOrderChanges: "Lưu thay đổi đơn hàng",
    confirmationNotice: "Nhân viên phải xác nhận đơn trước khi bắt đầu chế biến.",
    editConfirmationNotice: "Nhân viên phải xác nhận lại thay đổi. Không thể sửa sau khi chế biến hoặc in phiếu đã bắt đầu.",
    preorderPickupTime: "Giờ nhận món đã hẹn", optionalDeliveryTime: "Giờ giao (không bắt buộc)", optionalPickupTime: "Giờ nhận (không bắt buộc)", applyPickupTimeRequired: "Vui lòng áp dụng giờ nhận món trước.", selectPreorderTimeRequired: "Vui lòng chọn giờ nhận món trước.", scheduledDeliveryTime: "Giờ giao", scheduledPickupTime: "Giờ nhận", preorderPickupDate: "Ngày nhận", deliveryDate: "Ngày giao", pickupDate: "Ngày nhận", deliveryTime: "Giờ giao", pickupTime: "Giờ nhận", unavailableDate: "Ngày đã chọn không có khung giờ khả dụng.", applyTime: "Áp dụng giờ này", timeApplied: "Đã áp dụng", unappliedTimeNotice: "Giờ nhận mới chưa được áp dụng. Sau khi áp dụng, món và giỏ hàng sẽ được cập nhật.", preorderOnlyNotice: "Ngoài giờ mở cửa, chỉ nhận đơn tự đến lấy theo lịch hẹn.", preorderTimeGuidance: "Vui lòng nhận món theo khung giờ đã chọn", applyPreorderTimeGuidance: "Chọn và áp dụng giờ nhận để xem món có thể đặt.", noProductsForSlot: "Khung giờ này không có món để đặt trước. Vui lòng chọn giờ khác.", discountIneligible: "Không áp dụng giảm giá đơn", bundleGroup: "Nhóm combo", selectionRange: (minimum, maximum) => `Chọn ${minimum}–${maximum} món`,
    errors: {
      invalidRequest: "Thông tin đơn hàng không hợp lệ. Vui lòng kiểm tra lại.",
      qrUnavailable: "Mã QR này không khả dụng. Vui lòng liên hệ nhân viên.",
      orderingUnavailable: "Quầy hiện không nhận đơn hàng.",
      capacityPaused: "Hiện có nhiều đơn hàng nên quầy tạm ngừng nhận đơn. Vui lòng thử lại sau.",
      sessionInvalid: "Phiên đặt món không còn hiệu lực. Vui lòng quét lại mã QR.",
      rateLimited: "Bạn thao tác quá thường xuyên. Vui lòng thử lại sau.",
      securityFailed: "Xác minh bảo mật thất bại. Vui lòng xác minh lại.",
      securityUnavailable: "Tính năng xác minh bảo mật tạm thời không khả dụng. Vui lòng thử lại sau.",
      customerDetails: "Vui lòng nhập tên khách hàng và số điện thoại liên hệ hợp lệ.",
      selectionInvalid: "Một số tùy chọn món ăn còn thiếu hoặc đã thay đổi. Vui lòng kiểm tra lại.",
      orderLimits: "Đơn hàng vượt quá giới hạn của quầy. Vui lòng điều chỉnh số lượng.",
      productUnavailable: "Một số món đã hết hoặc hiện không phục vụ.",
      waitAcknowledgment: "Vui lòng xác nhận thời gian chờ hiện tại trước khi gửi đơn.",
      pendingLimit: "Thiết bị này đang có quá nhiều đơn chờ xác nhận.",
      trialOrderLimit: "Gói dùng thử đã đạt giới hạn đơn hàng. Vui lòng liên hệ nhân viên cửa hàng.",
      subscriptionSuspended: "Gói đăng ký của cửa hàng đã bị tạm ngưng nên chưa thể nhận đơn mới.",
      orderFailed: "Hiện không thể tạo hoặc tra cứu đơn hàng. Vui lòng thử lại sau.",
    },
  },
  th: {
    localeName: "ไทย",
    language: "ภาษา",
    menuLanguage: "ภาษาเมนู",
    sessionLoading: "กำลังเริ่มเซสชันการสั่งอาหารที่ปลอดภัย...",
    sessionStartError: "ไม่สามารถเริ่มสั่งอาหารได้ในขณะนี้",
    sessionExpiringTitle: "เซสชันใกล้หมดเวลา",
    sessionExpiringDescription: "รีเฟรชเพื่อสั่งอาหารต่อ รายการที่เพิ่มในตะกร้าจะยังคงอยู่",
    sessionExpiredTitle: "เซสชันหมดเวลาแล้ว",
    sessionExpiredRefreshDescription: "รีเฟรชเพื่อเริ่มเซสชันใหม่ รายการในตะกร้าจะยังคงอยู่",
    refreshSession: "รีเฟรชและสั่งอาหารต่อ",
    lotteryRegionLabel: "คำแนะนำจากการสุ่ม",
    lotterySectionTitle: "ยังไม่รู้จะสั่งอะไร? ให้เราสุ่มให้",
    lotterySectionDescription: "คำแนะนำอ้างอิงแนวโน้มคำสั่งซื้อที่เสร็จสมบูรณ์ใน 30 วันที่ผ่านมา และยังเปิดโอกาสให้ค้นพบเมนูอื่น ส่วนลดตอนชำระเงินจะสุ่มแยกต่างหาก",
    lotterySpendProgress: (amount) => `สั่งเพิ่มอีก ${amount} เพื่อรับสิทธิ์สุ่มอาหารฟรี 1 ครั้ง`,
    lotteryStart: "เริ่มสุ่ม",
    lotteryDrawingButton: "กำลังสุ่ม…",
    lotteryAlreadyDrawn: "สุ่มแล้ววันนี้",
    lotteryDrawingTitle: "กำลังเลือกเมนูให้คุณ",
    lotteryDrawingDescription: "เรากำลังเลือกเมนูแนะนำจากรายการที่สั่งได้วันนี้",
    lotteryResultTitle: "เมนูแนะนำวันนี้",
    lotteryBestSellerBasis: "เมนูยอดนิยม",
    lotteryDiscoveryBasis: "เมนูน่าลอง",
    lotteryRecommendation: (product) => `เราแนะนำ “${product}”`,
    lotteryFreeRewardResult: (product) => `ยินดีด้วย คุณได้รับ “${product}” ฟรี 1 รายการ!`,
    lotteryFreeRewardNotice: "ของรางวัลจะถูกเพิ่มในคำสั่งซื้อนี้อัตโนมัติในราคา 0 เมื่อส่งคำสั่งซื้อ ไม่ต้องเพิ่มลงตะกร้าอีก",
    lotteryDiscountResult: (discount) => `คุณยังได้รับ ${discount} ด้วย!`,
    lotteryNoDiscountResult: "ครั้งนี้ไม่ได้รับส่วนลด",
    lotteryDiscountNotice: "ส่วนลดใช้ได้เฉพาะสินค้าที่ไม่ได้ระบุว่าไม่ร่วมส่วนลดคำสั่งซื้อ",
    lotteryAccept: "รับคำแนะนำ",
    lotteryFreeRewardAccept: "รับอาหารฟรี",
    lotteryCancel: "ยกเลิก",
    lotteryDailyLimitTitle: "เบราว์เซอร์นี้สุ่มไปแล้ววันนี้",
    lotteryDailyLimitDescription: "ข้อมูลเบราว์เซอร์เดียวกันสุ่มได้วันละครั้ง ผลสินค้าและส่วนลดของวันนี้ถูกบันทึกไว้แล้ว และสามารถสุ่มใหม่ได้พรุ่งนี้",
    lotteryAcknowledge: "เข้าใจแล้ว",
    lotteryUnavailable: "ขณะนี้ไม่สามารถใช้การสุ่มได้",
    lotteryUnavailableProduct: "สินค้าที่สุ่มได้ไม่พร้อมจำหน่ายในขณะนี้ โปรดลองอีกครั้งภายหลัง",
    lotteryNotEligible: "คำสั่งซื้อนี้ยังไม่ผ่านเงื่อนไขการสุ่มฟรี",
    hotSellerBadge: "ขายดี",
    qrUnavailableTitle: "ไม่สามารถใช้ QR Code นี้ได้ในขณะนี้",
    degradedTitle: "ไม่สามารถส่งคำสั่งซื้อออนไลน์ได้ชั่วคราว",
    degradedMessage: "คุณยังดูเมนูได้ โปรดสั่งอาหารที่เคาน์เตอร์ของร้าน",
    retryAvailability: "ตรวจสอบอีกครั้ง",
    dineIn: (table) => `รับประทานที่ร้าน · ${table}`,
    takeout: "สั่งกลับบ้าน",
    timeRemaining: (minutes, seconds) => `เวลาสั่งอาหารคงเหลือ ${minutes}:${seconds}`,
    estimatedWait: (minutes) => minutes > 0 ? `เวลารอโดยประมาณ ${minutes} นาที` : "สามารถเริ่มเตรียมได้ทันที",
    estimatedWaitRange: (minimum, maximum) => minimum === maximum
      ? `เวลารอโดยประมาณ ${maximum} นาที`
      : `เวลารอโดยประมาณ ${minimum}–${maximum} นาที`,
    waitAcknowledgment: (minimum, maximum) => `ฉันรับทราบว่าเวลารอโดยประมาณคือ ${minimum === maximum ? `${maximum}` : `${minimum}–${maximum}`} นาที`,
    waitAcknowledgmentRequired: "โปรดยืนยันเวลารอโดยประมาณก่อนส่งคำสั่งซื้อ",
    lastTableOrder: (time) => `เวลาสั่งเพิ่มล่าสุดของโต๊ะนี้: ${time}`,
    cartRestored: "กู้คืนรายการในตะกร้าที่ยังไม่ได้ส่งแล้ว",
    productImage: (name) => `รูปภาพ ${name}`,
    decrease: (name) => `ลดจำนวน ${name}`,
    increase: (name) => `เพิ่มจำนวน ${name}`,
    addToCart: "เพิ่มลงตะกร้า",
    editCartItem: "แก้ไขตัวเลือก",
    finishEditingCartItem: "บันทึกการแก้ไข",
    removeCartItem: "ลบ",
    cartProductQuantity: (count) => `มี ${count} รายการในตะกร้า`,
    additionalQuantity: "เพิ่มอีก",
    backToTop: "กลับไปด้านบน",
    quantityLimit: "ถึงขีดจำกัดจำนวนการสั่งซื้อของร้านแล้ว",
    singleChoice: "เลือก 1 รายการ",
    multipleChoice: "เลือกได้หลายรายการ",
    maxSelections: (count) => `เลือกได้สูงสุด ${count} รายการ`,
    noSelection: "ไม่เลือก",
    yourOrder: "รายการสั่งซื้อของคุณ",
    viewOrder: "ดูรายการสั่งซื้อ",
    continueToCheckout: "กรอกข้อมูลการสั่งซื้อต่อ",
    backToCart: "กลับไปที่ตะกร้า",
    checkoutDetails: "ข้อมูลและการยืนยันคำสั่งซื้อ",
    preorderSelectTimeFirst: "โปรดยืนยันเวลารับอาหารก่อน แล้วจึงดูเมนูที่สั่งได้ในช่วงเวลานั้น",
    close: "ปิด",
    categoryNavigation: "หมวดหมู่เมนู",
    customerName: "ชื่อลูกค้า",
    customerNamePlaceholder: "ชื่อ (ไม่บังคับ)",
    customerNameRequiredPlaceholder: "กรอกชื่อลูกค้า",
    customerDetailsRequired: "กรุณากรอกชื่อลูกค้าและหมายเลขโทรศัพท์ติดต่อที่ถูกต้อง",
    orderNote: "หมายเหตุคำสั่งซื้อ",
    orderNotePlaceholder: (count) => `หมายเหตุ (สูงสุด ${count} ตัวอักษร)`,
    itemCount: (count) => `รวม ${count} รายการ`,
    securityVerification: "การยืนยันความปลอดภัย",
    securityNotConfigured: "ยังไม่ได้ตั้งค่าระบบยืนยันความปลอดภัย",
    securityRequired: "โปรดยืนยันความปลอดภัยให้เสร็จสิ้น",
    selectAtLeastOne: "โปรดเลือกสินค้าอย่างน้อย 1 รายการ",
    sessionExpired: "เซสชันการสั่งซื้อหมดอายุ โปรดสแกน QR Code อีกครั้ง",
    requiredNotes: (product) => `โปรดเลือกตัวเลือกที่จำเป็นสำหรับ “${product}” ให้ครบ`,
    orderSubmitError: "ไม่สามารถส่งคำสั่งซื้อได้ในขณะนี้",
    networkError: "การเชื่อมต่อเครือข่ายขัดข้อง โปรดลองอีกครั้งในภายหลัง",
    submitting: "กำลังส่ง...",
    submitOrder: "ส่งคำสั่งซื้อ",
    saveOrderChanges: "บันทึกการแก้ไขคำสั่งซื้อ",
    confirmationNotice: "พนักงานต้องยืนยันคำสั่งซื้อก่อนจึงจะเริ่มเตรียมอาหาร",
    editConfirmationNotice: "พนักงานต้องยืนยันการแก้ไขอีกครั้ง และจะไม่สามารถแก้ไขได้เมื่อเริ่มเตรียมหรือพิมพ์แล้ว",
    preorderPickupTime: "เวลารับอาหารที่จอง", optionalDeliveryTime: "เวลาจัดส่ง (ไม่บังคับ)", optionalPickupTime: "เวลารับ (ไม่บังคับ)", applyPickupTimeRequired: "โปรดใช้เวลารับอาหารก่อน", selectPreorderTimeRequired: "โปรดเลือกเวลารับอาหารก่อน", scheduledDeliveryTime: "เวลาจัดส่ง", scheduledPickupTime: "เวลารับ", preorderPickupDate: "วันที่รับ", deliveryDate: "วันที่จัดส่ง", pickupDate: "วันที่รับ", deliveryTime: "เวลาจัดส่ง", pickupTime: "เวลารับ", unavailableDate: "วันที่เลือกไม่มีช่วงเวลาที่รับได้", applyTime: "ใช้เวลานี้", timeApplied: "ใช้เวลาแล้ว", unappliedTimeNotice: "ยังไม่ได้ใช้เวลารับใหม่ เมื่อใช้แล้วสินค้าและตะกร้าจะอัปเดต", preorderOnlyNotice: "นอกเวลาทำการ รับเฉพาะคำสั่งซื้อแบบนัดรับ", preorderTimeGuidance: "โปรดรับอาหารตามช่วงเวลาที่เลือก", applyPreorderTimeGuidance: "เลือกและใช้เวลารับเพื่อดูสินค้าที่สั่งได้", noProductsForSlot: "ช่วงเวลานี้ไม่มีสินค้าที่จองได้ โปรดเลือกเวลาอื่น", discountIneligible: "ไม่ร่วมส่วนลดคำสั่งซื้อ", bundleGroup: "กลุ่มชุด", selectionRange: (minimum, maximum) => `เลือก ${minimum}–${maximum} รายการ`,
    errors: {
      invalidRequest: "ข้อมูลคำสั่งซื้อไม่ถูกต้อง โปรดตรวจสอบอีกครั้ง",
      qrUnavailable: "ไม่สามารถใช้ QR Code นี้ได้ โปรดสอบถามพนักงาน",
      orderingUnavailable: "ร้านยังไม่รับคำสั่งซื้อในขณะนี้",
      capacityPaused: "ขณะนี้มีคำสั่งซื้อจำนวนมาก ร้านจึงหยุดรับออร์เดอร์ชั่วคราว โปรดลองอีกครั้งภายหลัง",
      sessionInvalid: "เซสชันการสั่งซื้อไม่ถูกต้อง โปรดสแกน QR Code อีกครั้ง",
      rateLimited: "มีการทำรายการบ่อยเกินไป โปรดลองอีกครั้งในภายหลัง",
      securityFailed: "การยืนยันความปลอดภัยล้มเหลว โปรดยืนยันอีกครั้ง",
      securityUnavailable: "ระบบยืนยันความปลอดภัยไม่พร้อมใช้งานชั่วคราว โปรดลองอีกครั้งในภายหลัง",
      customerDetails: "กรุณากรอกชื่อลูกค้าและหมายเลขโทรศัพท์ติดต่อที่ถูกต้อง",
      selectionInvalid: "ตัวเลือกสินค้าบางรายการไม่ครบหรือมีการเปลี่ยนแปลง โปรดตรวจสอบอีกครั้ง",
      orderLimits: "คำสั่งซื้อเกินขีดจำกัดของร้าน โปรดปรับจำนวนแล้วลองอีกครั้ง",
      productUnavailable: "สินค้าบางรายการหมดหรือไม่พร้อมจำหน่าย",
      waitAcknowledgment: "โปรดยืนยันเวลารอโดยประมาณก่อนส่งคำสั่งซื้อ",
      pendingLimit: "อุปกรณ์นี้มีคำสั่งซื้อที่รอยืนยันมากเกินไป",
      trialOrderLimit: "คำสั่งซื้อช่วงทดลองใช้ถึงขีดจำกัดแล้ว โปรดติดต่อพนักงานร้าน",
      subscriptionSuspended: "การสมัครใช้บริการของร้านถูกระงับ จึงยังไม่สามารถรับคำสั่งซื้อใหม่ได้",
      orderFailed: "ไม่สามารถสร้างหรือค้นหาคำสั่งซื้อได้ในขณะนี้ โปรดลองอีกครั้งในภายหลัง",
    },
  },
};

const categoryTranslations: Record<string, Partial<Record<QrLocale, string>>> = {
  "炸物": { en: "Deep-fried food", ja: "揚げ物", ko: "튀김", vi: "Món chiên", th: "อาหารทอด" },
  "飲料": { en: "Drinks", ja: "ドリンク", ko: "음료", vi: "Đồ uống", th: "เครื่องดื่ม" },
};

const errorMessageKeys: Record<string, ErrorMessageKey> = {
  ORIGIN_NOT_ALLOWED: "invalidRequest",
  METHOD_NOT_ALLOWED: "invalidRequest",
  REQUEST_TOO_LARGE: "invalidRequest",
  INVALID_JSON: "invalidRequest",
  INVALID_REQUEST: "invalidRequest",
  CLIENT_VERSION_UNSUPPORTED: "sessionInvalid",
  REQUEST_SOURCE_UNAVAILABLE: "orderingUnavailable",
  CIRCUIT_B_UNAVAILABLE: "orderingUnavailable",
  QR_NOT_FOUND: "qrUnavailable",
  QR_REVOKED: "qrUnavailable",
  QR_PAUSED: "qrUnavailable",
  QR_EXPIRED: "qrUnavailable",
  QR_NOT_ACTIVE: "qrUnavailable",
  TABLE_UNAVAILABLE: "qrUnavailable",
  QR_SESSION_MISMATCH: "sessionInvalid",
  QR_ORDERING_DEGRADED: "orderingUnavailable",
  QR_ORDERING_UNAVAILABLE: "orderingUnavailable",
  STALL_CLOSED: "orderingUnavailable",
  STALL_SPECIAL_CLOSURE: "orderingUnavailable",
  ORDERING_PAUSED: "orderingUnavailable",
  STALL_SOLD_OUT: "orderingUnavailable",
  TENANT_INACTIVE: "orderingUnavailable",
  SESSION_NOT_FOUND: "sessionInvalid",
  SESSION_EXPIRED: "sessionInvalid",
  SESSION_REPLAYED: "sessionInvalid",
  SESSION_DEVICE_MISMATCH: "sessionInvalid",
  SESSION_TOKEN_COLLISION: "sessionInvalid",
  RATE_LIMITED: "rateLimited",
  INVALID_TURNSTILE: "securityFailed",
  TURNSTILE_UNAVAILABLE: "securityUnavailable",
  INVALID_CUSTOMER_DETAILS: "customerDetails",
  INVALID_ITEMS: "selectionInvalid",
  TOO_MANY_OR_DUPLICATE_PRODUCTS: "orderLimits",
  EXCESSIVE_TOTAL_QUANTITY: "orderLimits",
  EXCESSIVE_ITEM_QUANTITY: "orderLimits",
  NOTE_TOO_LONG: "orderLimits",
  PRODUCT_UNAVAILABLE: "productUnavailable",
  PRODUCT_CAPACITY_EXCEEDED: "productUnavailable",
  CAPACITY_PAUSED: "capacityPaused",
  LOCATION_UNAVAILABLE: "orderingUnavailable",
  EVENT_NOT_ACTIVE: "orderingUnavailable",
  EVENT_EXPIRED: "orderingUnavailable",
  SCHEDULE_NOT_ACTIVE: "orderingUnavailable",
  SCHEDULE_CLOSED: "orderingUnavailable",
  SCHEDULE_CONTEXT_MISMATCH: "sessionInvalid",
  WAIT_ACKNOWLEDGMENT_REQUIRED: "waitAcknowledgment",
  INVALID_PRODUCT_NOTES: "selectionInvalid",
  INVALID_PRODUCT_BUNDLE: "selectionInvalid",
  PREORDER_DISABLED: "orderingUnavailable",
  PREORDER_TIME_REQUIRED: "selectionInvalid",
  PREORDER_TIME_INVALID: "selectionInvalid",
  PREORDER_TIME_UNAVAILABLE: "orderingUnavailable",
  PREORDER_CONTEXT_UNAVAILABLE: "orderingUnavailable",
  LOTTERY_UNAVAILABLE: "selectionInvalid",
  LOTTERY_RATE_LIMITED: "rateLimited",
  LOTTERY_DRAW_INVALID: "selectionInvalid",
  LOTTERY_DRAW_EXPIRED: "selectionInvalid",
  LOTTERY_ALREADY_REDEEMED: "selectionInvalid",
  IDEMPOTENCY_CONFLICT: "orderFailed",
  TOO_MANY_PENDING_ORDERS: "pendingLimit",
  TRIAL_ORDER_LIMIT_REACHED: "trialOrderLimit",
  TRIAL_EXPIRED: "subscriptionSuspended",
  SUBSCRIPTION_NOT_ACTIVE: "subscriptionSuspended",
  SUBSCRIPTION_SUSPENDED: "subscriptionSuspended",
  FEATURE_NOT_INCLUDED: "orderFailed",
  PLAN_LIMIT_REACHED: "orderFailed",
  ADDITIONAL_STALL_APPROVAL_REQUIRED: "orderFailed",
  ORDER_PACKAGE_REQUIRED: "orderFailed",
  UPGRADE_REQUIRED: "orderFailed",
  LINE_LINK_UNAVAILABLE: "orderFailed",
  LINE_LINK_EXPIRED: "orderFailed",
  LINE_LINK_CONFLICT: "orderFailed",
  REORDER_UNAVAILABLE: "orderFailed",
  ORDER_CONFLICT: "orderFailed",
  ORDER_CREATE_ERROR: "orderFailed",
  ORDER_NOT_FOUND: "orderFailed",
};

export function isQrLocale(value: string): value is QrLocale {
  return QR_LOCALES.includes(value as QrLocale);
}

export function resolvePreferredQrLocale(preferredLocales: readonly string[], supportedLocales: readonly string[]): QrLocale {
  const available = new Set<QrLocale>(["zh-TW"]);
  supportedLocales.forEach((locale) => {
    if (isQrLocale(locale)) available.add(locale);
  });

  for (const preferred of preferredLocales) {
    const normalized = preferred.trim().replaceAll("_", "-").toLowerCase();
    if (!normalized) continue;
    if (normalized === "zh-tw" || normalized.startsWith("zh-hant") || normalized.startsWith("zh-")) {
      return "zh-TW";
    }
    const baseLanguage = normalized.split("-")[0];
    if (isQrLocale(baseLanguage) && available.has(baseLanguage)) return baseLanguage;
  }
  return "zh-TW";
}

export function preserveSupportedQrLocale(
  currentLocale: QrLocale,
  supportedLocales: readonly string[],
) {
  const available = new Set<QrLocale>(["zh-TW"]);
  supportedLocales.forEach((locale) => {
    if (isQrLocale(locale)) available.add(locale);
  });
  return available.has(currentLocale) ? currentLocale : "zh-TW";
}

export function parseQrLocalePreference(raw: string | null): QrLocalePreference | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<QrLocalePreference>;
    if (
      parsed.version !== 2
      || typeof parsed.locale !== "string"
      || !isQrLocale(parsed.locale)
      || (parsed.source !== "manual" && parsed.source !== "query")
    ) return null;
    return {
      version: 2,
      locale: parsed.locale,
      source: parsed.source,
    };
  } catch {
    return null;
  }
}

export function serializeQrLocalePreference(
  locale: QrLocale,
  source: QrLocalePreferenceSource = "manual",
) {
  return JSON.stringify({ version: 2, locale, source } satisfies QrLocalePreference);
}

export function resolveQrUiLocale({
  queryLocale,
  storedPreference,
  legacyLocale,
  appLocale,
}: {
  queryLocale?: string | null;
  storedPreference?: string | null;
  legacyLocale?: string | null;
  appLocale: QrLocale;
}): ResolvedQrUiLocale {
  if (queryLocale && isQrLocale(queryLocale)) {
    return { locale: queryLocale, source: "query", shouldMigrateLegacy: false };
  }

  const preference = parseQrLocalePreference(storedPreference ?? null);
  if (preference) {
    return {
      locale: preference.locale,
      source: preference.source,
      shouldMigrateLegacy: false,
    };
  }

  if (legacyLocale && isQrLocale(legacyLocale)) {
    return { locale: legacyLocale, source: "legacy", shouldMigrateLegacy: true };
  }

  return { locale: appLocale, source: "app", shouldMigrateLegacy: false };
}

export function resolveQrCatalogLocale(
  uiLocale: QrLocale,
  supportedLocales: readonly string[],
): QrLocale {
  return supportedLocales.some((locale) => locale === uiLocale) ? uiLocale : "zh-TW";
}

export function localizedQrCategory(locale: QrLocale, category: string) {
  return categoryTranslations[category]?.[locale] ?? category;
}

export function localizedPublicOrderError(locale: QrLocale, code: string | undefined) {
  const key = code ? errorMessageKeys[code] : undefined;
  return key ? qrOrderMessages[locale].errors[key] : qrOrderMessages[locale].orderSubmitError;
}
