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
    <div className="flex items-center gap-3 rounded-2xl border border-[#d7e5e8] bg-white px-3 py-2 shadow-sm">
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#dff8f6] text-[#0b7774]">
        <UserRound className="h-4 w-4" />
      </span>
      <div className="hidden leading-tight md:block">
        <p className="text-sm font-semibold text-slate-900">{user.name}</p>
        <p className="text-xs text-slate-500">{user.sector}</p>
      </div>
      <button
        type="button"
        onClick={handleLogout}
        disabled={isLoggingOut}
        className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        aria-label="Sair"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
