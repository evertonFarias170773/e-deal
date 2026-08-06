"use client";

import React, { Fragment, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, UserRound, ChevronDown } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { navigationItems } from "@/constants/navigation";
import { cn } from "@/lib/utils";
import { ThemedLogo } from "@/components/app-shell/ThemedLogo";
import { APP_ICON_SRC, APP_NAME } from "@/constants/brand";
import { hasPermissao } from "@/features/auth/usuarios.service";

type SidebarProps = {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
};

export function Sidebar({ isCollapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [isConfigExpanded, setIsConfigExpanded] = useState(false);

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
            <Image
              src={APP_ICON_SRC}
              alt={APP_NAME}
              width={44}
              height={44}
              className="h-11 w-11 shrink-0 rounded-2xl object-contain"
            />
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
      <nav className="mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto pr-1 pb-8">
        {(() => {
          const canViewConfig =
            user?.isSuperAdmin ||
            user?.isAdmin ||
            hasPermissao(user, "admin.usuarios.view") ||
            hasPermissao(user, "admin.usuarios.edit");

          return navigationItems.map((item) => {
            if (item.href === "/configuracoes" && !canViewConfig) {
              return null;
            }

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
                    className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 hidden -translate-y-1/2 rounded-xl px-3 py-2 text-xs font-semibold shadow-xl group-hover:block"
                    style={{ background: "var(--sidebar-active-bg)", color: "var(--sidebar-active-text)" }}
                  >
                    {item.label}
                  </span>
                )}
              </span>
            );
          }

          const isConfig = item.href === "/configuracoes";
          const handleConfigClick = (e: React.MouseEvent) => {
            if (isConfig && !isCollapsed) {
              e.preventDefault();
              setIsConfigExpanded(!isConfigExpanded);
            }
          };

          return (
            <Fragment key={item.href}>
              <Link
                href={item.href}
                onClick={handleConfigClick}
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
                  <>
                    <span className="truncate">{item.label}</span>
                    {isConfig && (
                      <ChevronDown 
                        className={cn(
                          "ml-auto h-3.5 w-3.5 transition-transform duration-200 text-neutral-400",
                          isConfigExpanded && "rotate-180"
                        )} 
                      />
                    )}
                  </>
                ) : (
                  <span
                    className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 hidden -translate-y-1/2 rounded-xl px-3 py-2 text-xs font-semibold shadow-xl group-hover:block"
                    style={{ background: "var(--sidebar-active-bg)", color: "var(--sidebar-active-text)" }}
                  >
                    {item.label}
                  </span>
                )}
              </Link>
              
              {/* Subitens de Configurações ou outros menus agrupados */}
              {!isCollapsed && item.children && item.children.length > 0 && (!isConfig || isConfigExpanded) && (
                <div 
                  className="ml-5 mt-0.5 mb-1.5 pl-4 border-l space-y-0.5 flex flex-col" 
                  style={{ borderColor: "var(--sidebar-border)" }}
                >
                  {item.children.map((child) => {
                    const isChildActive = pathname === child.href || pathname.startsWith(`${child.href}/`);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150 flex items-center justify-between",
                          child.disabled && "opacity-40 pointer-events-none"
                        )}
                        style={{
                          color: isChildActive 
                            ? "var(--sidebar-active-text)" 
                            : "var(--sidebar-text-muted)",
                          background: isChildActive 
                            ? "var(--sidebar-active-bg)" 
                            : "transparent"
                        }}
                      >
                        <span className="truncate">{child.label}</span>
                        {child.disabled && (
                          <span className="text-[8px] uppercase tracking-wider scale-90 opacity-60">breve</span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </Fragment>
          );

        });
      })()}
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
