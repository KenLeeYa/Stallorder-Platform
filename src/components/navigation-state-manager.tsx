"use client";

import { useEffect } from "react";
import {
  navigationRestoreKey,
  navigationReturnKey,
  navigationScrollKey,
  normalizeInternalNavigationPath,
} from "@/lib/navigation-return-state";

function currentInternalPath() {
  return normalizeInternalNavigationPath(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}

export function NavigationStateManager() {
  useEffect(() => {
    function rememberNavigation(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const sourcePath = currentInternalPath();
      const targetPath = normalizeInternalNavigationPath(`${url.pathname}${url.search}${url.hash}`);
      if (!sourcePath || !targetPath || sourcePath === targetPath) return;
      window.sessionStorage.setItem(navigationReturnKey(targetPath), sourcePath);
      window.sessionStorage.setItem(navigationScrollKey(sourcePath), String(window.scrollY));
    }

    function restoreRequestedScroll() {
      const path = currentInternalPath();
      if (!path || window.sessionStorage.getItem(navigationRestoreKey(path)) !== "1") return;
      window.sessionStorage.removeItem(navigationRestoreKey(path));
      const scrollY = Number(window.sessionStorage.getItem(navigationScrollKey(path)) ?? "0");
      if (!Number.isFinite(scrollY)) return;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.scrollTo({ top: scrollY })));
    }

    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(window.history);
    window.history.pushState = (...args) => {
      originalPushState(...args);
      window.dispatchEvent(new Event("stallorder:navigation-change"));
    };
    window.history.replaceState = (...args) => {
      originalReplaceState(...args);
      window.dispatchEvent(new Event("stallorder:navigation-change"));
    };

    document.addEventListener("click", rememberNavigation, true);
    window.addEventListener("popstate", restoreRequestedScroll);
    window.addEventListener("stallorder:navigation-change", restoreRequestedScroll);
    restoreRequestedScroll();
    return () => {
      document.removeEventListener("click", rememberNavigation, true);
      window.removeEventListener("popstate", restoreRequestedScroll);
      window.removeEventListener("stallorder:navigation-change", restoreRequestedScroll);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, []);

  return null;
}
