"use client";

import { Moon, Sun } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";

const THEME_KEY = "erp-theme";

// ── Store externo de tema ──────────────────────────────────────────────────
// useSyncExternalStore precisa de subscriber e snapshot externos ao componente.
// Usamos um Set de listeners e disparamos manualmente ao mudar o tema.

const listeners = new Set<() => void>();

let cachedDark: boolean | null = null;

function notifyListeners() {
  for (const l of listeners) l();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): boolean {
  if (cachedDark !== null) return cachedDark;
  const stored = localStorage.getItem(THEME_KEY);
  cachedDark = stored !== null
    ? stored === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  return cachedDark;
}

function getServerSnapshot(): boolean {
  return false; // SSR: sempre light
}

// ── Componente ──────────────────────────────────────────────────────────────
export function ThemeToggle() {
  const isDark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next = !isDark;
    cachedDark = next;
    localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
    notifyListeners();
  }, [isDark]);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      title={isDark ? "Ativar modo claro" : "Ativar modo escuro"}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm transition"
      style={{
        background: "var(--card)",
        borderColor: "var(--border)",
        color: "var(--muted)"
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.color = "var(--foreground)";
        el.style.background = "var(--card-hover)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.color = "var(--muted)";
        el.style.background = "var(--card)";
      }}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
