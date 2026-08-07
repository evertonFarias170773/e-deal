"use client";

import React, { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/constants/brand";
import { navigationHrefs, navigationSections, quickAccessItems } from "@/constants/navigation";
import type { NavigationItem } from "@/lib/types";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";

type MobileSidebarNavProps = {
  isOpen: boolean;
  onClose: () => void;
};

function isPathActive(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Rota ativa = href mais específico (mais longo) que casa com o pathname. */
function resolveActiveHref(pathname: string): string | null {
  let best: string | null = null;
  for (const href of navigationHrefs) {
    if (isPathActive(href, pathname) && (best === null || href.length > best.length)) {
      best = href;
    }
  }
  return best;
}

function isItemActive(item: NavigationItem, activeHref: string | null) {
  return item.href === activeHref || !!item.children?.some((child) => child.href === activeHref);
}

/** Seção em acordeão que contém a rota atual (seção-link não abre acordeão). */
function findActiveSectionId(activeHref: string | null): string | null {
  const section = navigationSections.find(
    (sec) => sec.items.length > 0 && sec.items.some((item) => isItemActive(item, activeHref))
  );
  return section?.id ?? null;
}

function findActiveParentHref(activeHref: string | null): string | null {
  for (const section of navigationSections) {
    for (const item of section.items) {
      if (item.children && item.children.length > 0 && isItemActive(item, activeHref)) {
        return item.href;
      }
    }
  }
  return null;
}

const DEFAULT_SECTION_ID = navigationSections.find((sec) => sec.items.length > 0)?.id ?? "";

export function MobileSidebarNav({ isOpen, onClose }: MobileSidebarNavProps) {
  const pathname = usePathname();
  const { user } = useAuth();

  const activeHref = resolveActiveHref(pathname);

  const [openSection, setOpenSection] = useState<string>(
    () => findActiveSectionId(activeHref) ?? DEFAULT_SECTION_ID
  );
  const [openItem, setOpenItem] = useState<string | null>(() => findActiveParentHref(activeHref));
  const [prevPathname, setPrevPathname] = useState(pathname);

  // Ao navegar (mudança de rota), reabre a seção/itens da rota atual.
  // Ajuste de estado durante a renderização (padrão React), não em efeito.
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    const nextSection = findActiveSectionId(activeHref);
    // Seção-link (Dashboard, Notas fiscais, Maestro) não fecha o acordeão aberto.
    if (nextSection) {
      setOpenSection(nextSection);
    }
    setOpenItem(findActiveParentHref(activeHref));
  }

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const canViewConfig =
    user?.isSuperAdmin ||
    user?.isAdmin ||
    hasPermissao(user, "admin.usuarios.view") ||
    hasPermissao(user, "admin.usuarios.edit");

  const isVendedor = user?.perfilSlug === "vendedor";
  // Admins também veem as seções de vendedor (modo consulta do Meu desempenho).
  const podeVerSecaoVendedor = isVendedor || Boolean(user?.isAdmin || user?.isSuperAdmin);

  const visibleSections = navigationSections.filter(
    (section) =>
      !(section.requiresConfigPerm && !canViewConfig) &&
      !(section.sellerOnly && !podeVerSecaoVendedor) &&
      !(section.hiddenForSeller && isVendedor)
  );

  const renderItem = (item: NavigationItem) => {
    const Icon = item.icon;
    const active = isItemActive(item, activeHref);
    const hasChildren = !!item.children && item.children.length > 0;
    const isItemOpen = openItem === item.href;

    const itemStyle = active
      ? { background: "var(--sidebar-active-bg)", color: "var(--sidebar-active-text)" }
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
            <Icon className="h-4 w-4" style={{ color: "var(--sidebar-icon)" }} />
            {item.label}
          </span>
          <span className="text-[10px] uppercase" style={{ color: "var(--sidebar-text-muted)" }}>
            em breve
          </span>
        </span>
      );
    }

    return (
      <Fragment key={item.href}>
        <Link
          href={item.href}
          onClick={(e) => {
            if (hasChildren) {
              e.preventDefault();
              setOpenItem((current) => (current === item.href ? null : item.href));
            } else {
              onClose();
            }
          }}
          className="flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors"
          style={itemStyle}
        >
          <Icon
            className="h-4 w-4 shrink-0"
            style={{ color: active ? "var(--sidebar-icon-active)" : "var(--sidebar-icon)" }}
          />
          <span className="truncate">{item.label}</span>
          {hasChildren && (
            <ChevronDown
              className={cn(
                "ml-auto h-4 w-4 transition-transform duration-200 text-neutral-400",
                isItemOpen && "rotate-180"
              )}
            />
          )}
        </Link>

        {hasChildren && isItemOpen && (
          <div
            className="ml-6 mt-1 mb-2 flex flex-col space-y-0.5 border-l pl-4"
            style={{ borderColor: "var(--sidebar-border)" }}
          >
            {item.children!.map((child) => {
              const childActive = child.href === activeHref;
              return (
                <Link
                  key={child.href}
                  href={child.href}
                  onClick={onClose}
                  className={cn(
                    "flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-150",
                    child.disabled && "opacity-40 pointer-events-none"
                  )}
                  style={{
                    color: childActive ? "var(--sidebar-active-text)" : "var(--sidebar-text-muted)",
                    background: childActive ? "var(--sidebar-active-bg)" : "transparent"
                  }}
                >
                  <span className="truncate">{child.label}</span>
                  {child.disabled && (
                    <span className="scale-90 text-[8px] uppercase tracking-wider opacity-60">
                      breve
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 lg:hidden"
      style={{ background: "rgba(7, 18, 30, 0.72)" }}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="h-full w-[86vw] max-w-sm overflow-y-auto p-4 shadow-2xl"
        style={{
          background: "var(--sidebar-bg)",
          borderRight: "1px solid var(--sidebar-border)"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho do drawer */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="mb-3 h-1.5 w-16 rounded-full" style={{ background: "var(--accent)" }} />
            <p
              className="text-xs font-semibold uppercase tracking-[0.24em]"
              style={{ color: "var(--sidebar-text-muted)" }}
            >
              {APP_NAME}
            </p>
            <h2 className="mt-1 text-lg font-bold" style={{ color: "var(--sidebar-text)" }}>
              Menu
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-2 transition"
            style={{ background: "var(--sidebar-hover-bg)", color: "var(--sidebar-text)" }}
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Acesso rápido */}
        <div className="mb-3">
          <p
            className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-[0.12em]"
            style={{ color: "var(--sidebar-text-muted)" }}
          >
            Acesso rápido
          </p>
          <div className="flex gap-1.5">
            {quickAccessItems.map((item) => {
              const Icon = item.icon;
              const active = isPathActive(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  className="flex flex-1 items-center gap-1.5 rounded-xl border px-2 py-2.5 text-sm font-medium transition-all duration-150"
                  style={{
                    borderColor: "var(--sidebar-border)",
                    background: active ? "var(--sidebar-active-bg)" : "var(--sidebar-hover-bg)",
                    color: active ? "var(--sidebar-active-text)" : "var(--sidebar-text)"
                  }}
                >
                  <Icon
                    className="h-4 w-4 shrink-0"
                    style={{ color: active ? "var(--sidebar-icon-active)" : "var(--sidebar-icon)" }}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Seções em acordeão */}
        <nav className="space-y-1 pb-8">
          {visibleSections.map((section) => {
            const SectionIcon = section.icon;

            // Seção-link: item principal sem acordeão (Dashboard, Notas fiscais, Maestro).
            if (section.href) {
              const active = section.href === activeHref;
              return (
                <Link
                  key={section.id}
                  href={section.href}
                  onClick={onClose}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 transition-colors"
                  style={
                    active
                      ? {
                          background: "var(--sidebar-active-bg)",
                          color: "var(--sidebar-active-text)"
                        }
                      : { color: "var(--sidebar-text-muted)" }
                  }
                >
                  <SectionIcon
                    className="h-4 w-4 shrink-0"
                    style={{ color: active ? "var(--sidebar-icon-active)" : "var(--sidebar-icon)" }}
                  />
                  <span className="flex-1 text-sm font-semibold uppercase tracking-wide">
                    {section.label}
                  </span>
                </Link>
              );
            }

            const open = openSection === section.id;
            return (
              <div key={section.id}>
                <button
                  type="button"
                  onClick={() => setOpenSection((current) => (current === section.id ? "" : section.id))}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left"
                  style={{ color: "var(--sidebar-text-muted)" }}
                  aria-expanded={open}
                >
                  <SectionIcon className="h-4 w-4 shrink-0" style={{ color: "var(--sidebar-icon)" }} />
                  <span className="flex-1 text-sm font-semibold uppercase tracking-wide">
                    {section.label}
                  </span>
                  <ChevronDown
                    className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-180")}
                    style={{ color: "var(--sidebar-icon)" }}
                  />
                </button>
                {open && (
                  <div className="mt-1 mb-1.5 flex flex-col space-y-1">
                    {section.items.map(renderItem)}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
