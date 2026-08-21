const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

type BaseDialogLifecycleOptions = {
  panel: HTMLElement | null;
  initialFocus: HTMLElement | null;
  onDismiss: () => void;
  visibleFocusOnly: boolean;
};

export function startQrOrderCartDialogLifecycle({
  panel,
  closeButton,
  onClose,
}: {
  panel: HTMLElement | null;
  closeButton: HTMLButtonElement | null;
  onClose: () => void;
}) {
  const desktopQuery = window.matchMedia("(min-width: 768px)");
  if (desktopQuery.matches) {
    const closeFrame = window.requestAnimationFrame(onClose);
    return () => window.cancelAnimationFrame(closeFrame);
  }

  const stopDialog = startDialogLifecycle({
    panel,
    initialFocus: closeButton,
    onDismiss: onClose,
    visibleFocusOnly: true,
  });
  const handleDesktopChange = (event: MediaQueryListEvent) => {
    if (event.matches) onClose();
  };
  desktopQuery.addEventListener("change", handleDesktopChange);

  return () => {
    desktopQuery.removeEventListener("change", handleDesktopChange);
    stopDialog();
  };
}

export function startQrOrderProductDialogLifecycle({
  panel,
  onCancel,
}: {
  panel: HTMLElement | null;
  onCancel: () => void;
}) {
  return startDialogLifecycle({
    panel,
    initialFocus: panel,
    onDismiss: onCancel,
    visibleFocusOnly: false,
  });
}

function startDialogLifecycle({
  panel,
  initialFocus,
  onDismiss,
  visibleFocusOnly,
}: BaseDialogLifecycleOptions) {
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const focusFrame = window.requestAnimationFrame(() => initialFocus?.focus());
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      panel?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
    ).filter((element) => !visibleFocusOnly || element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      panel?.focus();
    } else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", handleKeyDown);

  return () => {
    window.cancelAnimationFrame(focusFrame);
    document.removeEventListener("keydown", handleKeyDown);
    document.body.style.overflow = previousOverflow;
  };
}
