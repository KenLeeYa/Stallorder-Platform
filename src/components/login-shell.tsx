"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAppLocale } from "@/components/locale-provider";
import { LocaleSelector } from "@/components/locale-selector";
import { ThemeToggle } from "@/components/theme-toggle";
import styles from "./login-shell.module.css";

export function LoginShell({ children }: { children: ReactNode }) {
  const { t } = useAppLocale();

  return (
    <main className={styles.root}>
      <div className={styles.canvas}>
        <picture>
          <source media="(min-aspect-ratio: 4/3)" srcSet="/images/login-scene-wide.webp" />
          <Image
            src="/images/login-scene-portrait.webp"
            alt={t("login.brand.imageAlt")}
            width={941}
            height={1672}
            unoptimized
            loading="eager"
            className={styles.image}
          />
        </picture>
        <div data-testid="login-screen" className={styles.screen}>
          <div className={styles.screenScroll}>
            <div className={styles.contents}>{children}</div>
          </div>
        </div>
      </div>

      <div className={`${styles.toolbar} [&>button]:h-12 [&>button]:w-12`}>
        <Link
          href="/"
          aria-label={t("notFound.home")}
          title={t("notFound.home")}
          className="inline-flex h-12 w-12 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700 hover:bg-stone-50"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <LocaleSelector compact className="min-h-12 min-w-12" />
        <ThemeToggle />
      </div>
    </main>
  );
}
