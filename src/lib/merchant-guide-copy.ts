import type { AppLocale } from "@/lib/app-locale";
import type {
  MerchantGuideCategory,
  MerchantGuideCustomTitle,
  MerchantGuideKind,
  MerchantGuideNote,
} from "@/lib/merchant-guide";

type GuideKindCopy = {
  summary: string;
  steps: readonly [string, string, string, string];
  completion: string;
  caution: string;
};

type MerchantGuideCopy = {
  openGuide: string;
  title: string;
  subtitle: string;
  searchLabel: string;
  searchPlaceholder: string;
  allFunctions: string;
  currentPage: string;
  currentBadge: string;
  roleFiltered: string;
  selectStallHint: string;
  noResults: string;
  backToList: string;
  operationGuide: string;
  completionStandard: string;
  attention: string;
  goToFeature: string;
  close: string;
  chooseFeature: string;
  count: string;
  categories: Record<MerchantGuideCategory, string>;
  customTitles: Record<MerchantGuideCustomTitle, string>;
  kinds: Record<MerchantGuideKind, GuideKindCopy>;
  notes: Record<MerchantGuideNote, string>;
};

const copies = {
  "zh-TW": {
    openGuide: "商家系統導覽",
    title: "商家系統導覽",
    subtitle: "只顯示您目前有權限且已開放的功能；可搜尋功能，或查看本頁的操作說明。",
    searchLabel: "搜尋導覽",
    searchPlaceholder: "搜尋商品、外帶、列印、報表…",
    allFunctions: "全部",
    currentPage: "本頁說明",
    currentBadge: "本頁",
    roleFiltered: "內容已依登入權限與模組開關篩選。",
    selectStallHint: "目前未選擇攤位；選定攤位後才會顯示該攤位的點餐、KDS、列印與設定導覽。",
    noResults: "找不到符合的功能，請換一個關鍵字。",
    backToList: "選擇其他功能",
    operationGuide: "操作方式",
    completionStandard: "完成標準",
    attention: "注意事項",
    goToFeature: "前往此功能",
    close: "關閉導覽",
    chooseFeature: "選擇左側功能查看說明。",
    count: "共 {count} 項",
    categories: {
      start: "開始營運",
      ordering: "點餐設定",
      catalog: "商品與庫存",
      operations: "現場營運",
      reports: "報表與財務",
      people: "人員管理",
      growth: "成長與整合",
      security: "安全與稽核",
    },
    customTitles: {
      stallOperations: "攤位營運",
      staffPos: "店員點餐",
      kitchenBoard: "廚房看板",
      printQueue: "列印佇列",
      reportOverview: "趨勢總覽",
      reportOrders: "所有訂單",
      reportProducts: "商品分析",
      reportStalls: "攤位比較",
      reportPayments: "付款分析",
      qrPrint: "QR 印刷版",
    },
    kinds: {
      setup: {
        summary: "「{feature}」是首次啟用或重新檢查商家時的入口，請按順序完成後再正式接單。",
        steps: [
          "先確認上方選擇的商家與攤位正確，再查看尚未完成的項目。",
          "開啟「{feature}」，先處理必填欄位與畫面上的警示。",
          "儲存後回到清單，確認完成狀態、QR 與接單狀態已更新。",
          "使用測試商品完成一筆測試訂單；確認無誤後才正式開放。",
        ],
        completion: "重新登入後仍顯示設定完成，並可建立、處理及完成一筆測試訂單。",
        caution: "不要用正式顧客訂單代替測試；尚未接通的付款、外送或通知模組應維持關閉。",
      },
      configure: {
        summary: "在「{feature}」調整商家或攤位設定，儲存後要從實際使用畫面再確認一次。",
        steps: [
          "確認上方商家與攤位，避免把設定套用到其他店。",
          "先查看目前值、啟用狀態及相依功能，再修改需要的欄位。",
          "按下儲存並等待成功訊息；若出現錯誤，先修正標示欄位。",
          "重新整理後確認資料仍保留，再到顧客或店員畫面驗證結果。",
        ],
        completion: "重新進入頁面仍保留新設定，且相關顧客、店員或管理畫面同步正確。",
        caution: "一次只調整一組設定並立即驗證；影響接單、付款或列印的開關不要直接在營業尖峰測試。",
      },
      operate: {
        summary: "「{feature}」用於營業中的即時操作，請先核對攤位、班次及訂單狀態。",
        steps: [
          "確認目前攤位、班次與網路狀態正確。",
          "先處理最早且仍待處理的項目，留意紅色或黃色提醒。",
          "核對商品、金額與目前狀態，再按下對應的大按鈕。",
          "操作後確認狀態已更新，並在紀錄或下一個工作畫面看得到結果。",
        ],
        completion: "操作結果已留下紀錄，且訂單、班次或廚房狀態沒有卡在前一步。",
        caution: "結帳、取消、退款與交班會影響帳務；送出前應再次核對訂單與金額。",
      },
      report: {
        summary: "「{feature}」用來查詢已發生的營運資料；先選對範圍與日期再解讀數字。",
        steps: [
          "選擇正確商家、攤位及日／週／月或自訂日期區間。",
          "套用狀態、付款或商品條件；資料較多時使用分頁查看。",
          "先看摘要，再點進訂單、交班或付款明細交叉核對。",
          "確認範圍與筆數正確後，才匯出、列印或提供給會計。",
        ],
        completion: "摘要金額、明細筆數與來源訂單／交班紀錄能互相對上。",
        caution: "日期以攤位時區與營業日切點計算；取消、退款與測試訂單可能不列入營收。",
      },
      integration: {
        summary: "「{feature}」會連接外部服務或硬體，應先完成配對與測試，再開放正式流量。",
        steps: [
          "先閱讀資格、硬體、帳號或合作方需求，測試期間保持正式開關關閉。",
          "只在指定欄位填寫連線資料；不要把密碼或金鑰貼到備註。",
          "完成門市、商品、印表機或通知對應，執行一次測試。",
          "測試成功且狀態正常後才啟用，並持續查看錯誤與營運警示。",
        ],
        completion: "測試資料成功往返、對應正確，而且失敗時會顯示可處理的原因。",
        caution: "顯示已儲存不代表外部服務已接通；必須以實際測試結果為準。",
      },
      security: {
        summary: "「{feature}」涉及權限、裝置或高影響設定，修改前要先確認操作者與範圍。",
        steps: [
          "確認目前登入帳號、角色、商家與攤位範圍。",
          "查看目標資料的名稱、狀態與最後更新時間，避免選錯對象。",
          "只修改必要項目；停用、登出或撤銷等操作一次處理一筆。",
          "重新整理或重新登入驗證結果，再查看稽核紀錄是否完整。",
        ],
        completion: "正確角色能使用所需功能，無權限者看不到入口，變更也有稽核紀錄。",
        caution: "不要共用帳號；移除最後一位擁有者或大量登出裝置前應先確認替代管理者。",
      },
    },
    notes: {
      availability: "外帶自取需同時具備：模組已開、攤位可接單、有效 QR，以及至少一段可預約營業時間。",
      specialHours: "同一日期不可重複；選擇營業時必須設定開始與結束時間，店休則只套用指定日期。",
      productVisibility: "線上售完或隱藏只影響 QR／Menu；現場仍要販售的商品，請保留店員點餐可見。",
      printing: "網頁顯示列印成功不等於實體設備已完成；還要確認連線方式、紙張、印表機回應與錢櫃接線。",
      kds: "新訂單應先進入待確認並發出提醒；關閉 KDS 時仍須由店員完成訂單狀態。",
      cashShift: "交班後使用更正或覆核保留歷史，不要以刪除方式改掉原始帳務紀錄。",
      supply: "庫存異動、配方與盤點會影響成本；先確認單位一致，再新增入庫、耗用或調整。",
      attendance: "一般員工才需要打卡提醒；擁有者與經理依權限處理開班、覆核與排班。",
      integration: "付款、電子發票與外送平台在憑證、商品對應及測試完成前都應保持停用。",
      accountSecurity: "裝置名稱只提供辨識用途；看不懂的裝置應先登出，再更換密碼並檢查登入方式。",
    },
  },
  en: {
    openGuide: "Merchant guide",
    title: "Merchant system guide",
    subtitle: "Only features available to your role and enabled modules are shown. Search, or view help for the current page.",
    searchLabel: "Search guide",
    searchPlaceholder: "Search products, pickup, printing, reports…",
    allFunctions: "All",
    currentPage: "This page",
    currentBadge: "Current",
    roleFiltered: "Content is filtered by your access and enabled modules.",
    selectStallHint: "No stall is selected. Select one to see ordering, KDS, printing, and stall-setting guides.",
    noResults: "No matching feature. Try another keyword.",
    backToList: "Choose another feature",
    operationGuide: "How to use it",
    completionStandard: "Done when",
    attention: "Important",
    goToFeature: "Open feature",
    close: "Close guide",
    chooseFeature: "Choose a feature on the left to view its guide.",
    count: "{count} items",
    categories: { start: "Get started", ordering: "Ordering", catalog: "Products & inventory", operations: "Live operations", reports: "Reports & finance", people: "People", growth: "Growth & integrations", security: "Security & audit" },
    customTitles: { stallOperations: "Stall operations", staffPos: "Staff ordering", kitchenBoard: "Kitchen board", printQueue: "Print queue", reportOverview: "Trends overview", reportOrders: "All orders", reportProducts: "Product analysis", reportStalls: "Stall comparison", reportPayments: "Payment analysis", qrPrint: "Printable QR" },
    kinds: {
      setup: { summary: "Use “{feature}” for first-time setup or a full readiness review. Finish each step before going live.", steps: ["Confirm the business and stall selected at the top, then review incomplete tasks.", "Open “{feature}” and resolve required fields and warnings first.", "Save, return to the checklist, and confirm setup, QR, and ordering status changed.", "Complete one test order with a test item before opening real ordering."], completion: "Setup still shows complete after signing in again, and one test order can be created, handled, and completed.", caution: "Do not use a real customer order for testing. Keep unconnected payment, delivery, or notification modules off." },
      configure: { summary: "Use “{feature}” to change business or stall settings, then verify them in the real operating view.", steps: ["Confirm the business and stall so the change is not applied to another location.", "Review current values, enabled state, and dependent features before editing.", "Save and wait for success. If an error appears, correct the marked field first.", "Refresh to confirm the value persists, then verify the customer or staff view."], completion: "The setting persists after reopening and appears correctly in the related customer, staff, or manager view.", caution: "Change one group at a time and verify it. Avoid testing ordering, payment, or printing switches during peak service." },
      operate: { summary: "Use “{feature}” during service. Confirm the stall, shift, and order state before acting.", steps: ["Confirm the current stall, shift, and network status.", "Handle the oldest pending item first and watch red or yellow alerts.", "Check items, amount, and current status before pressing the action button.", "Confirm the status changed and the result appears in history or the next work view."], completion: "The action is recorded and the order, shift, or kitchen task is not stuck in the previous state.", caution: "Checkout, cancellation, refund, and shift close affect accounts. Recheck the order and amount before submitting." },
      report: { summary: "Use “{feature}” to review completed activity. Choose the correct scope and dates before reading totals.", steps: ["Choose the business, stall, and day, week, month, or custom date range.", "Apply status, payment, or product filters and use pagination for long results.", "Review the summary, then cross-check order, shift, or payment details.", "Export, print, or share with accounting only after confirming scope and row count."], completion: "Summary totals and detail counts reconcile with source orders or shifts.", caution: "Dates follow the stall time zone and business-day cutoff. Cancelled, refunded, and test orders may be excluded." },
      integration: { summary: "“{feature}” connects an external service or device. Complete mapping and tests before enabling live traffic.", steps: ["Read partner, account, or hardware requirements and keep the live switch off during testing.", "Enter connection data only in its assigned field. Never paste passwords or keys into notes.", "Finish store, product, printer, or notification mapping and run one test.", "Enable only after a successful test, then monitor errors and operational alerts."], completion: "Test data travels both ways, mappings are correct, and failures show an actionable reason.", caution: "Saved does not mean connected. A real test result is required." },
      security: { summary: "“{feature}” affects access, devices, or high-impact settings. Confirm the operator and scope first.", steps: ["Confirm the signed-in account, role, business, and stall scope.", "Review the target name, status, and last update to avoid changing the wrong record.", "Change only what is needed. Disable, sign out, or revoke one target at a time.", "Refresh or sign in again to verify, then check the audit log."], completion: "Authorized roles can use the feature, unauthorized roles cannot see it, and the change is audited.", caution: "Do not share accounts. Confirm another administrator exists before removing the last owner or signing out many devices." },
    },
    notes: {
      availability: "Pickup needs all four: module on, stall accepting orders, a valid QR, and at least one bookable business window.",
      specialHours: "Dates cannot overlap. An open day needs start and end times; a closure applies only to the selected dates.",
      productVisibility: "Online sold-out or hidden status affects QR/Menu only. Keep an item visible to staff if it is still sold on site.",
      printing: "A browser success message is not proof of hardware completion. Check connection type, paper, printer response, and cash-drawer cable.",
      kds: "A new order should enter pending review and alert staff. When KDS is off, staff must still complete the order state.",
      cashShift: "Use correction or review after closing a shift so the original accounting history remains intact.",
      supply: "Inventory movements, recipes, and counts affect cost. Confirm units before receiving, consuming, or adjusting stock.",
      attendance: "Clock-in reminders are for regular staff. Owners and managers handle opening shifts, reviews, and schedules by permission.",
      integration: "Keep payment, e-invoice, and delivery integrations off until credentials, mappings, and tests are complete.",
      accountSecurity: "Device names are only identification hints. Sign out an unknown device, change the password, and review login methods.",
    },
  },
  ja: {
    openGuide: "店舗ガイド",
    title: "店舗システムガイド",
    subtitle: "現在の権限と有効な機能だけを表示します。検索または現在のページの説明を確認できます。",
    searchLabel: "ガイドを検索",
    searchPlaceholder: "商品、持ち帰り、印刷、レポートを検索…",
    allFunctions: "すべて",
    currentPage: "このページ",
    currentBadge: "現在",
    roleFiltered: "権限と有効な機能に合わせて内容を絞り込んでいます。",
    selectStallHint: "店舗が選択されていません。選択すると注文、KDS、印刷、店舗設定のガイドが表示されます。",
    noResults: "該当する機能がありません。別の言葉で検索してください。",
    backToList: "別の機能を選ぶ",
    operationGuide: "操作方法",
    completionStandard: "完了の目安",
    attention: "注意事項",
    goToFeature: "機能を開く",
    close: "ガイドを閉じる",
    chooseFeature: "左側から機能を選んでください。",
    count: "全 {count} 件",
    categories: { start: "営業開始", ordering: "注文設定", catalog: "商品と在庫", operations: "店舗運営", reports: "レポートと財務", people: "スタッフ管理", growth: "成長と連携", security: "安全と監査" },
    customTitles: { stallOperations: "店舗運営", staffPos: "スタッフ注文", kitchenBoard: "キッチンボード", printQueue: "印刷キュー", reportOverview: "トレンド概要", reportOrders: "全注文", reportProducts: "商品分析", reportStalls: "店舗比較", reportPayments: "支払い分析", qrPrint: "QR 印刷版" },
    kinds: {
      setup: { summary: "「{feature}」は初回設定や再確認の入口です。順番に完了してから営業を開始します。", steps: ["上部の事業者と店舗が正しいか確認し、未完了項目を確認します。", "「{feature}」を開き、必須項目と警告を先に処理します。", "保存後に一覧へ戻り、設定、QR、注文受付の状態を確認します。", "テスト商品でテスト注文を1件完了してから正式に公開します。"], completion: "再ログイン後も完了状態が保たれ、テスト注文を作成から完了まで処理できます。", caution: "実際のお客様の注文でテストしないでください。未接続の決済、配達、通知はオフのままにします。" },
      configure: { summary: "「{feature}」で事業者または店舗を設定し、保存後に実際の画面でも確認します。", steps: ["別店舗を変更しないよう、事業者と店舗を確認します。", "現在値、有効状態、関連機能を確認してから変更します。", "保存して成功表示を待ち、エラー箇所があれば先に修正します。", "再読み込み後も設定が残ることを確認し、顧客・スタッフ画面で検証します。"], completion: "再度開いても設定が残り、関連する顧客・スタッフ・管理画面へ正しく反映されます。", caution: "一度に一組だけ変更して確認します。繁忙時間に注文、決済、印刷のスイッチを試さないでください。" },
      operate: { summary: "「{feature}」は営業中の操作です。店舗、シフト、注文状態を確認してから進めます。", steps: ["現在の店舗、シフト、通信状態を確認します。", "最も古い未処理項目から対応し、赤・黄の警告を確認します。", "商品、金額、現在状態を確認してから操作ボタンを押します。", "状態が更新され、履歴または次の画面に反映されたことを確認します。"], completion: "操作が記録され、注文、シフト、調理タスクが前の状態で止まっていません。", caution: "会計、取消、返金、締め処理は帳務に影響します。送信前に注文と金額を再確認してください。" },
      report: { summary: "「{feature}」で確定済みの運営データを確認します。集計範囲と日付を先に選びます。", steps: ["事業者、店舗、日・週・月または任意期間を選びます。", "状態、支払い、商品条件を適用し、件数が多い場合はページを切り替えます。", "概要を見た後、注文、シフト、支払い明細と照合します。", "範囲と件数を確認してから出力、印刷、会計共有を行います。"], completion: "概要金額と明細件数が元の注文・シフト記録と一致します。", caution: "日付は店舗のタイムゾーンと営業日区切りに従います。取消、返金、テスト注文は除外される場合があります。" },
      integration: { summary: "「{feature}」は外部サービスや機器と接続します。対応付けとテスト後に本番を有効にします。", steps: ["提携条件、アカウント、機器要件を確認し、テスト中は本番をオフにします。", "接続情報は指定欄だけに入力し、メモへパスワードや鍵を貼らないでください。", "店舗、商品、プリンター、通知を対応付け、テストを1回実行します。", "成功を確認してから有効にし、エラーと運営警告を監視します。"], completion: "テストデータが正しく往復し、失敗時に対応できる理由が表示されます。", caution: "保存済み表示だけでは接続完了ではありません。実際のテスト結果が必要です。" },
      security: { summary: "「{feature}」は権限、端末、重要設定に関係します。操作者と対象範囲を先に確認します。", steps: ["ログイン中のアカウント、役割、事業者、店舗範囲を確認します。", "対象名、状態、最終更新を見て、別の記録を選んでいないか確認します。", "必要な項目だけ変更し、無効化やログアウトは1件ずつ行います。", "再読み込みまたは再ログインで確認し、監査記録も確認します。"], completion: "許可された役割だけが利用でき、変更内容が監査記録に残ります。", caution: "アカウントを共有しないでください。最後の所有者削除や一括ログアウト前に代替管理者を確認します。" },
    },
    notes: {
      availability: "持ち帰り予約には、機能オン、注文受付中、有効なQR、予約可能な営業時間の4点が必要です。",
      specialHours: "日付は重複できません。営業日は開始・終了時刻が必要で、休業日は選択した日だけに適用されます。",
      productVisibility: "オンラインの売切・非表示はQR／Menuだけに影響します。店頭販売する商品はスタッフ画面に残します。",
      printing: "ブラウザーの成功表示だけでは機器完了ではありません。接続方式、用紙、応答、ドロアー配線も確認します。",
      kds: "新規注文は確認待ちに入り通知されます。KDSオフ時もスタッフが注文を完了状態にする必要があります。",
      cashShift: "締め後は訂正または確認を使い、元の会計履歴を残します。",
      supply: "在庫移動、レシピ、棚卸は原価に影響します。入庫、消費、調整前に単位を確認します。",
      attendance: "打刻通知は一般スタッフ向けです。所有者と管理者は権限に応じて開班、確認、シフトを管理します。",
      integration: "認証情報、対応付け、テスト完了まで決済、電子請求書、配達連携をオフにします。",
      accountSecurity: "端末名は識別の目安です。不明な端末をログアウトし、パスワードとログイン方法を確認します。",
    },
  },
  ko: {
    openGuide: "매장 가이드",
    title: "매장 시스템 가이드",
    subtitle: "현재 권한과 켜진 모듈에서 사용할 수 있는 기능만 표시합니다. 검색하거나 현재 페이지 안내를 확인하세요.",
    searchLabel: "가이드 검색",
    searchPlaceholder: "상품, 포장, 인쇄, 보고서 검색…",
    allFunctions: "전체",
    currentPage: "현재 페이지",
    currentBadge: "현재",
    roleFiltered: "권한과 활성 모듈에 따라 내용을 선별했습니다.",
    selectStallHint: "선택한 매장이 없습니다. 매장을 선택하면 주문, KDS, 인쇄 및 매장 설정 가이드가 표시됩니다.",
    noResults: "일치하는 기능이 없습니다. 다른 검색어를 사용하세요.",
    backToList: "다른 기능 선택",
    operationGuide: "사용 방법",
    completionStandard: "완료 기준",
    attention: "주의사항",
    goToFeature: "기능 열기",
    close: "가이드 닫기",
    chooseFeature: "왼쪽에서 기능을 선택하세요.",
    count: "총 {count}개",
    categories: { start: "운영 시작", ordering: "주문 설정", catalog: "상품 및 재고", operations: "현장 운영", reports: "보고서 및 재무", people: "직원 관리", growth: "성장 및 연동", security: "보안 및 감사" },
    customTitles: { stallOperations: "매장 운영", staffPos: "직원 주문", kitchenBoard: "주방 보드", printQueue: "인쇄 대기열", reportOverview: "추세 개요", reportOrders: "전체 주문", reportProducts: "상품 분석", reportStalls: "매장 비교", reportPayments: "결제 분석", qrPrint: "QR 인쇄본" },
    kinds: {
      setup: { summary: "“{feature}”은 최초 설정이나 전체 점검을 위한 시작점입니다. 순서대로 완료한 뒤 운영을 시작하세요.", steps: ["상단의 사업체와 매장이 맞는지 확인하고 미완료 항목을 봅니다.", "“{feature}”을 열고 필수 입력과 경고를 먼저 처리합니다.", "저장 후 목록으로 돌아가 설정, QR, 주문 상태가 바뀌었는지 확인합니다.", "테스트 상품으로 테스트 주문 1건을 완료한 뒤 실제 주문을 엽니다."], completion: "다시 로그인해도 완료 상태가 유지되고 테스트 주문을 생성부터 완료까지 처리할 수 있습니다.", caution: "실제 고객 주문으로 테스트하지 마세요. 연결 전인 결제, 배달, 알림 모듈은 꺼 두세요." },
      configure: { summary: "“{feature}”에서 사업체 또는 매장 설정을 바꾸고 실제 사용 화면에서 다시 확인합니다.", steps: ["다른 매장에 적용하지 않도록 사업체와 매장을 확인합니다.", "현재 값, 활성 상태, 연관 기능을 확인한 뒤 필요한 항목만 수정합니다.", "저장 성공 메시지를 기다리고 오류가 있으면 표시된 필드를 먼저 수정합니다.", "새로 고침 후 값이 남아 있는지 보고 고객 또는 직원 화면에서 확인합니다."], completion: "다시 열어도 설정이 유지되고 관련 고객, 직원, 관리자 화면에 올바르게 반영됩니다.", caution: "한 번에 한 설정 묶음만 바꾸고 확인하세요. 혼잡 시간에는 주문, 결제, 인쇄 스위치를 시험하지 마세요." },
      operate: { summary: "“{feature}”은 영업 중 실시간 작업입니다. 매장, 근무조, 주문 상태를 먼저 확인하세요.", steps: ["현재 매장, 근무조, 네트워크 상태를 확인합니다.", "가장 오래된 대기 항목부터 처리하고 빨간색·노란색 알림을 봅니다.", "상품, 금액, 현재 상태를 확인한 뒤 작업 버튼을 누릅니다.", "상태가 바뀌고 기록 또는 다음 작업 화면에 반영됐는지 확인합니다."], completion: "작업 기록이 남고 주문, 근무조, 주방 작업이 이전 단계에 멈추지 않습니다.", caution: "결제, 취소, 환불, 마감은 정산에 영향을 줍니다. 전송 전 주문과 금액을 다시 확인하세요." },
      report: { summary: "“{feature}”에서 발생한 운영 데이터를 조회합니다. 합계 전에 범위와 날짜를 선택하세요.", steps: ["사업체, 매장, 일·주·월 또는 사용자 지정 기간을 선택합니다.", "상태, 결제, 상품 조건을 적용하고 결과가 많으면 페이지를 이동합니다.", "요약을 본 뒤 주문, 근무조, 결제 상세와 대조합니다.", "범위와 건수를 확인한 후 내보내기, 인쇄 또는 회계 공유를 합니다."], completion: "요약 금액과 상세 건수가 원본 주문 또는 근무조 기록과 일치합니다.", caution: "날짜는 매장 시간대와 영업일 기준을 따릅니다. 취소, 환불, 테스트 주문은 제외될 수 있습니다." },
      integration: { summary: "“{feature}”은 외부 서비스나 장치를 연결합니다. 매핑과 테스트 후 실제 사용을 켜세요.", steps: ["파트너, 계정, 장비 요구사항을 읽고 테스트 중 실제 사용 스위치는 끕니다.", "연결 정보는 지정 필드에만 입력하고 비밀번호나 키를 메모에 붙이지 않습니다.", "매장, 상품, 프린터 또는 알림 매핑을 완료하고 한 번 테스트합니다.", "테스트 성공 후에만 켜고 오류와 운영 알림을 확인합니다."], completion: "테스트 데이터가 올바르게 오가고 실패 시 처리 가능한 이유가 표시됩니다.", caution: "저장됨은 연결 완료가 아닙니다. 실제 테스트 결과가 필요합니다." },
      security: { summary: "“{feature}”은 권한, 장치 또는 중요 설정에 영향을 줍니다. 작업자와 범위를 먼저 확인하세요.", steps: ["현재 계정, 역할, 사업체, 매장 범위를 확인합니다.", "대상 이름, 상태, 최근 수정 시간을 보고 잘못된 항목이 아닌지 확인합니다.", "필요한 항목만 바꾸고 비활성화, 로그아웃, 취소는 한 건씩 처리합니다.", "새로 고침 또는 재로그인으로 확인한 뒤 감사 기록을 봅니다."], completion: "허용된 역할만 기능을 사용할 수 있고 변경이 감사 기록에 남습니다.", caution: "계정을 공유하지 마세요. 마지막 소유자 삭제나 여러 장치 로그아웃 전 대체 관리자를 확인하세요." },
    },
    notes: {
      availability: "포장 예약에는 모듈 켜짐, 주문 접수 중, 유효한 QR, 예약 가능한 영업시간이 모두 필요합니다.",
      specialHours: "날짜는 겹칠 수 없습니다. 영업일은 시작·종료 시간이 필요하며 휴무는 선택한 날짜에만 적용됩니다.",
      productVisibility: "온라인 품절·숨김은 QR/Menu에만 적용됩니다. 현장 판매 상품은 직원 주문에 계속 보이게 하세요.",
      printing: "브라우저 성공 표시는 장비 완료가 아닙니다. 연결 방식, 용지, 프린터 응답, 금고 케이블을 확인하세요.",
      kds: "새 주문은 확인 대기로 들어가 알림이 나야 합니다. KDS가 꺼져도 직원이 주문 상태를 완료해야 합니다.",
      cashShift: "마감 후에는 수정 또는 검토를 사용해 원래 정산 기록을 보존하세요.",
      supply: "재고 이동, 레시피, 실사는 원가에 영향을 줍니다. 입고, 사용, 조정 전에 단위를 확인하세요.",
      attendance: "출퇴근 알림은 일반 직원용입니다. 소유자와 관리자는 권한에 따라 개시, 검토, 일정을 관리합니다.",
      integration: "자격 증명, 매핑, 테스트 완료 전까지 결제, 전자 송장, 배달 연동을 꺼 두세요.",
      accountSecurity: "장치명은 식별용입니다. 모르는 장치는 로그아웃하고 비밀번호와 로그인 방식을 확인하세요.",
    },
  },
  vi: {
    openGuide: "Hướng dẫn cửa hàng",
    title: "Hướng dẫn hệ thống cho cửa hàng",
    subtitle: "Chỉ hiển thị chức năng bạn có quyền dùng và mô-đun đã bật. Hãy tìm kiếm hoặc xem hướng dẫn của trang hiện tại.",
    searchLabel: "Tìm trong hướng dẫn",
    searchPlaceholder: "Tìm món, mang đi, in, báo cáo…",
    allFunctions: "Tất cả",
    currentPage: "Trang này",
    currentBadge: "Hiện tại",
    roleFiltered: "Nội dung đã được lọc theo quyền và mô-đun đang bật.",
    selectStallHint: "Chưa chọn quầy. Hãy chọn quầy để xem hướng dẫn đặt món, KDS, in và cài đặt quầy.",
    noResults: "Không tìm thấy chức năng phù hợp. Hãy thử từ khóa khác.",
    backToList: "Chọn chức năng khác",
    operationGuide: "Cách sử dụng",
    completionStandard: "Tiêu chuẩn hoàn tất",
    attention: "Lưu ý",
    goToFeature: "Mở chức năng",
    close: "Đóng hướng dẫn",
    chooseFeature: "Chọn chức năng bên trái để xem hướng dẫn.",
    count: "Tổng {count} mục",
    categories: { start: "Bắt đầu vận hành", ordering: "Cài đặt đặt món", catalog: "Món và kho", operations: "Vận hành tại quầy", reports: "Báo cáo và tài chính", people: "Nhân sự", growth: "Tăng trưởng và tích hợp", security: "Bảo mật và kiểm tra" },
    customTitles: { stallOperations: "Vận hành quầy", staffPos: "Nhân viên đặt món", kitchenBoard: "Bảng bếp", printQueue: "Hàng đợi in", reportOverview: "Tổng quan xu hướng", reportOrders: "Tất cả đơn", reportProducts: "Phân tích món", reportStalls: "So sánh quầy", reportPayments: "Phân tích thanh toán", qrPrint: "Bản in QR" },
    kinds: {
      setup: { summary: "“{feature}” là nơi bắt đầu thiết lập hoặc kiểm tra lại toàn bộ. Hãy hoàn tất theo thứ tự trước khi mở bán.", steps: ["Xác nhận đúng doanh nghiệp và quầy ở phía trên, rồi xem mục chưa hoàn tất.", "Mở “{feature}” và xử lý trường bắt buộc cùng cảnh báo trước.", "Lưu, quay lại danh sách và kiểm tra trạng thái thiết lập, QR và nhận đơn.", "Dùng món thử để hoàn tất một đơn thử trước khi mở đơn thật."], completion: "Sau khi đăng nhập lại vẫn báo hoàn tất và có thể tạo, xử lý, hoàn tất một đơn thử.", caution: "Không dùng đơn thật của khách để thử. Giữ tắt thanh toán, giao hàng hoặc thông báo chưa kết nối." },
      configure: { summary: "Dùng “{feature}” để đổi cài đặt doanh nghiệp hoặc quầy, rồi kiểm tra lại trên màn hình sử dụng thật.", steps: ["Xác nhận doanh nghiệp và quầy để tránh áp dụng nhầm nơi.", "Xem giá trị hiện tại, trạng thái bật và chức năng liên quan trước khi sửa.", "Lưu và chờ thông báo thành công; nếu lỗi, sửa trường được đánh dấu trước.", "Tải lại để chắc rằng dữ liệu còn lưu, rồi kiểm tra màn hình khách hoặc nhân viên."], completion: "Cài đặt vẫn còn khi mở lại và hiển thị đúng trên màn hình khách, nhân viên hoặc quản lý liên quan.", caution: "Mỗi lần chỉ đổi một nhóm và kiểm tra ngay. Không thử công tắc nhận đơn, thanh toán hoặc in vào giờ cao điểm." },
      operate: { summary: "“{feature}” dùng trong giờ bán. Hãy kiểm tra quầy, ca và trạng thái đơn trước khi thao tác.", steps: ["Xác nhận quầy, ca làm và trạng thái mạng hiện tại.", "Xử lý mục chờ lâu nhất trước và chú ý cảnh báo đỏ hoặc vàng.", "Kiểm tra món, số tiền, trạng thái rồi mới bấm nút thao tác.", "Xác nhận trạng thái đã đổi và kết quả xuất hiện trong lịch sử hoặc màn hình tiếp theo."], completion: "Thao tác có lịch sử và đơn, ca hoặc việc bếp không bị kẹt ở bước trước.", caution: "Thanh toán, hủy, hoàn tiền và đóng ca ảnh hưởng sổ sách. Kiểm tra lại đơn và số tiền trước khi gửi." },
      report: { summary: "Dùng “{feature}” để xem dữ liệu đã phát sinh. Hãy chọn đúng phạm vi và ngày trước khi đọc tổng.", steps: ["Chọn doanh nghiệp, quầy và ngày, tuần, tháng hoặc khoảng tùy chọn.", "Áp dụng trạng thái, thanh toán hoặc món; dùng phân trang nếu có nhiều dữ liệu.", "Xem tổng quan rồi đối chiếu chi tiết đơn, ca hoặc thanh toán.", "Chỉ xuất, in hoặc gửi kế toán sau khi xác nhận phạm vi và số dòng."], completion: "Tổng tiền và số dòng chi tiết khớp với đơn hoặc ca nguồn.", caution: "Ngày theo múi giờ và mốc ngày kinh doanh của quầy. Đơn hủy, hoàn tiền và đơn thử có thể bị loại." },
      integration: { summary: "“{feature}” kết nối dịch vụ ngoài hoặc thiết bị. Hoàn tất ghép và thử trước khi bật chính thức.", steps: ["Đọc yêu cầu đối tác, tài khoản hoặc thiết bị và giữ công tắc chính thức tắt khi thử.", "Chỉ nhập dữ liệu kết nối vào trường quy định; không dán mật khẩu hay khóa vào ghi chú.", "Hoàn tất ghép cửa hàng, món, máy in hoặc thông báo và chạy một lần thử.", "Chỉ bật sau khi thử thành công, rồi theo dõi lỗi và cảnh báo vận hành."], completion: "Dữ liệu thử đi và về đúng, ghép đúng và lỗi hiển thị lý do có thể xử lý.", caution: "Đã lưu không có nghĩa là đã kết nối; phải có kết quả thử thực tế." },
      security: { summary: "“{feature}” ảnh hưởng quyền, thiết bị hoặc cài đặt quan trọng. Hãy xác nhận người thao tác và phạm vi trước.", steps: ["Xác nhận tài khoản, vai trò, doanh nghiệp và phạm vi quầy hiện tại.", "Xem tên, trạng thái, lần cập nhật cuối để tránh chọn sai dữ liệu.", "Chỉ đổi phần cần thiết; tắt, đăng xuất hoặc thu hồi từng mục một.", "Tải lại hoặc đăng nhập lại để kiểm tra, rồi xem nhật ký kiểm tra."], completion: "Đúng vai trò dùng được chức năng, vai trò không có quyền không thấy và thay đổi có nhật ký.", caution: "Không dùng chung tài khoản. Xác nhận còn quản trị viên khác trước khi xóa chủ sở hữu cuối hoặc đăng xuất nhiều thiết bị." },
    },
    notes: {
      availability: "Mang đi cần đủ bốn điều kiện: mô-đun bật, quầy nhận đơn, QR hợp lệ và có ít nhất một khung giờ có thể đặt.",
      specialHours: "Ngày không được trùng. Ngày mở cần giờ bắt đầu và kết thúc; ngày nghỉ chỉ áp dụng cho ngày đã chọn.",
      productVisibility: "Hết món hoặc ẩn online chỉ ảnh hưởng QR/Menu. Hãy giữ món hiển thị cho nhân viên nếu vẫn bán tại quầy.",
      printing: "Báo in thành công trên trình duyệt chưa chứng minh thiết bị hoàn tất. Kiểm tra kết nối, giấy, phản hồi máy in và dây ngăn kéo.",
      kds: "Đơn mới phải vào chờ xác nhận và phát cảnh báo. Khi tắt KDS, nhân viên vẫn phải hoàn tất trạng thái đơn.",
      cashShift: "Sau khi đóng ca, dùng sửa hoặc duyệt để giữ lại lịch sử sổ sách gốc.",
      supply: "Biến động kho, công thức và kiểm kê ảnh hưởng chi phí. Kiểm tra đơn vị trước khi nhập, dùng hoặc điều chỉnh.",
      attendance: "Nhắc chấm công dành cho nhân viên thường. Chủ và quản lý xử lý mở ca, duyệt và lịch theo quyền.",
      integration: "Giữ tắt thanh toán, hóa đơn điện tử và giao hàng đến khi xong thông tin, ghép và thử.",
      accountSecurity: "Tên thiết bị chỉ để nhận biết. Đăng xuất thiết bị lạ, đổi mật khẩu và kiểm tra cách đăng nhập.",
    },
  },
  th: {
    openGuide: "คู่มือร้านค้า",
    title: "คู่มือระบบสำหรับร้านค้า",
    subtitle: "แสดงเฉพาะฟังก์ชันที่สิทธิ์ของคุณใช้ได้และโมดูลที่เปิดอยู่ ค้นหาหรือดูคำแนะนำของหน้านี้ได้",
    searchLabel: "ค้นหาคู่มือ",
    searchPlaceholder: "ค้นหาสินค้า สั่งกลับบ้าน พิมพ์ รายงาน…",
    allFunctions: "ทั้งหมด",
    currentPage: "หน้านี้",
    currentBadge: "ปัจจุบัน",
    roleFiltered: "เนื้อหาถูกกรองตามสิทธิ์และโมดูลที่เปิดอยู่",
    selectStallHint: "ยังไม่ได้เลือกร้าน เลือกร้านเพื่อดูคู่มือการสั่งอาหาร KDS การพิมพ์ และการตั้งค่าร้าน",
    noResults: "ไม่พบฟังก์ชันที่ตรงกัน ลองคำค้นอื่น",
    backToList: "เลือกฟังก์ชันอื่น",
    operationGuide: "วิธีใช้งาน",
    completionStandard: "ถือว่าเสร็จเมื่อ",
    attention: "ข้อควรระวัง",
    goToFeature: "ไปที่ฟังก์ชัน",
    close: "ปิดคู่มือ",
    chooseFeature: "เลือกฟังก์ชันด้านซ้ายเพื่อดูคำแนะนำ",
    count: "ทั้งหมด {count} รายการ",
    categories: { start: "เริ่มดำเนินงาน", ordering: "ตั้งค่าการสั่ง", catalog: "สินค้าและสต็อก", operations: "งานหน้าร้าน", reports: "รายงานและการเงิน", people: "พนักงาน", growth: "การเติบโตและเชื่อมต่อ", security: "ความปลอดภัยและตรวจสอบ" },
    customTitles: { stallOperations: "การดำเนินงานร้าน", staffPos: "พนักงานรับออเดอร์", kitchenBoard: "จอครัว", printQueue: "คิวพิมพ์", reportOverview: "ภาพรวมแนวโน้ม", reportOrders: "ออเดอร์ทั้งหมด", reportProducts: "วิเคราะห์สินค้า", reportStalls: "เปรียบเทียบร้าน", reportPayments: "วิเคราะห์การชำระเงิน", qrPrint: "แบบพิมพ์ QR" },
    kinds: {
      setup: { summary: "“{feature}” คือจุดเริ่มสำหรับตั้งค่าครั้งแรกหรือตรวจใหม่ ทำตามลำดับก่อนเปิดรับออเดอร์จริง", steps: ["ตรวจว่าธุรกิจและร้านด้านบนถูกต้อง แล้วดูรายการที่ยังไม่เสร็จ", "เปิด “{feature}” และจัดการช่องบังคับกับคำเตือนก่อน", "บันทึก กลับไปหน้ารายการ และตรวจสถานะการตั้งค่า QR และการรับออเดอร์", "ใช้สินค้าทดสอบทำออเดอร์ทดสอบหนึ่งรายการให้เสร็จก่อนเปิดจริง"], completion: "หลังเข้าสู่ระบบใหม่ยังแสดงว่าเสร็จ และสร้าง จัดการ ปิดออเดอร์ทดสอบได้", caution: "อย่าใช้ออเดอร์ลูกค้าจริงทดสอบ และปิดโมดูลชำระเงิน เดลิเวอรี หรือแจ้งเตือนที่ยังไม่เชื่อมต่อ" },
      configure: { summary: "ใช้ “{feature}” เปลี่ยนการตั้งค่าธุรกิจหรือร้าน แล้วตรวจอีกครั้งในหน้าที่ใช้งานจริง", steps: ["ตรวจธุรกิจและร้านเพื่อไม่ให้ตั้งค่าผิดสาขา", "ดูค่าปัจจุบัน สถานะเปิด และฟังก์ชันที่เกี่ยวข้องก่อนแก้", "บันทึกและรอข้อความสำเร็จ หากมีข้อผิดพลาดให้แก้ช่องที่ระบุก่อน", "รีเฟรชเพื่อดูว่าค่ายังอยู่ แล้วตรวจในหน้าลูกค้าหรือพนักงาน"], completion: "เปิดหน้าใหม่แล้วยังเก็บค่า และแสดงถูกต้องในหน้าลูกค้า พนักงาน หรือผู้จัดการ", caution: "เปลี่ยนทีละกลุ่มและตรวจทันที อย่าทดสอบสวิตช์รับออเดอร์ ชำระเงิน หรือพิมพ์ในช่วงเร่งด่วน" },
      operate: { summary: "“{feature}” ใช้ระหว่างเปิดร้าน ตรวจร้าน กะ และสถานะออเดอร์ก่อนดำเนินการ", steps: ["ตรวจร้าน กะ และสถานะเครือข่ายปัจจุบัน", "จัดการรายการรอนานที่สุดก่อน และดูคำเตือนสีแดงหรือเหลือง", "ตรวจสินค้า ยอดเงิน และสถานะก่อนกดปุ่มดำเนินการ", "ตรวจว่าสถานะเปลี่ยนและผลปรากฏในประวัติหรือหน้าถัดไป"], completion: "มีบันทึกการทำงาน และออเดอร์ กะ หรืองานครัวไม่ค้างอยู่ขั้นก่อนหน้า", caution: "ชำระเงิน ยกเลิก คืนเงิน และปิดกะกระทบบัญชี ตรวจออเดอร์กับยอดเงินอีกครั้งก่อนส่ง" },
      report: { summary: "ใช้ “{feature}” ดูข้อมูลที่เกิดขึ้นแล้ว เลือกขอบเขตและวันที่ให้ถูกก่อนอ่านยอดรวม", steps: ["เลือกธุรกิจ ร้าน และวัน สัปดาห์ เดือน หรือช่วงวันที่เอง", "ใช้ตัวกรองสถานะ การชำระเงิน หรือสินค้า และเปลี่ยนหน้าถ้าข้อมูลมาก", "ดูสรุปก่อน แล้วเทียบรายละเอียดออเดอร์ กะ หรือการชำระเงิน", "ยืนยันขอบเขตกับจำนวนแถวก่อนส่งออก พิมพ์ หรือส่งให้บัญชี"], completion: "ยอดสรุปและจำนวนรายละเอียดตรงกับออเดอร์หรือกะต้นทาง", caution: "วันที่อิงเขตเวลาและจุดตัดวันทำการของร้าน ออเดอร์ยกเลิก คืนเงิน และทดสอบอาจไม่ถูกรวม" },
      integration: { summary: "“{feature}” เชื่อมบริการภายนอกหรืออุปกรณ์ ต้องจับคู่และทดสอบก่อนเปิดใช้งานจริง", steps: ["อ่านข้อกำหนดคู่ค้า บัญชี หรืออุปกรณ์ และปิดสวิตช์จริงระหว่างทดสอบ", "กรอกข้อมูลเชื่อมต่อเฉพาะช่องที่กำหนด ห้ามวางรหัสผ่านหรือกุญแจในหมายเหตุ", "จับคู่ร้าน สินค้า เครื่องพิมพ์ หรือการแจ้งเตือน แล้วทดสอบหนึ่งครั้ง", "เปิดหลังทดสอบสำเร็จเท่านั้น และติดตามข้อผิดพลาดกับการแจ้งเตือน"], completion: "ข้อมูลทดสอบไปกลับถูกต้อง การจับคู่ถูก และเมื่อพลาดมีสาเหตุที่แก้ได้", caution: "ข้อความว่าบันทึกแล้วไม่ได้แปลว่าเชื่อมต่อแล้ว ต้องดูผลทดสอบจริง" },
      security: { summary: "“{feature}” กระทบสิทธิ์ อุปกรณ์ หรือการตั้งค่าสำคัญ ตรวจผู้ทำและขอบเขตก่อน", steps: ["ตรวจบัญชี บทบาท ธุรกิจ และขอบเขตร้านที่เข้าสู่ระบบ", "ดูชื่อเป้าหมาย สถานะ และเวลาแก้ล่าสุดเพื่อไม่เลือกผิด", "แก้เฉพาะที่จำเป็น ปิด ออกจากระบบ หรือเพิกถอนทีละรายการ", "รีเฟรชหรือเข้าสู่ระบบใหม่เพื่อตรวจ แล้วดูบันทึกตรวจสอบ"], completion: "บทบาทที่มีสิทธิ์ใช้งานได้ ผู้ไม่มีสิทธิ์มองไม่เห็น และการเปลี่ยนแปลงมีบันทึก", caution: "อย่าใช้บัญชีร่วมกัน ตรวจว่ามีผู้ดูแลอื่นก่อนลบเจ้าของคนสุดท้ายหรือออกจากระบบหลายอุปกรณ์" },
    },
    notes: {
      availability: "สั่งกลับบ้านต้องครบ 4 อย่าง: เปิดโมดูล ร้านรับออเดอร์ QR ใช้ได้ และมีช่วงเวลาที่จองได้",
      specialHours: "วันที่ห้ามซ้ำ วันเปิดต้องมีเวลาเริ่มและสิ้นสุด ส่วนวันหยุดใช้เฉพาะวันที่เลือก",
      productVisibility: "ขายหมดหรือซ่อนออนไลน์กระทบเฉพาะ QR/Menu หากยังขายหน้าร้านให้คงสินค้าในหน้าพนักงาน",
      printing: "เบราว์เซอร์แจ้งว่าสำเร็จไม่ได้ยืนยันอุปกรณ์ ต้องตรวจการเชื่อมต่อ กระดาษ การตอบสนอง และสายลิ้นชัก",
      kds: "ออเดอร์ใหม่ควรเข้ารอยืนยันและแจ้งเตือน แม้ปิด KDS พนักงานยังต้องปิดสถานะออเดอร์",
      cashShift: "หลังปิดกะให้ใช้การแก้ไขหรือตรวจทาน เพื่อเก็บประวัติบัญชีเดิม",
      supply: "การเคลื่อนไหวสต็อก สูตร และตรวจนับกระทบต้นทุน ตรวจหน่วยก่อนรับเข้า ใช้ หรือปรับ",
      attendance: "การเตือนลงเวลาใช้กับพนักงานทั่วไป เจ้าของและผู้จัดการดูแลเปิดกะ ตรวจ และตารางตามสิทธิ์",
      integration: "ปิดการชำระเงิน ใบกำกับอิเล็กทรอนิกส์ และเดลิเวอรีไว้จนกว่าข้อมูล การจับคู่ และการทดสอบจะเสร็จ",
      accountSecurity: "ชื่ออุปกรณ์ใช้ช่วยจำเท่านั้น ออกจากอุปกรณ์ที่ไม่รู้จัก เปลี่ยนรหัสผ่าน และตรวจวิธีเข้าสู่ระบบ",
    },
  },
} as const satisfies Record<AppLocale, MerchantGuideCopy>;

export function getMerchantGuideCopy(locale: AppLocale): MerchantGuideCopy {
  return copies[locale];
}

export function formatMerchantGuideText(template: string, feature: string) {
  return template.replaceAll("{feature}", feature);
}

export function formatMerchantGuideCount(template: string, count: number) {
  return template.replace("{count}", String(count));
}
