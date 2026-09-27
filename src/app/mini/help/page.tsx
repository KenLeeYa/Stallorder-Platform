import Link from "next/link";
export default function HelpPage() {
  return <main className="mx-auto max-w-lg space-y-4 p-4"><h1 className="text-2xl font-bold">需要協助</h1>
    <h2 className="font-semibold">沒有收到通知</h2><p>確認已加入攤點通好友且未封鎖，並在會員中心開啟交易通知。LINE 接受推播不代表裝置已收到；請以「我的訂單」進度為準。</p>
    <h2 className="font-semibold">付款尚未確定</h2><p>請勿重複付款。保留訂單並請店員查核付款結果。</p>
    <h2 className="font-semibold">餐點或取餐問題</h2><p>請從該筆訂單查看實際門市資訊，向該店員確認。若手機無法顯示 QR，可由店員查單並確認交付。</p>
    <Link className="inline-flex min-h-11 items-center underline" href="/mini/orders">查看我的訂單</Link>
  </main>;
}
