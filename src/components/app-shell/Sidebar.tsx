"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, UserRound } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { navigationItems } from "@/constants/navigation";
import { cn } from "@/lib/utils";
import { ThemedLogo } from "@/components/app-shell/ThemedLogo";

type SidebarProps = {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
};

export function Sidebar({ isCollapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();

  return (
    <aside
      className={cn(
        "hidden h-screen shrink-0 p-3 shadow-xl transition-[width] duration-200 lg:sticky lg:top-0 lg:flex lg:flex-col",
        isCollapsed ? "w-20" : "w-72"
      )}
      style={{
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--sidebar-border)"
      }}
    >
      {/* Cabeçalho / Logo */}
      <div
        className={cn(
          "mb-3 flex items-start gap-2 px-1 py-1",
          isCollapsed && "justify-center"
        )}
      >
        {!isCollapsed ? (
          <>
            <div className="min-w-0 flex-1">
              <ThemedLogo className="h-14 w-full object-contain object-left" />
              <p
                className="mt-2 text-xs font-medium"
                style={{ color: "var(--sidebar-text-muted)" }}
              >
                Painel operacional
              </p>
            </div>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition"
              style={{ color: "var(--sidebar-text-muted)" }}
              aria-label="Recolher menu lateral"
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--sidebar-hover-bg)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--sidebar-hover-text)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--sidebar-text-muted)";
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold"
              style={{
                background: "var(--primary)",
                color: "var(--primary-foreground)"
              }}
            >
              ID
            </div>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition"
              style={{ color: "var(--sidebar-text-muted)" }}
              aria-label="Expandir menu lateral"
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--sidebar-hover-bg)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--sidebar-hover-text)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--sidebar-text-muted)";
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* Navegação */}
      <nav className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          const baseClass = cn(
            "group relative flex items-center rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150",
            isCollapsed ? "justify-center" : "gap-3",
            item.disabled && "opacity-40 pointer-events-none"
          );

          const activeStyle = isActive
            ? {
                background: "var(--sidebar-active-bg)",
                color: "var(--sidebar-active-text)",
                borderLeft: "3px solid var(--sidebar-active-border)"
              }
            : { color: "var(--sidebar-text)", borderLeft: "3px solid transparent" };

          if (item.disabled) {
            return (
              <span
                key={item.href}
                className={baseClass}
                style={activeStyle}
                title={isCollapsed ? item.label : undefined}
              >
                <Icon
                  className="h-4 w-4 shrink-0"
                  style={{ color: isActive ? "var(--sidebar-icon-active)" : "var(--sidebar-icon)" }}
                />
                {!isCollapsed ? (
                  <>
                    <span className="truncate">{item.label}</span>
                    <span
                      className="ml-auto text-[10px] uppercase"
                      style={{ color: "var(--sidebar-text-muted)" }}
                    >
                      em breve
                    </span>
                  </>
                ) : (
                  <span
                    className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 hidden -translate-y-1/2 rounded-xl px-3 py-2 text-xs font-semibold text-white shadow-xl group-hover:block"
                    style={{ background: "var(--sidebar-active-bg)" }}
                  >
                    {item.label}
                  </span>
                )}
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={baseClass}
              style={activeStyle}
              title={isCollapsed ? item.label : undefined}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLAnchorElement).style.background = "var(--sidebar-hover-bg)";
                  (e.currentTarget as HTMLAnchorElement).style.color = "var(--sidebar-hover-text)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                  (e.currentTarget as HTMLAnchorElement).style.color = "var(--sidebar-text)";
                }
              }}
            >
              <Icon
                className="h-4 w-4 shrink-0"
                style={{ color: isActive ? "var(--sidebar-icon-active)" : "var(--sidebar-icon)" }}
              />
              {!isCollapsed ? (
                <span className="truncate">{item.label}</span>
              ) : (
                <span
                  className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 hidden -translate-y-1/2 rounded-xl px-3 py-2 text-xs font-semibold text-white shadow-xl group-hover:block"
                  style={{ background: "var(--sidebar-active-bg)" }}
                >
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Rodapé — usuário */}
      <div
        className={cn(
          "mt-4 border-t pt-4",
          isCollapsed && "flex justify-center"
        )}
        style={{ borderColor: "var(--sidebar-border)" }}
      >
        <Link
          href="/minha-conta"
          className={cn(
            "flex items-center rounded-2xl p-3 transition hover:opacity-90",
            isCollapsed ? "justify-center" : "gap-3"
          )}
          style={{ background: "var(--sidebar-hover-bg)", cursor: "pointer" }}
          title={isCollapsed ? user?.name : "Minha Conta (Diagnóstico)"}
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "var(--sidebar-active-bg)", color: "var(--sidebar-active-text)" }}
          >
            <UserRound className="h-5 w-5" />
          </span>
          {!isCollapsed && user ? (
            <div className="min-w-0">
              <p
                className="truncate text-sm font-semibold"
                style={{ color: "var(--sidebar-text)" }}
              >
                {user.name}
              </p>
              <p
                className="truncate text-xs"
                style={{ color: "var(--sidebar-text-muted)" }}
              >
                {user.sector}
              </p>
            </div>
          ) : null}
        </Link>
      </div>
    </aside>
  );
}
