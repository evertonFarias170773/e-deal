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
  /**
   * Forma do GATILHO. Os itens do menu não mudam nunca.
   *
   * `botao` (padrão) é o das tabelas: `⋯ Acoes ⌄`, ~112×36 px.
   * `icone` é só o `⋯`, para onde não cabe o rótulo — hoje o card do Kanban da
   * Expedição, que tem ~206 px úteis e perdia metade da linha para o gatilho.
   */
  variant?: "botao" | "icone";
};

type MenuPosition = {
  top: number;
  left: number;
  maxHeight: number;
};

const DESKTOP_MENU_WIDTH = 240;
const VIEWPORT_MARGIN = 12;
const ACTIONS_MENU_OPEN_EVENT = "erp-ideal-actions-menu-open";

export function ActionsMenu({ items, label = "Acoes", variant = "botao" }: ActionsMenuProps) {
  /**
   * Sem rótulo visível, o nome da ação vive em `title` + `aria-label`.
   *
   * A regra de listagens proíbe depender de ícone sem texto em AÇÃO CRÍTICA —
   * e nenhuma ação some aqui: o `⋯` só ABRE o menu, e lá dentro cada item
   * continua com o rótulo por extenso ("Despachar", "Marcar entregue",
   * "Rastrear objeto"). O que muda é o tamanho do gatilho.
   */
  const ehIcone = variant === "icone";
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
        title={ehIcone ? label : undefined}
        aria-label={ehIcone ? label : undefined}
        className={cn(
          "inline-flex items-center transition",
          ehIcone
            ? "h-9 w-9 shrink-0 justify-center rounded-lg"
            : "gap-2 rounded-xl border px-3 py-2 text-sm font-medium shadow-sm"
        )}
        style={
          ehIcone
            ? { background: "transparent", color: "var(--muted)" }
            : {
                background: "var(--card)",
                borderColor: "var(--border)",
                color: "var(--muted)"
              }
        }
        aria-expanded={isOpen}
        onMouseEnter={(e) => {
          const el = e.currentTarget as HTMLButtonElement;
          // No `icone` o fundo é tinta translúcida, não `--card-hover`: o card do
          // Kanban tem fundo próprio (verde/azul/cinza) e um cinza opaco viraria
          // uma mancha em cima dele.
          el.style.background = ehIcone
            ? "color-mix(in srgb, var(--foreground) 8%, transparent)"
            : "var(--card-hover)";
          el.style.color = "var(--foreground)";
        }}
        onMouseLeave={(e) => {
          const el = e.currentTarget as HTMLButtonElement;
          el.style.background = ehIcone ? "transparent" : "var(--card)";
          el.style.color = "var(--muted)";
        }}
      >
        <MoreHorizontal className={ehIcone ? "h-5 w-5" : "h-4 w-4"} />
        {!ehIcone && (
          <>
            <span className="hidden sm:inline">{label}</span>
            <ChevronDown className="h-4 w-4" />
          </>
        )}
      </button>

      {isOpen ? (
        <div
          className="fixed z-50 hidden w-60 overflow-y-auto rounded-2xl p-1 shadow-xl lg:block"
          style={
            {
              top: menuPosition?.top,
              left: menuPosition?.left,
              maxHeight: menuPosition?.maxHeight,
              background: "var(--card)",
              border: "1px solid var(--border)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.2)"
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
                item.disabled && "cursor-not-allowed opacity-50"
              )}
              style={{
                color: item.destructive ? "var(--action-danger)" : "var(--foreground)"
              }}
              onMouseEnter={(e) => {
                if (!item.disabled) {
                  const el = e.currentTarget as HTMLButtonElement;
                  el.style.background = item.destructive
                    ? "color-mix(in srgb, var(--action-danger) 10%, transparent)"
                    : "var(--card-hover)";
                }
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLButtonElement;
                el.style.background = "transparent";
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {isOpen ? (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          style={{ background: "rgba(5,12,22,0.6)" }}
          role="dialog"
          aria-modal="true"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="fixed inset-x-0 bottom-0 rounded-t-3xl p-4 shadow-2xl"
            style={{
              background: "var(--card)",
              borderTop: "1px solid var(--border)"
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--secondary)" }}>
                  Menu de acoes
                </p>
                <h3 className="mt-1 text-lg font-semibold" style={{ color: "var(--foreground)" }}>{label}</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-2xl p-2 transition"
                style={{
                  background: "var(--card-hover)",
                  color: "var(--muted)"
                }}
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
                    item.disabled && "cursor-not-allowed opacity-50"
                  )}
                  style={{
                    color: item.destructive ? "var(--action-danger)" : "var(--foreground)"
                  }}
                  onMouseEnter={(e) => {
                    if (!item.disabled) {
                      (e.currentTarget as HTMLButtonElement).style.background = "var(--card-hover)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="mt-2 w-full rounded-2xl px-4 py-3 text-sm font-semibold transition"
              style={{
                border: "1px solid var(--border)",
                background: "var(--card)",
                color: "var(--muted)"
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--card-hover)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--card)";
              }}
            >
              Fechar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
