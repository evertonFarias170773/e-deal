"use client";

import { LogOut, UserRound, ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import Link from "next/link";

export function UserMenu() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

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
    <div className="relative" ref={dropdownRef}>
      {/* Botão de Perfil */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 rounded-2xl px-3 py-2 shadow-sm transition hover:opacity-90"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          cursor: "pointer"
        }}
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full shrink-0"
          style={{
            background: "color-mix(in srgb, var(--secondary) 15%, transparent)",
            color: "var(--secondary)"
          }}
        >
          <UserRound className="h-4 w-4" />
        </span>
        <div className="hidden leading-tight md:block text-left">
          <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            {user.name}
          </p>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {user.sector}
          </p>
        </div>
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-56 rounded-2xl p-2 shadow-xl z-50"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="px-3 py-2 border-b mb-1" style={{ borderColor: "var(--border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
              Usuário
            </p>
            <p className="text-sm font-bold truncate" style={{ color: "var(--foreground)" }}>
              {user.name}
            </p>
            <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
              {user.email}
            </p>
          </div>

          {/* Opção Diagnóstico */}
          <Link
            href="/minha-conta"
            onClick={() => setIsOpen(false)}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition text-left"
            style={{ color: "var(--foreground)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = "var(--background)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
            }}
          >
            <ShieldAlert className="h-4 w-4 text-amber-500" />
            <span>Diagnóstico de Acesso</span>
          </Link>

          {/* Opção Sair */}
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              void handleLogout();
            }}
            disabled={isLoggingOut}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition text-left mt-1"
            style={{ color: "#ef4444" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "color-mix(in srgb, #ef4444 10%, transparent)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
            }}
          >
            <LogOut className="h-4 w-4" />
            <span>{isLoggingOut ? "Saindo..." : "Sair"}</span>
          </button>
        </div>
      )}
    </div>
  );
}
