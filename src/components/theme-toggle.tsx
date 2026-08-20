"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import {
  type InterfaceTheme,
  isInterfaceTheme,
  oppositeInterfaceTheme,
  THEME_STORAGE_KEY,
} from "@/lib/theme";
import { useAppLocale } from "@/components/locale-provider";

const themeChangeEvent = "stallorder:theme-change";

export function ThemeToggle() {
  const { t } = useAppLocale();
  const theme = useSyncExternalStore(subscribeToTheme, readTheme, readServerTheme);

  function toggleTheme() {
    const next = oppositeInterfaceTheme(theme);
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The current tab can still switch themes when persistent storage is unavailable.
    }
    window.dispatchEvent(new Event(themeChangeEvent));
  }

  const label = theme === "dark" ? t("theme.toLight") : t("theme.toDark");

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      aria-pressed={theme === "dark"}
      title={label}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 transition-colors hover:bg-stone-100"
    >
      <Moon aria-hidden="true" className="theme-switch-to-dark h-5 w-5" />
      <Sun aria-hidden="true" className="theme-switch-to-light hidden h-5 w-5" />
    </button>
  );
}

function subscribeToTheme(onStoreChange: () => void) {
  window.addEventListener(themeChangeEvent, onStoreChange);
  return () => window.removeEventListener(themeChangeEvent, onStoreChange);
}

function readTheme(): InterfaceTheme {
  const current = document.documentElement.dataset.theme;
  return isInterfaceTheme(current) ? current : "light";
}

function readServerTheme(): InterfaceTheme {
  return "light";
}
