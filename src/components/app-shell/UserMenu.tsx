"use client";

import { LogOut, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";

export function UserMenu() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
      router.replace("/login");
    } catch (error) {
      console.error("[UserMenu] Falha ao sair:", error);
    } finally {
      setIsLoggingOut(false);
    }
  }

  if (!user) {
    return null;
  }

  return (
    <div
      className="flex items-center gap-3 rounded-2xl px-3 py-2 shadow-sm"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)"
      }}
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full"
        style={{
          background: "color-mix(in srgb, var(--secondary) 15%, transparent)",
          color: "var(--secondary)"
        }}
      >
        <UserRound className="h-4 w-4" />
      </span>
      <div className="hidden leading-tight md:block">
        <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          {user.name}
        </p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {user.sector}
        </p>
      </div>
      <button
        type="button"
        onClick={handleLogout}
        disabled={isLoggingOut}
        className="rounded-xl p-2 transition"
        style={{ color: "var(--muted)" }}
        aria-label="Sair"
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--background)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--foreground)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--muted)";
        }}
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
