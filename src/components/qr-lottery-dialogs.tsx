"use client";

import { Dices } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ProductImage } from "@/components/product-image";
import type { PublicMenuProduct } from "@/lib/public-menu-types";

export type LotteryDraw = {
  drawId: string;
  productId: string;
  productName: string;
  recommendationBasis: "BEST_SELLER" | "DISCOVERY";
  discountWon: boolean;
  discountLabel: string | null;
};

export function LotteryResultDialog({
  drawing,
  product,
  carouselProductNames,
  prefersReducedMotion,
  draw,
  title,
  drawingDescription,
  recommendationBasis,
  recommendation,
  discountResult,
  discountNotice,
  acceptLabel,
  cancelLabel,
  onAccept,
  onCancel,
}: {
  drawing: boolean;
  product: PublicMenuProduct | null;
  carouselProductNames: string[];
  prefersReducedMotion: boolean;
  draw: LotteryDraw | null;
  title: string;
  drawingDescription: string;
  recommendationBasis: string;
  recommendation: string;
  discountResult: string;
  discountNotice: string;
  acceptLabel: string;
  cancelLabel: string;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const acceptButtonRef = useRef<HTMLButtonElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const [carouselIndex, setCarouselIndex] = useState(0);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!drawing || prefersReducedMotion || carouselProductNames.length < 2) return;
    const timer = window.setInterval(() => {
      setCarouselIndex((index) => (index + 1) % carouselProductNames.length);
    }, 160);
    return () => window.clearInterval(timer);
  }, [carouselProductNames.length, drawing, prefersReducedMotion]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      if (drawing) dialogRef.current?.focus();
      else acceptButtonRef.current?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !drawing) {
        event.preventDefault();
        onCancelRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      event.preventDefault();
      if (drawing) {
        dialogRef.current?.focus();
        return;
      }
      if (event.shiftKey && document.activeElement === acceptButtonRef.current) {
        cancelButtonRef.current?.focus();
      } else if (!event.shiftKey && document.activeElement === cancelButtonRef.current) {
        acceptButtonRef.current?.focus();
      } else if (event.shiftKey) {
        acceptButtonRef.current?.focus();
      } else {
        cancelButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [drawing]);

  const carouselProductName = carouselProductNames[
    carouselIndex % Math.max(1, carouselProductNames.length)
  ] ?? "";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lottery-result-title"
        aria-describedby="lottery-result-description"
        data-testid="lottery-result-dialog"
        data-phase={drawing ? "drawing" : "result"}
        tabIndex={-1}
        className="w-full max-w-sm rounded-xl bg-white p-5 text-stone-900 shadow-2xl outline-none"
      >
        <h2 id="lottery-result-title" className="text-xl font-semibold text-violet-950">{title}</h2>
        {drawing ? (
          <div className="mt-5 text-center">
            <Dices aria-hidden="true" className="mx-auto h-10 w-10 text-violet-700 motion-safe:animate-spin" />
            <p id="lottery-result-description" className="mt-3 text-sm leading-6 text-stone-600">{drawingDescription}</p>
            <p data-testid="lottery-product-carousel" className="mt-3 min-h-6 font-semibold text-violet-900 motion-safe:animate-pulse">{carouselProductName}</p>
          </div>
        ) : draw && product ? (
          <>
            <div id="lottery-result-description" className="mt-4 flex items-center gap-3 rounded-lg bg-violet-50 p-3">
              {product.imageUrl ? (
                <ProductImage src={product.imageUrl} alt={product.name} width={80} height={80} sizes="80px" className="h-20 w-20 shrink-0 rounded-md object-cover" />
              ) : (
                <div aria-hidden="true" className="grid h-20 w-20 shrink-0 place-items-center rounded-md bg-violet-100"><Dices className="h-7 w-7 text-violet-700" /></div>
              )}
              <div className="min-w-0">
                <span data-testid="lottery-result-basis" className="inline-flex rounded-full bg-white px-2 py-1 text-xs font-semibold text-violet-900">{recommendationBasis}</span>
                <p role="status" className="mt-2 font-semibold text-violet-950">{recommendation}</p>
              </div>
            </div>
            <p data-testid="lottery-discount-result" className="mt-4 text-sm font-semibold text-stone-800">{discountResult}</p>
            {draw.discountWon ? <p className="mt-1 text-xs leading-5 text-stone-600">{discountNotice}</p> : null}
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button ref={cancelButtonRef} type="button" onClick={onCancel} className="min-h-12 rounded-md border border-stone-300 px-4 text-sm font-semibold text-stone-700">{cancelLabel}</button>
              <button ref={acceptButtonRef} type="button" onClick={onAccept} className="min-h-12 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white">{acceptLabel}</button>
            </div>
          </>
        ) : null}
      </section>
    </div>
  );
}

export function LotteryDailyLimitDialog({
  onClose,
  returnFocusRef,
  title,
  description,
  buttonLabel,
}: {
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  title: string;
  description: string;
  buttonLabel: string;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const returnFocusElement = returnFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        closeButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      returnFocusElement?.focus();
    };
  }, [onClose, returnFocusRef]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="lottery-daily-limit-title"
        aria-describedby="lottery-daily-limit-description"
        className="w-full max-w-sm rounded-xl bg-white p-5 text-stone-900 shadow-2xl"
      >
        <h2 id="lottery-daily-limit-title" className="text-lg font-semibold">{title}</h2>
        <p id="lottery-daily-limit-description" className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="mt-5 min-h-11 w-full rounded-md bg-violet-700 px-4 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700"
        >
          {buttonLabel}
        </button>
      </section>
    </div>
  );
}
