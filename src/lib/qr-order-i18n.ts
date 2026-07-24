export const QR_LOCALES = ["zh-TW", "en", "ja", "ko", "vi", "th"] as const;
export const QR_LOCALE_STORAGE_KEY = "stallorder_qr_locale";

export type QrLocale = (typeof QR_LOCALES)[number];

type ErrorMessageKey =
  | "invalidRequest"
  | "qrUnavailable"
  | "orderingUnavailable"
  | "capacityPaused"
  | "sessionInvalid"
  | "rateLimited"
  | "securityFailed"
  | "securityUnavailable"
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
  qrUnavailableTitle: string;
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
  quantityLimit: string;
  singleChoice: string;
  multipleChoice: string;
  maxSelections: (count: number) => string;
  noSelection: string;
  yourOrder: string;
  viewOrder: string;
  close: string;
  categoryNavigation: string;
  customerName: string;
  customerNamePlaceholder: string;
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
  confirmationNotice: string;
  errors: Record<ErrorMessageKey, string>;
};

export const qrOrderMessages: Record<QrLocale, QrOrderMessages> = {
  "zh-TW": {
    localeName: "繁體中文",
    language: "語言",
    menuLanguage: "點餐語言",
    sessionLoading: "正在建立安全點餐工作階段...",
    sessionStartError: "目前無法開始點餐。",
    qrUnavailableTitle: "目前無法使用此 QR Code",
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
    quantityLimit: "已達本攤位的點餐數量限制。",
    singleChoice: "單選",
    multipleChoice: "複選",
    maxSelections: (count) => `最多 ${count} 項`,
    noSelection: "不選擇",
    yourOrder: "您的訂單",
    viewOrder: "查看訂單",
    close: "關閉",
    categoryNavigation: "商品分類",
    customerName: "顧客稱呼",
    customerNamePlaceholder: "稱呼（選填）",
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
    confirmationNotice: "送出後須由店員確認，確認前不會開始製作。",
    errors: {
      invalidRequest: "訂單資料不正確，請重新確認。",
      qrUnavailable: "此 QR Code 目前無法使用，請洽詢店員。",
      orderingUnavailable: "攤位目前暫停或關閉點餐。",
      capacityPaused: "目前訂單較多，暫停接單，請稍後再試。",
      sessionInvalid: "點餐工作階段已失效，請重新掃描 QR Code。",
      rateLimited: "操作過於頻繁，請稍後再試。",
      securityFailed: "安全驗證失敗，請重新完成驗證。",
      securityUnavailable: "安全驗證暫時無法使用，請稍後再試。",
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
    qrUnavailableTitle: "This QR code is currently unavailable",
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
    quantityLimit: "You have reached this stall's ordering limit.",
    singleChoice: "Choose one",
    multipleChoice: "Choose multiple",
    maxSelections: (count) => `Up to ${count}`,
    noSelection: "None",
    yourOrder: "Your order",
    viewOrder: "View order",
    close: "Close",
    categoryNavigation: "Menu categories",
    customerName: "Customer name",
    customerNamePlaceholder: "Name (optional)",
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
    confirmationNotice: "Staff must confirm your order before preparation begins.",
    errors: {
      invalidRequest: "The order details are invalid. Review them and try again.",
      qrUnavailable: "This QR code is unavailable. Please ask a staff member for help.",
      orderingUnavailable: "This stall is not accepting orders right now.",
      capacityPaused: "Order volume is currently high. Ordering is paused; please try again shortly.",
      sessionInvalid: "Your ordering session is no longer valid. Scan the QR code again.",
      rateLimited: "Too many attempts. Please wait and try again.",
      securityFailed: "Security verification failed. Complete the check again.",
      securityUnavailable: "Security verification is temporarily unavailable. Try again shortly.",
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
    qrUnavailableTitle: "このQRコードは現在ご利用いただけません",
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
    quantityLimit: "この店舗の注文数量上限に達しました。",
    singleChoice: "1つ選択",
    multipleChoice: "複数選択",
    maxSelections: (count) => `最大${count}個`,
    noSelection: "選択しない",
    yourOrder: "ご注文",
    viewOrder: "注文内容を見る",
    close: "閉じる",
    categoryNavigation: "メニューカテゴリー",
    customerName: "お名前",
    customerNamePlaceholder: "お名前（任意）",
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
    confirmationNotice: "送信後、スタッフの確認が完了するまで調理は開始されません。",
    errors: {
      invalidRequest: "注文内容が正しくありません。確認して再度お試しください。",
      qrUnavailable: "このQRコードはご利用いただけません。スタッフにお尋ねください。",
      orderingUnavailable: "この店舗は現在注文を受け付けていません。",
      capacityPaused: "現在注文が集中しているため、受付を一時停止しています。しばらくしてからお試しください。",
      sessionInvalid: "注文セッションが無効です。QRコードを再度読み取ってください。",
      rateLimited: "操作回数が多すぎます。しばらくしてから再度お試しください。",
      securityFailed: "セキュリティ認証に失敗しました。もう一度認証してください。",
      securityUnavailable: "セキュリティ認証を一時的に利用できません。しばらくしてからお試しください。",
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
    qrUnavailableTitle: "현재 이 QR 코드를 사용할 수 없습니다",
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
    quantityLimit: "이 매장의 주문 수량 한도에 도달했습니다.",
    singleChoice: "1개 선택",
    multipleChoice: "복수 선택",
    maxSelections: (count) => `최대 ${count}개`,
    noSelection: "선택 안 함",
    yourOrder: "주문 내역",
    viewOrder: "주문 내역 보기",
    close: "닫기",
    categoryNavigation: "메뉴 카테고리",
    customerName: "고객명",
    customerNamePlaceholder: "이름 (선택)",
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
    confirmationNotice: "주문 후 직원이 확인해야 조리가 시작됩니다.",
    errors: {
      invalidRequest: "주문 정보가 올바르지 않습니다. 다시 확인해 주세요.",
      qrUnavailable: "이 QR 코드를 사용할 수 없습니다. 직원에게 문의해 주세요.",
      orderingUnavailable: "이 매장은 현재 주문을 받고 있지 않습니다.",
      capacityPaused: "현재 주문이 많아 주문 접수를 잠시 중단했습니다. 잠시 후 다시 시도해 주세요.",
      sessionInvalid: "주문 세션이 유효하지 않습니다. QR 코드를 다시 스캔해 주세요.",
      rateLimited: "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      securityFailed: "보안 인증에 실패했습니다. 다시 인증해 주세요.",
      securityUnavailable: "보안 인증을 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
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
    qrUnavailableTitle: "Mã QR này hiện không khả dụng",
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
    quantityLimit: "Bạn đã đạt giới hạn số lượng đặt món của quầy.",
    singleChoice: "Chọn một",
    multipleChoice: "Chọn nhiều",
    maxSelections: (count) => `Tối đa ${count} lựa chọn`,
    noSelection: "Không chọn",
    yourOrder: "Đơn hàng của bạn",
    viewOrder: "Xem đơn hàng",
    close: "Đóng",
    categoryNavigation: "Danh mục món",
    customerName: "Tên khách hàng",
    customerNamePlaceholder: "Tên (không bắt buộc)",
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
    confirmationNotice: "Nhân viên phải xác nhận đơn trước khi bắt đầu chế biến.",
    errors: {
      invalidRequest: "Thông tin đơn hàng không hợp lệ. Vui lòng kiểm tra lại.",
      qrUnavailable: "Mã QR này không khả dụng. Vui lòng liên hệ nhân viên.",
      orderingUnavailable: "Quầy hiện không nhận đơn hàng.",
      capacityPaused: "Hiện có nhiều đơn hàng nên quầy tạm ngừng nhận đơn. Vui lòng thử lại sau.",
      sessionInvalid: "Phiên đặt món không còn hiệu lực. Vui lòng quét lại mã QR.",
      rateLimited: "Bạn thao tác quá thường xuyên. Vui lòng thử lại sau.",
      securityFailed: "Xác minh bảo mật thất bại. Vui lòng xác minh lại.",
      securityUnavailable: "Tính năng xác minh bảo mật tạm thời không khả dụng. Vui lòng thử lại sau.",
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
    qrUnavailableTitle: "ไม่สามารถใช้ QR Code นี้ได้ในขณะนี้",
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
    quantityLimit: "ถึงขีดจำกัดจำนวนการสั่งซื้อของร้านแล้ว",
    singleChoice: "เลือก 1 รายการ",
    multipleChoice: "เลือกได้หลายรายการ",
    maxSelections: (count) => `เลือกได้สูงสุด ${count} รายการ`,
    noSelection: "ไม่เลือก",
    yourOrder: "รายการสั่งซื้อของคุณ",
    viewOrder: "ดูรายการสั่งซื้อ",
    close: "ปิด",
    categoryNavigation: "หมวดหมู่เมนู",
    customerName: "ชื่อลูกค้า",
    customerNamePlaceholder: "ชื่อ (ไม่บังคับ)",
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
    confirmationNotice: "พนักงานต้องยืนยันคำสั่งซื้อก่อนจึงจะเริ่มเตรียมอาหาร",
    errors: {
      invalidRequest: "ข้อมูลคำสั่งซื้อไม่ถูกต้อง โปรดตรวจสอบอีกครั้ง",
      qrUnavailable: "ไม่สามารถใช้ QR Code นี้ได้ โปรดสอบถามพนักงาน",
      orderingUnavailable: "ร้านยังไม่รับคำสั่งซื้อในขณะนี้",
      capacityPaused: "ขณะนี้มีคำสั่งซื้อจำนวนมาก ร้านจึงหยุดรับออร์เดอร์ชั่วคราว โปรดลองอีกครั้งภายหลัง",
      sessionInvalid: "เซสชันการสั่งซื้อไม่ถูกต้อง โปรดสแกน QR Code อีกครั้ง",
      rateLimited: "มีการทำรายการบ่อยเกินไป โปรดลองอีกครั้งในภายหลัง",
      securityFailed: "การยืนยันความปลอดภัยล้มเหลว โปรดยืนยันอีกครั้ง",
      securityUnavailable: "ระบบยืนยันความปลอดภัยไม่พร้อมใช้งานชั่วคราว โปรดลองอีกครั้งในภายหลัง",
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
  QR_NOT_FOUND: "qrUnavailable",
  QR_REVOKED: "qrUnavailable",
  QR_PAUSED: "qrUnavailable",
  QR_EXPIRED: "qrUnavailable",
  QR_NOT_ACTIVE: "qrUnavailable",
  TABLE_UNAVAILABLE: "qrUnavailable",
  QR_SESSION_MISMATCH: "sessionInvalid",
  STALL_CLOSED: "orderingUnavailable",
  ORDERING_PAUSED: "orderingUnavailable",
  STALL_SOLD_OUT: "orderingUnavailable",
  TENANT_INACTIVE: "orderingUnavailable",
  SESSION_NOT_FOUND: "sessionInvalid",
  SESSION_EXPIRED: "sessionInvalid",
  SESSION_REPLAYED: "sessionInvalid",
  SESSION_DEVICE_MISMATCH: "sessionInvalid",
  RATE_LIMITED: "rateLimited",
  INVALID_TURNSTILE: "securityFailed",
  TURNSTILE_UNAVAILABLE: "securityUnavailable",
  INVALID_ITEMS: "selectionInvalid",
  TOO_MANY_OR_DUPLICATE_PRODUCTS: "orderLimits",
  EXCESSIVE_TOTAL_QUANTITY: "orderLimits",
  EXCESSIVE_ITEM_QUANTITY: "orderLimits",
  NOTE_TOO_LONG: "orderLimits",
  PRODUCT_UNAVAILABLE: "productUnavailable",
  PRODUCT_CAPACITY_EXCEEDED: "productUnavailable",
  CAPACITY_PAUSED: "capacityPaused",
  WAIT_ACKNOWLEDGMENT_REQUIRED: "waitAcknowledgment",
  INVALID_PRODUCT_NOTES: "selectionInvalid",
  TOO_MANY_PENDING_ORDERS: "pendingLimit",
  TRIAL_ORDER_LIMIT_REACHED: "trialOrderLimit",
  SUBSCRIPTION_SUSPENDED: "subscriptionSuspended",
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
  preferredLocales: readonly string[],
  supportedLocales: readonly string[],
) {
  const available = new Set<QrLocale>(["zh-TW"]);
  supportedLocales.forEach((locale) => {
    if (isQrLocale(locale)) available.add(locale);
  });
  return available.has(currentLocale)
    ? currentLocale
    : resolvePreferredQrLocale(preferredLocales, supportedLocales);
}

export function localizedQrCategory(locale: QrLocale, category: string) {
  return categoryTranslations[category]?.[locale] ?? category;
}

export function localizedPublicOrderError(locale: QrLocale, code: string | undefined) {
  const key = code ? errorMessageKeys[code] : undefined;
  return key ? qrOrderMessages[locale].errors[key] : qrOrderMessages[locale].orderSubmitError;
}
