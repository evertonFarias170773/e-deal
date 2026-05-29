"use client";

import Image from "next/image";
import { useSyncExternalStore } from "react";

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
 * Exibe a logo correta conforme o tema ativo:
 * - Light → /logos/ingressoideal.png  (logo original, tons escuros)
 * - Dark  → /logos/logo-dark.png      (versão vibrante para fundo escuro)
 *
 * Reage automaticamente a mudanças de tema via MutationObserver no <html>.
 * No dark mode envolve a logo em um container branco arredondado para garantir
 * que as cores originais da logo sejam preservadas independente do fundo.
 */
export function ThemedLogo({
  className = "h-14 w-full object-contain object-left",
  width = 943,
  height = 280
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
          src="/logos/logo-dark.png"
          alt="Ingresso Ideal"
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
      src="/logos/ingressoideal.png"
      alt="Ingresso Ideal"
      width={width}
      height={height}
      className={className}
      priority
    />
  );
}
