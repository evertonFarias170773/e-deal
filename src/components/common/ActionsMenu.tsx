"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { ChevronDown, MoreHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ActionMenuItem = {
  label: string;
  onClick?: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

type ActionsMenuProps = {
  items: ActionMenuItem[];
  label?: string;
};

type MenuPosition = {
  top: number;
  left: number;
  maxHeight: number;
};

const DESKTOP_MENU_WIDTH = 240;
const VIEWPORT_MARGIN = 12;
const ACTIONS_MENU_OPEN_EVENT = "erp-ideal-actions-menu-open";

export function ActionsMenu({ items, label = "Acoes" }: ActionsMenuProps) {
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    function handleAnotherMenuOpen(event: Event) {
      const customEvent = event as CustomEvent<string>;

      if (customEvent.detail !== menuId) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener(ACTIONS_MENU_OPEN_EVENT, handleAnotherMenuOpen);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(ACTIONS_MENU_OPEN_EVENT, handleAnotherMenuOpen);
    };
  }, [menuId]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function updateMenuPosition() {
      const button = buttonRef.current;

      if (!button) {
        return;
      }

      const rect = button.getBoundingClientRect();
      const estimatedHeight = Math.min(items.length * 40 + 12, 360);
      const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_MARGIN;
      const spaceAbove = rect.top - VIEWPORT_MARGIN;
      const shouldOpenDown = spaceBelow >= estimatedHeight || spaceBelow >= spaceAbove;
      const maxHeight = Math.max(180, Math.min(estimatedHeight, shouldOpenDown ? spaceBelow : spaceAbove));
      const left = Math.min(
        Math.max(rect.right - DESKTOP_MENU_WIDTH, VIEWPORT_MARGIN),
        window.innerWidth - DESKTOP_MENU_WIDTH - VIEWPORT_MARGIN
      );
      const top = shouldOpenDown
        ? Math.min(rect.bottom + 8, window.innerHeight - maxHeight - VIEWPORT_MARGIN)
        : Math.max(VIEWPORT_MARGIN, rect.top - maxHeight - 8);

      setMenuPosition({ top, left, maxHeight });
    }

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, items.length]);

  function handleAction(item: ActionMenuItem) {
    if (item.disabled) {
      return;
    }

    item.onClick?.();
    setIsOpen(false);
  }

  function openMenu() {
    window.dispatchEvent(new CustomEvent(ACTIONS_MENU_OPEN_EVENT, { detail: menuId }));
    setIsOpen(true);
  }

  function toggleMenu() {
    if (isOpen) {
      setIsOpen(false);
      return;
    }

    openMenu();
  }

  return (
    <div ref={menuRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleMenu}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
        aria-expanded={isOpen}
      >
        <MoreHorizontal className="h-4 w-4" />
        <span className="hidden sm:inline">{label}</span>
        <ChevronDown className="h-4 w-4" />
      </button>

      {isOpen ? (
        <div
          className="fixed z-50 hidden w-60 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-xl shadow-slate-900/10 lg:block"
          style={
            {
              top: menuPosition?.top,
              left: menuPosition?.left,
              maxHeight: menuPosition?.maxHeight
            } satisfies CSSProperties
          }
        >
          {items.map((item, index) => (
            <button
              key={`${item.label}-${index}`}
              type="button"
              disabled={item.disabled}
              onClick={() => handleAction(item)}
              className={cn(
                "flex w-full items-center rounded-xl px-3 py-2 text-left text-sm transition",
                item.destructive
                  ? "text-red-600 hover:bg-red-50"
                  : "text-slate-700 hover:bg-slate-50",
                item.disabled && "cursor-not-allowed opacity-50"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 lg:hidden"
          role="dialog"
          aria-modal="true"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="fixed inset-x-0 bottom-0 rounded-t-3xl bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#0b7774]">
                  Menu de acoes
                </p>
                <h3 className="mt-1 text-lg font-semibold text-slate-950">{label}</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-2xl bg-slate-100 p-2 text-slate-700"
                aria-label="Fechar menu de acoes"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-1 overflow-y-auto pb-2">
              {items.map((item, index) => (
                <button
                  key={`${item.label}-${index}`}
                  type="button"
                  disabled={item.disabled}
                  onClick={() => handleAction(item)}
                  className={cn(
                    "flex w-full items-center rounded-2xl px-4 py-3 text-left text-base font-medium transition",
                    item.destructive
                      ? "text-red-600 hover:bg-red-50"
                      : "text-slate-800 hover:bg-slate-50",
                    item.disabled && "cursor-not-allowed opacity-50"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
            >
              Fechar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
