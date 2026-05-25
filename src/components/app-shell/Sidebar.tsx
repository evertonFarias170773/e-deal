"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, UserRound } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { navigationItems } from "@/lib/navigation";
import { cn } from "@/lib/utils";

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
        "hidden h-screen shrink-0 border-r border-[#d7e5e8] bg-white p-3 text-slate-800 shadow-sm transition-[width] duration-200 lg:sticky lg:top-0 lg:flex lg:flex-col",
        isCollapsed ? "w-20" : "w-72"
      )}
    >
      <div
        className={cn(
          "mb-3 flex items-start gap-2 px-1 py-1",
          isCollapsed && "justify-center"
        )}
      >
        {!isCollapsed ? (
          <>
            <div className="min-w-0 flex-1">
              <Image
                src="/logos/ingressoideal.png"
                alt="Ingresso Ideal"
                width={943}
                height={280}
                className="h-14 w-full object-contain object-left"
                priority
              />
              <p className="mt-2 text-xs font-medium text-slate-500">Painel operacional</p>
            </div>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-[#f3f7f8]"
              aria-label="Recolher menu lateral"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </>
        ) : (
          <>
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#0b2f4a] text-sm font-bold text-white">
              ID
            </div>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-600 transition hover:bg-[#f3f7f8]"
              aria-label="Expandir menu lateral"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      <nav className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {navigationItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const commonClass = cn(
            "group relative flex items-center rounded-2xl px-3 py-2.5 text-sm font-medium transition",
            isCollapsed ? "justify-center" : "gap-3",
            isActive
              ? "bg-[#dff8f6] text-[#0b7774]"
              : "text-slate-600 hover:bg-slate-50 hover:text-[#0b2f4a]",
            item.disabled && "text-slate-400"
          );

          if (item.disabled) {
            return (
              <span
                key={item.href}
                className={commonClass}
                title={isCollapsed ? item.label : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!isCollapsed ? (
                  <>
                    <span className="truncate">{item.label}</span>
                    <span className="ml-auto text-[10px] uppercase text-slate-400">em breve</span>
                  </>
                ) : (
                  <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 hidden -translate-y-1/2 rounded-xl bg-[#0b2f4a] px-3 py-2 text-xs font-semibold text-white shadow-lg group-hover:block">
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
              className={commonClass}
              title={isCollapsed ? item.label : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!isCollapsed ? (
                <span className="truncate">{item.label}</span>
              ) : (
                <span className="pointer-events-none absolute left-full top-1/2 z-30 ml-2 hidden -translate-y-1/2 rounded-xl bg-[#0b2f4a] px-3 py-2 text-xs font-semibold text-white shadow-lg group-hover:block">
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div
        className={cn(
          "mt-4 border-t border-[#d7e5e8] pt-4",
          isCollapsed && "flex justify-center"
        )}
      >
        <div
          className={cn(
            "flex items-center rounded-3xl bg-[#f7fbfb] p-3",
            isCollapsed ? "justify-center" : "gap-3"
          )}
          title={isCollapsed ? user?.name : undefined}
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#dff8f6] text-[#0b7774]">
            <UserRound className="h-5 w-5" />
          </span>
          {!isCollapsed && user ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{user.name}</p>
              <p className="truncate text-xs text-slate-500">{user.sector}</p>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
