"use client";

import { useSyncExternalStore } from "react";

/**
 * Tema para gráficos Recharts — extraído do antigo DashboardCharts.
 *
 * Recharts pinta SVG com cores inline, fora do alcance dos tokens CSS; o tema
 * entra via JS observando a classe .dark do <html> (mesmo mecanismo do
 * ThemedLogo). Paleta pareada com os tokens de globals.css.
 */

function subscribeTheme(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function getThemeSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return document.documentElement.classList.contains("dark");
}

export const CHART_THEME = {
  light: {
    series: ["#0f9f9a", "#0b2f4a", "#f28c28", "#ef4444", "#64748b"],
    grid: "#e7eef0",
    axis: "#64748b",
    accent: "#0f9f9a",
    accentStrong: "#0b2f4a",
    danger: "#ef4444",
    warning: "#f28c28",
    // Trio de status da carteira (vencido/hoje/a vencer) — validado com
    // scripts/validate_palette.js da skill dataviz sobre o card #ffffff.
    status: { vencido: "#ef4444", hoje: "#f28c28", aVencer: "#0f9f9a" },
    // Rampa ordinal da Curva ABC (A>B>C, um matiz) — validada com --ordinal.
    abc: { A: "#0a5d57", B: "#0f9f9a", C: "#5db5ae" },
    tooltipBg: "#ffffff",
    tooltipBorder: "#d7e5e8",
    text: "#0d1b2a"
  },
  dark: {
    series: ["#2dbfb0", "#4a9de8", "#f59e0b", "#f87171", "#94a3b8"],
    grid: "#1e3a54",
    axis: "#8ab0cc",
    accent: "#2dbfb0",
    accentStrong: "#4a9de8",
    danger: "#f87171",
    warning: "#f59e0b",
    // Validado sobre o card escuro #0f1e2e (banda de luminosidade + CVD + contraste).
    status: { vencido: "#c73e3e", hoje: "#c28418", aVencer: "#2aa89e" },
    abc: { A: "#7ee0d6", B: "#2aa89e", C: "#155e57" },
    tooltipBg: "#0f1e2e",
    tooltipBorder: "#1e3a54",
    text: "#ddeaf6"
  }
} as const;

export type ChartTheme = (typeof CHART_THEME)["light"] | (typeof CHART_THEME)["dark"];

export function useChartTheme(): ChartTheme {
  const isDark = useSyncExternalStore(subscribeTheme, getThemeSnapshot, () => false);
  return CHART_THEME[isDark ? "dark" : "light"];
}
