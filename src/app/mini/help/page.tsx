import Link from "next/link";
import { Bell, CreditCard, QrCode, ChevronDown, ReceiptText } from "lucide-react";

const questions = [
  { title: "沒有收到通知", icon: Bell, text: "確認已加入攤點通好友且未封鎖，並在會員中心開啟交易通知。LINE 接受推播不代表裝置已收到；請以「我的訂單」進度為準。", href: "/mini/member", action: "檢查通知設定" },
  { title: "付款尚未確定", icon: CreditCard, text: "請勿重複付款。保留訂單並請店員查核付款結果。", href: "/mini/orders", action: "查看付款狀態" },
  { title: "餐點或取餐問題", icon: QrCode, text: "請從該筆訂單查看實際門市資訊，向該店員確認。若手機無法顯示 QR，可由店員查單並確認交付。", href: "/mini/orders", action: "查看訂單與門市" },
];
export default function HelpPage() {
  return <main className="space-y-5"><h1 className="font-bold">需要協助</h1>
    <div className="mini-hero"><ReceiptText className="mb-3 size-7" aria-hidden="true" /><h2 className="font-bold">先看看訂單的最新進度</h2><Link className="mini-primary mt-4" href="/mini/orders">查看我的訂單</Link></div>
    <h2 className="font-semibold">常見問題</h2>
    <div className="space-y-3">{questions.map(({ title, icon: Icon, text, href, action }) => <details key={title} className="mini-card mini-faq">
      <summary><Icon aria-hidden="true" /><span>{title}</span><ChevronDown aria-hidden="true" /></summary><p>{text}</p><Link className="mini-secondary mt-3 text-sm" href={href}>{action}</Link>
    </details>)}</div>
  </main>;
}
