"use client";

import Image from "next/image";
import { useSyncExternalStore } from "react";
import {
  APP_LOGO_HEIGHT,
  APP_LOGO_SRC,
  APP_LOGO_WIDTH,
  APP_NAME
} from "@/constants/brand";

// ── Store reativa — observa mudanças na classe .dark do <html> ───────────────
// Usa MutationObserver para detectar qualquer alteração no tema,
// funcionando com ThemeToggle ou qualquer outra origem de mudança.

function subscribeTheme(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"]
  });

  return () => observer.disconnect();
}

function getThemeSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

function getThemeServerSnapshot(): boolean {
  return false; // SSR: sempre light
}

// ── Componente ThemedLogo ─────────────────────────────────────────────────────
type ThemedLogoProps = {
  /** Classes CSS para a tag img */
  className?: string;
  /** Largura em px da imagem (next/image) */
  width?: number;
  /** Altura em px da imagem (next/image) */
  height?: number;
};

/**
 * Exibe a logo do software (marca definida em @/constants/brand) conforme o tema:
 * - Light → logo direta (wordmark navy sobre fundo transparente)
 * - Dark  → logo dentro de container branco arredondado, pois o wordmark navy
 *           seria ilegível sobre fundo escuro
 *
 * Reage automaticamente a mudanças de tema via MutationObserver no <html>.
 */
export function ThemedLogo({
  className = "h-14 w-full object-contain object-left",
  width = APP_LOGO_WIDTH,
  height = APP_LOGO_HEIGHT
}: ThemedLogoProps) {
  const isDark = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot
  );

  if (isDark) {
    return (
      <div
        className="inline-flex items-center rounded-xl px-2 py-0.5"
        style={{ background: "#ffffff" }}
      >
        <Image
          src={APP_LOGO_SRC}
          alt={APP_NAME}
          width={width}
          height={height}
          className={className}
          priority
        />
      </div>
    );
  }

  return (
    <Image
      src={APP_LOGO_SRC}
      alt={APP_NAME}
      width={width}
      height={height}
      className={className}
      priority
    />
  );
}
