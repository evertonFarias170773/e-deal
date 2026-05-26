"use client";

import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { navigationItems } from "@/constants/navigation";

type MobileSidebarProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function MobileSidebar({ isOpen, onClose }: MobileSidebarProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 lg:hidden" role="dialog" aria-modal="true">
      <div className="h-full w-[86vw] max-w-sm overflow-y-auto bg-white p-4 text-slate-800 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="mb-3 h-1.5 w-16 rounded-full bg-[#f28c28]" />
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#0b7774]">
              ERP Ideal
            </p>
            <h2 className="mt-1 text-lg font-bold text-[#0b2f4a]">Menu</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-100 p-2 text-slate-700"
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="space-y-1">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            const itemClass = cn(
              "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium",
              item.disabled
                ? "text-slate-400"
                : "text-slate-700 hover:bg-[#f3f7f8] hover:text-[#0b2f4a]"
            );

            if (item.disabled) {
              return (
                <span
                  key={item.href}
                  className="flex items-center justify-between rounded-2xl px-3 py-3 text-sm text-slate-400"
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </span>
                  <span className="text-[10px] uppercase">em breve</span>
                </span>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={itemClass}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
