"use client";

import { useEffect } from "react";

export const SETTINGS_DIRTY_EVENT = "stallorder:settings-dirty";

export function useUnsavedSettings(scope: string, dirty: boolean) {
  useEffect(() => {
    window.dispatchEvent(new CustomEvent(SETTINGS_DIRTY_EVENT, { detail: { scope, dirty } }));
    return () => {
      window.dispatchEvent(new CustomEvent(SETTINGS_DIRTY_EVENT, { detail: { scope, dirty: false } }));
    };
  }, [dirty, scope]);
}
