"use client";

import { useEffect } from "react";
import {
  navigationHorizontalScrollKey,
  navigationRestoreKey,
  navigationReturnKey,
  navigationScrollKey,
  normalizeInternalNavigationPath,
} from "@/lib/navigation-return-state";

const horizontalToolbarSelector = "[data-persist-horizontal-scroll]";

function currentInternalPath() {
  return normalizeInternalNavigationPath(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
}

export function NavigationStateManager() {
  useEffect(() => {
    function rememberHorizontalToolbar(element: Element) {
      if (!(element instanceof HTMLElement)) return;
      const toolbarId = element.dataset.persistHorizontalScroll;
      if (!toolbarId) return;
      window.sessionStorage.setItem(
        navigationHorizontalScrollKey(toolbarId),
        String(element.scrollLeft),
      );
    }

    function rememberHorizontalToolbars() {
      document.querySelectorAll(horizontalToolbarSelector).forEach(rememberHorizontalToolbar);
    }

    function restoreHorizontalToolbars() {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        document.querySelectorAll(horizontalToolbarSelector).forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const toolbarId = element.dataset.persistHorizontalScroll;
          if (!toolbarId) return;
          const scrollLeft = Number(window.sessionStorage.getItem(
            navigationHorizontalScrollKey(toolbarId),
          ) ?? "0");
          if (Number.isFinite(scrollLeft)) element.scrollLeft = scrollLeft;
        });
      }));
    }

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
      rememberHorizontalToolbars();
      window.sessionStorage.setItem(navigationReturnKey(targetPath), sourcePath);
      window.sessionStorage.setItem(navigationScrollKey(sourcePath), String(window.scrollY));
    }

    function restoreRequestedScroll() {
      restoreHorizontalToolbars();
      const path = currentInternalPath();
      if (!path || window.sessionStorage.getItem(navigationRestoreKey(path)) !== "1") return;
      window.sessionStorage.removeItem(navigationRestoreKey(path));
      const scrollY = Number(window.sessionStorage.getItem(navigationScrollKey(path)) ?? "0");
      if (!Number.isFinite(scrollY)) return;
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.scrollTo({ top: scrollY })));
    }

    function rememberHorizontalScroll(event: Event) {
      const target = event.target;
      if (!(target instanceof Element) || !target.matches(horizontalToolbarSelector)) return;
      rememberHorizontalToolbar(target);
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
    document.addEventListener("scroll", rememberHorizontalScroll, true);
    window.addEventListener("popstate", restoreRequestedScroll);
    window.addEventListener("stallorder:navigation-change", restoreRequestedScroll);
    restoreRequestedScroll();
    return () => {
      document.removeEventListener("click", rememberNavigation, true);
      document.removeEventListener("scroll", rememberHorizontalScroll, true);
      window.removeEventListener("popstate", restoreRequestedScroll);
      window.removeEventListener("stallorder:navigation-change", restoreRequestedScroll);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }, []);

  return null;
}
