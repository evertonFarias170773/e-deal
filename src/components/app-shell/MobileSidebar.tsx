"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { navigationItems } from "@/constants/navigation";
import { usePathname } from "next/navigation";

type MobileSidebarProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function MobileSidebar({ isOpen, onClose }: MobileSidebarProps) {
  const pathname = usePathname();

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 lg:hidden"
      style={{ background: "rgba(7, 18, 30, 0.72)" }}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="h-full w-[86vw] max-w-sm overflow-y-auto p-4 shadow-2xl"
        style={{
          background: "var(--sidebar-bg)",
          borderRight: "1px solid var(--sidebar-border)"
        }}
      >
        {/* Cabeçalho do drawer */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div
              className="mb-3 h-1.5 w-16 rounded-full"
              style={{ background: "var(--accent)" }}
            />
            <p
              className="text-xs font-semibold uppercase tracking-[0.24em]"
              style={{ color: "var(--sidebar-text-muted)" }}
            >
              ERP Ideal
            </p>
            <h2
              className="mt-1 text-lg font-bold"
              style={{ color: "var(--sidebar-text)" }}
            >
              Menu
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 transition"
            style={{
              background: "var(--sidebar-hover-bg)",
              color: "var(--sidebar-text)"
            }}
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navegação */}
        <nav className="space-y-0.5">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            const itemStyle = isActive
              ? {
                  background: "var(--sidebar-active-bg)",
                  color: "var(--sidebar-active-text)"
                }
              : item.disabled
              ? { color: "var(--sidebar-text-muted)", opacity: 0.5 }
              : { color: "var(--sidebar-text)" };

            if (item.disabled) {
              return (
                <span
                  key={item.href}
                  className="flex items-center justify-between rounded-xl px-3 py-3 text-sm"
                  style={itemStyle}
                >
                  <span className="flex items-center gap-3">
                    <Icon
                      className="h-4 w-4"
                      style={{ color: "var(--sidebar-icon)" }}
                    />
                    {item.label}
                  </span>
                  <span
                    className="text-[10px] uppercase"
                    style={{ color: "var(--sidebar-text-muted)" }}
                  >
                    em breve
                  </span>
                </span>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors"
                )}
                style={itemStyle}
              >
                <Icon
                  className="h-4 w-4 shrink-0"
                  style={{
                    color: isActive
                      ? "var(--sidebar-icon-active)"
                      : "var(--sidebar-icon)"
                  }}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
