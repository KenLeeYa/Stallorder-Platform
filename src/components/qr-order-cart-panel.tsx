import type { ReactNode, RefObject } from "react";
import { AlertTriangle, Minus, Plus, Send, X } from "lucide-react";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { deliveryOrderMessages } from "@/lib/delivery-order-i18n";
import { formatMoney } from "@/lib/money";
import { PHONE_INPUT_PATTERN } from "@/lib/phone-input-pattern";
import { bundlePriceAdjustment } from "@/lib/product-bundle-selection";
import { notePriceAdjustment } from "@/lib/product-note-selection";
import type { QrCartLine, QrCartOrderingMode } from "@/lib/qr-cart";
import type {
  PublicMenuBundleChoiceOption,
  PublicMenuNoteOption,
  PublicMenuProduct,
} from "@/lib/public-menu-types";
import { qrOrderMessages, type QrLocale } from "@/lib/qr-order-i18n";
import type { QrOrderSession } from "@/components/qr-order-flow-orchestration";
import { CheckoutInvoiceSelector } from "@/components/checkout-invoice-selector";
import type { InvoiceBuyerSelection } from "@/lib/e-invoice-checkout-contract";
import type { QrOrderEntryChannel } from "@/components/qr-order-flow-orchestration";

export { resolveQrCheckoutBlocker } from "@/components/qr-order-checkout-controller";

type QrOrderCartPanelProps = {
  session: QrOrderSession;
  entryChannel: QrOrderEntryChannel;
  cartLines: QrCartLine[];
  activeCartStep: "CART" | "CHECKOUT";
  activeOrderingMode: QrCartOrderingMode;
  locale: QrLocale;
  copy: (typeof qrOrderMessages)[QrLocale];
  deliveryCopy: (typeof deliveryOrderMessages)[QrLocale];
  orderingEnabled: boolean;
  totalQuantity: number;
  total: number;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  customerNote: string;
  invoiceBuyerSelection: InvoiceBuyerSelection;
  waitAcknowledged: boolean;
  fulfillmentTimePicker: ReactNode;
  turnstileRequested: boolean;
  turnstileResetKey: number;
  checkoutBlocker: string;
  message: string;
  isSubmitting: boolean;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  continueButtonRef: RefObject<HTMLButtonElement | null>;
  checkoutHeadingRef: RefObject<HTMLHeadingElement | null>;
  localizedProduct: (product: PublicMenuProduct) => { name: string };
  localizedOptionName: (option: PublicMenuNoteOption) => string;
  bundleChoiceLabel: (option: PublicMenuBundleChoiceOption) => string;
  onClose: () => void;
  onChangeLineQuantity: (lineId: string, quantity: number) => void;
  onEditLine: (line: QrCartLine) => void;
  onContinueToCheckout: () => void;
  onBackToCart: () => void;
  onCustomerNameChange: (value: string) => void;
  onCustomerPhoneChange: (value: string) => void;
  onDeliveryAddressChange: (value: string) => void;
  onCustomerNoteChange: (value: string) => void;
  onInvoiceBuyerSelectionChange: (value: InvoiceBuyerSelection) => void;
  onWaitAcknowledgedChange: (value: boolean) => void;
  onTurnstileToken: (token: string | null) => void;
  onSubmit: () => void;
};

