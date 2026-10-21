"use client";

import { useState } from "react";
import Link from "next/link";
import { Store, ReceiptText, CircleUserRound, CircleHelp, Bell, CheckCircle2 } from "lucide-react";
import { ContextualBackButton } from "@/components/contextual-back-button";

const tabs = ["店家", "我的訂單", "會員", "協助", "OA 模擬"] as const;
const icons = [Store, ReceiptText, CircleUserRound, CircleHelp, Bell];
const stages = ["店家確認中", "餐點準備中", "餐點已完成", "已完成取餐"];

export function LocalLinePreview() {
  const [tab, setTab] = useState<typeof tabs[number]>("店家");
  const [stage, setStage] = useState<number | null>(null);
  const [notifications, setNotifications] = useState(true);
  const [messages, setMessages] = useState<string[]>([]);
  function advance() {
    const next = stage === null ? 0 : Math.min(stage + 1, stages.length - 1);
    setStage(next);
    if (notifications) setMessages(previous => [...previous, stages[next]]);
    setTab("我的訂單");
  }
  return <div className="mini-shell">
    <header className="mini-brand"><span className="mini-brand-mark"><Store aria-hidden="true" /></span><strong>攤點通</strong></header>
    <main className="space-y-5">
      <ContextualBackButton fallbackHref="/merchant/dashboard">返回商戶介面</ContextualBackButton>
      <p role="status" className="mini-card text-sm">本機模擬：不建立真實訂單、不收付款、不傳送 LINE 訊息。重新整理會清空模擬資料；取餐碼不可用於交付。</p>
      <nav aria-label="LINE 模擬功能" className="grid grid-cols-3 gap-2 sm:grid-cols-5">{tabs.map((label, index) => {
        const Icon = icons[index];
        return <button key={label} type="button" aria-pressed={tab === label} onClick={() => setTab(label)} className={tab === label ? "mini-primary" : "mini-secondary"}><Icon className="size-4 shrink-0" aria-hidden="true" />{label}</button>;
      })}</nav>
      {tab === "店家" && <><div className="mini-hero"><p className="mini-eyebrow">每一餐，都有好照應</p><h1>今天，想吃點什麼？</h1></div><section className="mini-card space-y-4"><h2 className="font-bold">越好吃一中店 · 模擬</h2><p>測試餐點 1 份 · NT$30</p><button type="button" onClick={advance} disabled={stage !== null} className="mini-primary">建立模擬訂單</button><Link href="/store/aming-01?view=menu" className="mini-secondary">開啟本機實際菜單</Link></section></>}
      {tab === "我的訂單" && <><h1>我的訂單</h1>{stage === null ? <p className="mini-card">尚無模擬訂單，請先選擇店家。</p> : <section className="mini-card space-y-4"><p className="mini-eyebrow">越好吃一中店 · 模擬</p><h2 className="text-2xl font-bold">{stages[stage]}</h2><dl className="mini-detail-rows"><div><dt>訂單</dt><dd>DEMO-001</dd></div><div><dt>金額</dt><dd>NT$30 · 模擬已付款</dd></div><div><dt>取餐號碼</dt><dd>001 · 示意，非有效憑證</dd></div></dl>{stage < 3 ? <button type="button" onClick={advance} className="mini-primary">模擬店員：{stages[stage + 1]}</button> : <p className="mini-status"><CheckCircle2 aria-hidden="true" />模擬流程完成</p>}</section>}</>}
      {tab === "會員" && <><h1>平台會員中心</h1><section className="mini-card space-y-4"><p>目前為示意會員，未執行 LINE 登入。</p><label className="flex min-h-12 items-center gap-3"><input type="checkbox" checked={notifications} onChange={event => setNotifications(event.target.checked)} />接收模擬訂單與取餐通知</label><p className="mini-muted">僅影響本頁模擬訊息，不更動正式通知同意。</p></section></>}
      {tab === "協助" && <><h1>需要協助</h1><details className="mini-card mini-faq"><summary>沒有收到模擬通知</summary><p>請在會員頁開啟模擬通知。已關閉時仍可在我的訂單查看進度。</p></details><details className="mini-card mini-faq"><summary>如何測試真實 LINE？</summary><p>需要另行設定 HTTPS 測試入口與 LINE 測試帳號；本頁不驗證 LINE Pay、掃碼或 OA 送達。</p></details></>}
      {tab === "OA 模擬" && <><h1>攤點通 OA · 模擬訊息</h1>{messages.length === 0 ? <p className="mini-card">尚無模擬通知。</p> : messages.map((message, index) => <article key={index} className="mini-card space-y-3"><p className="mini-eyebrow">越好吃一中店 · 模擬</p><h2 className="text-xl font-bold">{message}</h2><p>訂單 DEMO-001 · 取餐號碼 001 · NT$30</p><button type="button" onClick={() => setTab("我的訂單")} className="mini-primary">查看訂單</button></article>)}<nav aria-label="OA 圖文選單模擬" className="grid grid-cols-2 gap-2">{tabs.slice(0, 4).map(label => <button key={label} type="button" onClick={() => setTab(label)} className="mini-secondary">{label}</button>)}</nav></>}
      <button type="button" onClick={() => { setStage(null); setMessages([]); setNotifications(true); setTab("店家"); }} className="mini-secondary">重設模擬流程</button>
    </main>
  </div>;
}
