"use client";

import {
  AlertTriangle,
  ArrowUp,
  CalendarOff,
  ChevronDown,
  Clock3,
  Dices,
  History,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
} from "lucide-react";
import { FulfillmentTimePicker } from "@/components/fulfillment-time-picker";
import { QrOrderCartPanel } from "@/components/qr-order-cart-panel";
import type { QrOrderFlowController } from "@/components/qr-order-flow-controller";
import {
  LotteryDailyLimitDialog,
  LotteryResultDialog,
} from "@/components/qr-lottery-dialogs";
import { QrLanguageSelector } from "@/components/qr-language-selector";
import { QrSessionCountdown } from "@/components/qr-session-countdown";
import { SessionExpiryDialog } from "@/components/qr-session-expiry-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { QrOrderMenu } from "@/components/qr-order-menu";
import { formatMoney } from "@/lib/money";

type QrOrderFlowPresentationProps = {
  controller: QrOrderFlowController;
};

export function QrOrderFlowPresentation({
  controller,
}: QrOrderFlowPresentationProps) {
  const {
    activeCartStep,
    activeOrderingMode,
    addProductDraft,
    applyFulfillmentTime,
    availabilityRefreshing,
    availableLocales,
    bundleChoiceLabel,
    cancelLotteryRecommendation,
    cancelProductConfiguration,
    cartCloseButtonRef,
    cartContinueButtonRef,
    cartDialogOpen,
    cartLines,
    cartOpen,
    cartPanelRef,
    cartRestored,
    cartTriggerRef,
    categories,
    changeCartLineQuantity,
    changeLocale,
    checkoutBlocker,
    checkoutHeadingRef,
    closeCart,
    closeLotteryLimitDialog,
    configuringProductId,
    copy,
    customerName,
    customerNote,
    customerPhone,
    degradedMode,
    deliveryAddress,
    deliveryCopy,
    draftScheduledPickupAt,
    drawLottery,
    editingLineIds,
    editCartLine,
    fulfillment,
    handleTurnstileToken,
    hasUnappliedFulfillmentTime,
    isDrawingLottery,
    isLoading,
    isSubmitting,
    locale,
    localizedCategory,
    localizedGroupName,
    localizedOptionName,
    localizedProduct,
    localizedProductGroup,
    lotteryButtonRef,
    lotteryCarouselProductNames,
    lotteryDialogVisible,
    lotteryDraw,
    lotteryError,
    lotteryLimitDialogOpen,
    lotteryResultProduct,
    message,
    orderingAvailability,
    orderingEnabled,
    prefersReducedMotion,
    productConfigurationRef,
    productDrafts,
    refreshAvailability,
    reloadWithPersistedCart,
    scheduledPickupAt,
    selectBundleChoice,
    selectFulfillmentTime,
    selectNoteOption,
    session,
    sessionExpiryDialogOpen,
    sessionReady,
    sessionStartError,
    sessionTimePhase,
    setCartOpen,
    setCartStep,
    setCustomerName,
    setCustomerNote,
    setCustomerPhone,
    setDeliveryAddress,
    setMessage,
    setSessionTimePhase,
    setWaitAcknowledged,
    submitOrder,
    total,
    totalQuantity,
    turnstileRequested,
    turnstileResetKey,
    updateQuantity,
    visibleProducts,
    waitAcknowledged,
    acceptLotteryRecommendation,
  } = controller;

  if (isLoading) {
    return <main className="grid min-h-screen place-items-center px-5 text-sm text-stone-600">{copy.sessionLoading}</main>;
  }

  if (!session) {
    return (
      <main className="mx-auto min-h-screen max-w-lg px-5 py-16">
        <ShieldCheck className="h-8 w-8 text-red-700" />
        <h1 className="mt-4 text-2xl font-semibold">{copy.qrUnavailableTitle}</h1>
        <p role="alert" className="mt-3 text-sm leading-6 text-stone-600">{message}</p>
      </main>
    );
  }

  const fulfillmentTimeLabel = activeOrderingMode === "PREORDER"
    ? copy.preorderPickupTime
    : activeOrderingMode === "DELIVERY"
      ? copy.optionalDeliveryTime
      : copy.optionalPickupTime;
  const fulfillmentTimePicker = fulfillment.canSelect ? (
    <div className="min-w-0">
      <FulfillmentTimePicker
        slots={fulfillment.slots}
        value={fulfillment.value}
        onChange={selectFulfillmentTime}
        legend={fulfillmentTimeLabel}
        scheduledLabel={activeOrderingMode === "DELIVERY" ? copy.scheduledDeliveryTime : copy.scheduledPickupTime}
        dateLabel={activeOrderingMode === "PREORDER"
          ? copy.preorderPickupDate
          : activeOrderingMode === "DELIVERY" ? copy.deliveryDate : copy.pickupDate}
        timeLabel={activeOrderingMode === "PREORDER"
          ? copy.preorderPickupTime
          : activeOrderingMode === "DELIVERY" ? copy.deliveryTime : copy.pickupTime}
        unavailableDateMessage={copy.unavailableDate}
        allowAsap={fulfillment.allowAsap}
        required={fulfillment.required}
        disabled={!orderingEnabled}
        testId={fulfillment.testId}
      />
      {activeOrderingMode === "PREORDER" ? (
        <div className="mt-2 grid gap-2">
          <button
            type="button"
            disabled={!orderingEnabled || !hasUnappliedFulfillmentTime}
            onClick={() => applyFulfillmentTime(draftScheduledPickupAt)}
            className="min-h-11 w-full rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:bg-stone-200 disabled:text-stone-500"
          >
            {hasUnappliedFulfillmentTime ? copy.applyTime : copy.timeApplied}
          </button>
          {hasUnappliedFulfillmentTime ? (
            <p role="status" className="text-xs font-medium text-amber-800">
              {copy.unappliedTimeNotice}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;
  const cartPanel = (
    <QrOrderCartPanel
      session={session}
      cartLines={cartLines}
      activeCartStep={activeCartStep}
      activeOrderingMode={activeOrderingMode}
      locale={locale}
      copy={copy}
      deliveryCopy={deliveryCopy}
      orderingEnabled={orderingEnabled}
      totalQuantity={totalQuantity}
      total={total}
      customerName={customerName}
      customerPhone={customerPhone}
      deliveryAddress={deliveryAddress}
      customerNote={customerNote}
      waitAcknowledged={waitAcknowledged}
      fulfillmentTimePicker={fulfillmentTimePicker}
      turnstileRequested={turnstileRequested}
      turnstileResetKey={turnstileResetKey}
      checkoutBlocker={checkoutBlocker}
      message={message}
      isSubmitting={isSubmitting}
      closeButtonRef={cartCloseButtonRef}
      continueButtonRef={cartContinueButtonRef}
      checkoutHeadingRef={checkoutHeadingRef}
      localizedProduct={localizedProduct}
      localizedOptionName={localizedOptionName}
      bundleChoiceLabel={bundleChoiceLabel}
      onClose={closeCart}
      onChangeLineQuantity={changeCartLineQuantity}
      onEditLine={editCartLine}
      onContinueToCheckout={() => {
        setCartStep("CHECKOUT");
        window.requestAnimationFrame(() => checkoutHeadingRef.current?.focus());
      }}
      onBackToCart={() => {
        setCartStep("CART");
        window.requestAnimationFrame(() => cartContinueButtonRef.current?.focus());
      }}
      onCustomerNameChange={setCustomerName}
      onCustomerPhoneChange={setCustomerPhone}
      onDeliveryAddressChange={setDeliveryAddress}
      onCustomerNoteChange={setCustomerNote}
      onWaitAcknowledgedChange={(checked) => {
        setWaitAcknowledged(checked);
        setMessage("");
      }}
      onTurnstileToken={handleTurnstileToken}
      onSubmit={() => void submitOrder()}
    />
  );

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl gap-6 px-4 py-5 pb-28 md:grid-cols-[minmax(0,1fr)_340px] md:px-8 md:pb-5">
      <section>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm font-medium text-teal-800">{session.stall.location}</p><h1 className="mt-1 text-3xl font-semibold">{session.stall.name}</h1></div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <QrLanguageSelector locale={locale} locales={availableLocales} label={copy.language} menuLabel={copy.menuLanguage} onChange={changeLocale} />
          </div>
        </div>
        <p className="mt-2 text-sm font-semibold text-stone-700">{session.stall.fulfillmentType === "DINE_IN" ? copy.dineIn(session.stall.table?.label ?? "") : session.stall.fulfillmentType === "DELIVERY" ? deliveryCopy.delivery : copy.takeout}</p>
        {activeOrderingMode === "PREORDER" ? <p className="mt-2 rounded-md bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900">{copy.preorderOnlyNotice}</p> : null}
        {session.specialClosure ? (
          <section
            role={session.specialClosure.isActive ? "alert" : "status"}
            data-testid="qr-special-closure"
            className={`mt-4 flex items-start gap-3 rounded-lg border p-4 ${session.specialClosure.isActive ? "border-red-300 bg-red-50 text-red-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}
          >
            <CalendarOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="font-semibold">{session.specialClosure.title}</h2>
              <p className="mt-1 text-sm font-semibold">{formatSpecialClosureRange(session.specialClosure, locale)}</p>
              {session.specialClosure.message ? <p className="mt-1 text-sm leading-6">{session.specialClosure.message}</p> : null}
            </div>
          </section>
        ) : null}
        {degradedMode ? (
          <div role="alert" className="mt-4 border-y border-amber-300 bg-amber-50 px-3 py-4 text-amber-950">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold">{copy.degradedTitle}</h2>
                <p className="mt-1 text-sm leading-6">
                  {orderingAvailability === "UNAVAILABLE" && !sessionReady && sessionStartError
                    ? sessionStartError
                    : copy.degradedMessage}
                </p>
              </div>
              <button
                type="button"
                aria-label={copy.retryAvailability}
                disabled={availabilityRefreshing}
                onClick={() => refreshAvailability(true)}
                className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md border border-amber-400 bg-white px-3 text-xs font-semibold disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${availabilityRefreshing ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{copy.retryAvailability}</span>
              </button>
            </div>
          </div>
        ) : null}
        {!session.specialClosure?.isActive ? <QrSessionCountdown
          active={sessionReady}
          expiresAt={session.expiresAt}
          availabilityStatus={orderingAvailability}
          activeLabel={copy.timeRemaining}
          inactiveLabel={degradedMode ? copy.degradedTitle : copy.sessionLoading}
          onPhaseChange={setSessionTimePhase}
        /> : null}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-y border-stone-200 py-3 text-sm text-stone-700">
          <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4 text-teal-700" />{activeOrderingMode === "PREORDER" ? copy.preorderTimeGuidance : copy.estimatedWaitRange(session.estimatedWaitMinMinutes, session.estimatedWaitMaxMinutes)}</span>
          {session.lastTableOrderAt ? <span className="inline-flex items-center gap-2"><History className="h-4 w-4 text-stone-500" />{copy.lastTableOrder(new Date(session.lastTableOrderAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }))}</span> : null}
        </div>
        {cartRestored ? <p role="status" className="mt-3 text-sm font-medium text-emerald-800">{copy.cartRestored}</p> : null}

        {activeOrderingMode === "PREORDER" && fulfillmentTimePicker ? (
          <section className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-4" aria-label={fulfillmentTimeLabel}>
            <p className="mb-3 text-sm leading-6 text-sky-900">{copy.preorderSelectTimeFirst}</p>
            {fulfillmentTimePicker}
          </section>
        ) : null}

        {session.lotteryEnabled && activeOrderingMode === "DEFAULT" ? (
          <section className="mt-4 rounded-lg border border-violet-200 bg-violet-50 p-4" aria-label={copy.lotteryRegionLabel}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="font-semibold text-violet-950">{copy.lotterySectionTitle}</h2><p className="mt-1 text-sm leading-6 text-violet-800">{copy.lotterySectionDescription}</p></div>
              <button ref={lotteryButtonRef} type="button" disabled={!orderingEnabled || isDrawingLottery} onClick={() => void drawLottery()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-50"><Dices className="h-4 w-4" />{isDrawingLottery ? copy.lotteryDrawingButton : lotteryDraw ? copy.lotteryAlreadyDrawn : copy.lotteryStart}</button>
            </div>
            {lotteryError ? (
              <p role="alert" className="mt-3 text-sm font-medium text-red-700">
                {lotteryError === "PRODUCT_UNAVAILABLE"
                  ? copy.lotteryUnavailableProduct
                  : copy.lotteryUnavailable}
              </p>
            ) : null}
            {lotteryDraw ? <div className="mt-3 border-t border-violet-200 pt-3"><span data-testid="lottery-recommendation-basis" className="inline-flex rounded-full bg-white px-2 py-1 text-xs font-semibold text-violet-900">{lotteryDraw.recommendationBasis === "BEST_SELLER" ? copy.lotteryBestSellerBasis : copy.lotteryDiscoveryBasis}</span><p role="status" className="mt-2 text-sm font-semibold text-violet-950">{copy.lotteryRecommendation(lotteryResultProduct ? localizedProduct(lotteryResultProduct).name : lotteryDraw.productName)}{lotteryDraw.discountWon && lotteryDraw.discountLabel ? <> {copy.lotteryDiscountResult(lotteryDraw.discountLabel)}</> : null}</p>{lotteryDraw.discountWon ? <p className="mt-1 text-xs text-violet-800">{copy.lotteryDiscountNotice}</p> : null}</div> : null}
          </section>
        ) : null}

        <QrOrderMenu
          categories={categories}
          visibleProducts={visibleProducts}
          activeOrderingMode={activeOrderingMode}
          scheduledPickupAt={scheduledPickupAt}
          currency={session.stall.currency}
          locale={locale}
          copy={copy}
          orderingEnabled={orderingEnabled}
          cartLines={cartLines}
          productDrafts={productDrafts}
          editingLineIds={editingLineIds}
          configuringProductId={configuringProductId}
          sessionExpiryDialogOpen={sessionExpiryDialogOpen}
          configurationRef={productConfigurationRef}
          localizedCategory={localizedCategory}
          localizedProduct={localizedProduct}
          localizedProductGroup={localizedProductGroup}
          localizedGroupName={localizedGroupName}
          localizedOptionName={localizedOptionName}
          bundleChoiceLabel={bundleChoiceLabel}
          onUpdateQuantity={updateQuantity}
          onCancelConfiguration={cancelProductConfiguration}
          onSelectNoteOption={selectNoteOption}
          onSelectBundleChoice={selectBundleChoice}
          onAddProduct={addProductDraft}
        />
      </section>

      {cartDialogOpen ? <button type="button" aria-label={copy.close} onClick={closeCart} className="fixed inset-0 z-30 bg-black/45 md:hidden" /> : null}
      <aside
        ref={cartPanelRef}
        data-testid="qr-cart-panel"
        role={cartDialogOpen ? "dialog" : undefined}
        aria-modal={cartDialogOpen ? true : undefined}
        aria-labelledby="qr-cart-heading"
        tabIndex={cartDialogOpen ? -1 : undefined}
        className={`${cartDialogOpen ? "safe-area-bottom fixed inset-x-0 bottom-0 z-40 max-h-[88dvh] overflow-y-auto rounded-t-lg border-t border-stone-200 shadow-2xl" : "hidden"} bg-white p-5 md:sticky md:top-5 md:block md:h-fit md:max-h-none md:overflow-visible md:rounded-lg md:border md:shadow-none`}
      >
        {cartPanel}
      </aside>
      {!cartOpen ? (
        <button
          data-testid="qr-back-to-top"
          type="button"
          title={copy.backToTop}
          aria-label={copy.backToTop}
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className={`${totalQuantity > 0 ? "bottom-20" : "bottom-4"} fixed right-4 z-20 grid h-11 w-11 place-items-center rounded-full border border-stone-300 bg-white/95 text-stone-800 shadow-lg backdrop-blur hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 md:bottom-5 md:right-96 lg:right-[calc(50vw-8rem)]`}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      ) : null}
      {totalQuantity > 0 && !cartOpen ? (
        <button ref={cartTriggerRef} data-testid="qr-mobile-cart-summary" type="button" onClick={() => { setCartStep("CART"); setCartOpen(true); }} className="safe-area-bottom fixed inset-x-3 bottom-0 z-30 flex min-h-16 items-center gap-3 rounded-t-lg bg-stone-900 px-4 pt-3 text-left text-white shadow-2xl md:hidden">
          <ShoppingCart className="h-5 w-5 shrink-0" />
          <span className="min-w-0 flex-1"><span className="block text-xs text-stone-300">{copy.itemCount(totalQuantity)}</span><strong>{formatMoney(total, session.stall.currency, locale)}</strong></span>
          <span className="inline-flex items-center gap-1 text-sm font-semibold">{copy.viewOrder}<ChevronDown className="h-4 w-4 rotate-180" /></span>
        </button>
      ) : null}
      {lotteryLimitDialogOpen && !sessionExpiryDialogOpen ? (
        <LotteryDailyLimitDialog
          onClose={closeLotteryLimitDialog}
          returnFocusRef={lotteryButtonRef}
          title={copy.lotteryDailyLimitTitle}
          description={copy.lotteryDailyLimitDescription}
          buttonLabel={copy.lotteryAcknowledge}
        />
      ) : null}
      {lotteryDialogVisible ? (
        <LotteryResultDialog
          drawing={isDrawingLottery}
          product={lotteryResultProduct}
          carouselProductNames={lotteryCarouselProductNames}
          prefersReducedMotion={prefersReducedMotion}
          draw={lotteryDraw}
          title={isDrawingLottery ? copy.lotteryDrawingTitle : copy.lotteryResultTitle}
          drawingDescription={copy.lotteryDrawingDescription}
          recommendationBasis={lotteryDraw?.recommendationBasis === "BEST_SELLER"
            ? copy.lotteryBestSellerBasis
            : copy.lotteryDiscoveryBasis}
          recommendation={lotteryDraw
            ? copy.lotteryRecommendation(lotteryResultProduct ? localizedProduct(lotteryResultProduct).name : lotteryDraw.productName)
            : ""}
          discountResult={lotteryDraw?.discountWon && lotteryDraw.discountLabel
            ? copy.lotteryDiscountResult(lotteryDraw.discountLabel)
            : copy.lotteryNoDiscountResult}
          discountNotice={copy.lotteryDiscountNotice}
          acceptLabel={copy.lotteryAccept}
          cancelLabel={copy.lotteryCancel}
          onAccept={acceptLotteryRecommendation}
          onCancel={cancelLotteryRecommendation}
        />
      ) : null}
      {sessionExpiryDialogOpen && !lotteryDialogVisible ? (
        <SessionExpiryDialog
          expired={sessionTimePhase === "EXPIRED"}
          title={sessionTimePhase === "EXPIRED" ? copy.sessionExpiredTitle : copy.sessionExpiringTitle}
          description={sessionTimePhase === "EXPIRED"
            ? copy.sessionExpiredRefreshDescription
            : copy.sessionExpiringDescription}
          buttonLabel={copy.refreshSession}
          onRefresh={reloadWithPersistedCart}
        />
      ) : null}
    </main>
  );
}

function formatSpecialClosureRange(
  closure: { startsOn: string; endsOn: string },
  locale: string,
) {
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const start = formatter.format(new Date(`${closure.startsOn}T00:00:00.000Z`));
  if (closure.startsOn === closure.endsOn) return start;
  const end = formatter.format(new Date(`${closure.endsOn}T00:00:00.000Z`));
  return `${start} – ${end}`;
}