export function QrOrderCartPanel({
  session,
  entryChannel,
  cartLines,
  activeCartStep,
  activeOrderingMode,
  locale,
  copy,
  deliveryCopy,
  orderingEnabled,
  totalQuantity,
  total,
  customerName,
  customerPhone,
  deliveryAddress,
  customerNote,
  invoiceBuyerSelection,
  waitAcknowledged,
  fulfillmentTimePicker,
  turnstileRequested,
  turnstileResetKey,
  checkoutBlocker,
  message,
  isSubmitting,
  closeButtonRef,
  continueButtonRef,
  checkoutHeadingRef,
  localizedProduct,
  localizedOptionName,
  bundleChoiceLabel,
  onClose,
  onChangeLineQuantity,
  onEditLine,
  onContinueToCheckout,
  onBackToCart,
  onCustomerNameChange,
  onCustomerPhoneChange,
  onDeliveryAddressChange,
  onCustomerNoteChange,
  onInvoiceBuyerSelectionChange,
  onWaitAcknowledgedChange,
  onTurnstileToken,
  onSubmit,
}: QrOrderCartPanelProps) {
  const showCustomerIdentity = entryChannel !== "QR";
  const requiresCustomerDetails = showCustomerIdentity && (
    session.stall.fulfillmentType === "TAKEOUT"
    || session.stall.fulfillmentType === "DELIVERY"
  );

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 id="qr-cart-heading" className="text-lg font-semibold">{copy.yourOrder}</h2>
        <button
          ref={closeButtonRef}
          type="button"
          title={copy.close}
          aria-label={copy.close}
          onClick={onClose}
          className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 md:hidden"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {cartLines.length > 0 ? (
        <div data-testid="qr-cart-lines" className={`${activeCartStep === "CART" ? "block" : "hidden"} mt-4 space-y-3 border-b border-stone-200 pb-4 md:block`}>
          {cartLines.map((line, index) => {
            const product = session.products.find((candidate) => candidate.id === line.productId);
            if (!product) return null;
            const productCopy = localizedProduct(product);
            const noteLabels = product.noteGroups.flatMap((group) => group.options)
              .filter((option) => line.noteOptionIds.includes(option.id))
              .map(localizedOptionName);
            const bundleLabels = product.bundleChoiceGroups.flatMap((group) => group.options)
              .filter((option) => line.bundleChoiceIds.includes(option.id))
              .map(bundleChoiceLabel);
            const unitPrice = Math.max(
              0,
              product.price
                + notePriceAdjustment(product.noteGroups, line.noteOptionIds)
                + bundlePriceAdjustment(product.bundleChoiceGroups, line.bundleChoiceIds),
            );
            const configurable = product.noteGroups.length > 0 || product.bundleChoiceGroups.length > 0;
            return (
              <article
                key={line.id}
                data-testid="qr-cart-line"
                data-cart-line-id={line.id}
                data-product-id={line.productId}
                className="rounded-md border border-stone-200 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{productCopy.name}</h3>
                    {[...noteLabels, ...bundleLabels].length > 0 ? (
                      <p className="mt-1 text-xs leading-5 text-stone-600">{[...noteLabels, ...bundleLabels].join("、")}</p>
                    ) : null}
                  </div>
                  <strong className="shrink-0 text-sm">{formatMoney(unitPrice * line.quantity, session.stall.currency, locale)}</strong>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" aria-label={copy.decrease(`${productCopy.name} ${index + 1}`)} disabled={!orderingEnabled} onClick={() => onChangeLineQuantity(line.id, line.quantity - 1)} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                  <span className="min-w-7 text-center text-sm font-semibold">{line.quantity}</span>
                  <button type="button" aria-label={copy.increase(`${productCopy.name} ${index + 1}`)} disabled={!orderingEnabled} onClick={() => onChangeLineQuantity(line.id, line.quantity + 1)} className="grid h-10 w-10 place-items-center rounded-md border border-stone-300 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                  <span className="flex-1" />
                  {configurable ? <button type="button" disabled={!orderingEnabled} onClick={() => onEditLine(line)} className="min-h-10 rounded-md px-2 text-xs font-semibold text-teal-800 disabled:opacity-40">{copy.editCartItem}</button> : null}
                  <button type="button" disabled={!orderingEnabled} onClick={() => onChangeLineQuantity(line.id, 0)} className="min-h-10 rounded-md px-2 text-xs font-semibold text-red-700 disabled:opacity-40">{copy.removeCartItem}</button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}
      {cartLines.length > 0 && activeCartStep === "CART" ? (
        <button ref={continueButtonRef} type="button" onClick={onContinueToCheckout} className="mt-4 min-h-12 w-full rounded-md bg-teal-800 px-4 text-sm font-semibold text-white md:hidden">
          {copy.continueToCheckout}
        </button>
      ) : null}
      <div data-testid="qr-checkout-panel" className={`${activeCartStep === "CHECKOUT" ? "block" : "hidden"} md:block`}>
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-stone-200 pt-4">
          <h3 ref={checkoutHeadingRef} tabIndex={-1} className="font-semibold outline-none">{copy.checkoutDetails}</h3>
          <button type="button" onClick={onBackToCart} className="min-h-10 rounded-md px-2 text-xs font-semibold text-teal-800 md:hidden">{copy.backToCart}</button>
        </div>
        <div className="mt-4 space-y-3">
          {showCustomerIdentity ? (
            <input
              required={requiresCustomerDetails}
              type="text"
              autoComplete="name"
              enterKeyHint="next"
              aria-label={copy.customerName}
              className="form-input"
              placeholder={requiresCustomerDetails
                ? copy.customerNameRequiredPlaceholder
                : copy.customerNamePlaceholder}
              maxLength={50}
              value={customerName}
              disabled={!orderingEnabled}
              onChange={(event) => onCustomerNameChange(event.target.value)}
            />
          ) : null}
          {requiresCustomerDetails ? (
            <input
              required
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              enterKeyHint="next"
              aria-label={deliveryCopy.phone}
              className="form-input"
              placeholder={deliveryCopy.phonePlaceholder}
              maxLength={30}
              pattern={PHONE_INPUT_PATTERN}
              value={customerPhone}
              disabled={!orderingEnabled}
              onChange={(event) => onCustomerPhoneChange(event.target.value)}
            />
          ) : null}
          {session.stall.fulfillmentType === "DELIVERY" ? (
              <textarea
                required
                autoComplete="street-address"
                aria-label={deliveryCopy.address}
                className="form-input min-h-24"
                placeholder={deliveryCopy.addressPlaceholder}
                maxLength={300}
                value={deliveryAddress}
                disabled={!orderingEnabled}
                onChange={(event) => onDeliveryAddressChange(event.target.value)}
              />
          ) : null}
          {activeOrderingMode !== "PREORDER" ? fulfillmentTimePicker : null}
          <textarea
            aria-label={copy.orderNote}
            className="form-input min-h-20"
            placeholder={copy.orderNotePlaceholder(session.limits.maxNoteLength)}
            maxLength={session.limits.maxNoteLength}
            value={customerNote}
            disabled={!orderingEnabled}
            onChange={(event) => onCustomerNoteChange(event.target.value)}
          />
          {session.invoiceCheckout ? (
            <CheckoutInvoiceSelector
              config={session.invoiceCheckout}
              locale={locale}
              value={invoiceBuyerSelection}
              disabled={!orderingEnabled}
              onChange={onInvoiceBuyerSelectionChange}
            />
          ) : null}
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-stone-200 pt-4">
          <span className="text-sm text-stone-600">{copy.itemCount(totalQuantity)}</span>
          <strong>{formatMoney(total, session.stall.currency, locale)}</strong>
        </div>
        {session.requiresWaitAcknowledgment ? (
          <label className="mt-4 flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
            <input
              type="checkbox"
              className="mt-1 shrink-0"
              checked={waitAcknowledged}
              disabled={!orderingEnabled}
              onChange={(event) => onWaitAcknowledgedChange(event.target.checked)}
            />
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{copy.waitAcknowledgment(session.estimatedWaitMinMinutes, session.estimatedWaitMaxMinutes)}</span>
          </label>
        ) : null}
        <div className="mt-4 min-h-16">
          {turnstileRequested && orderingEnabled ? (
            <TurnstileWidget
              resetKey={turnstileResetKey}
              locale={locale}
              label={copy.securityVerification}
              missingKeyMessage={copy.securityNotConfigured}
              onToken={onTurnstileToken}
            />
          ) : null}
        </div>
        {checkoutBlocker ? <p data-testid="qr-checkout-blocker" role="status" className="mt-3 text-sm font-medium text-amber-800">{checkoutBlocker}</p> : null}
        <button type="button" disabled={isSubmitting || Boolean(checkoutBlocker)} onClick={onSubmit} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          <Send className="h-4 w-4" />
          {isSubmitting ? copy.submitting : copy.submitOrder}
        </button>
        <p className="mt-3 text-xs leading-5 text-stone-500">{copy.confirmationNotice}</p>
        {message ? <p role="alert" className="mt-3 text-sm text-red-700">{message}</p> : null}
      </div>
    </>
  );
}
