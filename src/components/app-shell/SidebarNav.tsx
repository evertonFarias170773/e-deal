"use client";

import React, { Fragment, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronDown, UserRound } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { navigationHrefs, navigationSections, quickAccessItems } from "@/constants/navigation";
import type { NavigationItem, NavigationSection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ThemedLogo } from "@/components/app-shell/ThemedLogo";
import { hasPermissao } from "@/features/auth/usuarios.service";

type SidebarNavProps = {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
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

export function SidebarNav({ isCollapsed, onToggleCollapse }: SidebarNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();

  const activeHref = resolveActiveHref(pathname);

  const [openSection, setOpenSection] = useState<string>(
    () => findActiveSectionId(activeHref) ?? DEFAULT_SECTION_ID
  );
  const [openItem, setOpenItem] = useState<string | null>(() => findActiveParentHref(activeHref));
  const [hoverSection, setHoverSection] = useState<string | null>(null);
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

  const canViewConfig =
    user?.isSuperAdmin ||
    user?.isAdmin ||
    hasPermissao(user, "admin.usuarios.view") ||
    hasPermissao(user, "admin.usuarios.edit");

  const visibleSections = navigationSections.filter(
    (section) => !(section.requiresConfigPerm && !canViewConfig)
  );

  const renderItem = (item: NavigationItem) => {
    const Icon = item.icon;
    const active = isItemActive(item, activeHref);
    const hasChildren = !!item.children && item.children.length > 0;
    const isItemOpen = openItem === item.href;

    const baseClass = cn(
      "group relative flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all duration-150",
      item.disabled && "opacity-40 pointer-events-none"
    );

    const activeStyle = active
      ? {
          background: "var(--sidebar-active-bg)",
          color: "var(--sidebar-active-text)",
          borderLeft: "3px solid var(--sidebar-active-border)"
        }
      : { color: "var(--sidebar-text)", borderLeft: "3px solid transparent" };

    if (item.disabled) {
      return (
        <span key={item.href} className={baseClass} style={activeStyle}>
          <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--sidebar-icon)" }} />
          <span className="truncate">{item.label}</span>
          <span
            className="ml-auto text-[10px] uppercase"
            style={{ color: "var(--sidebar-text-muted)" }}
          >
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
            }
          }}
          className={baseClass}
          style={activeStyle}
          onMouseEnter={(e) => {
            if (!active) {
              (e.currentTarget as HTMLAnchorElement).style.background = "var(--sidebar-hover-bg)";
              (e.currentTarget as HTMLAnchorElement).style.color = "var(--sidebar-hover-text)";
            }
          }}
          onMouseLeave={(e) => {
            if (!active) {
              (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
              (e.currentTarget as HTMLAnchorElement).style.color = "var(--sidebar-text)";
            }
          }}
        >
          <Icon
            className="h-4 w-4 shrink-0"
            style={{ color: active ? "var(--sidebar-icon-active)" : "var(--sidebar-icon)" }}
          />
          <span className="truncate">{item.label}</span>
          {hasChildren && (
            <ChevronDown
              className={cn(
                "ml-auto h-3.5 w-3.5 transition-transform duration-200 text-neutral-400",
                isItemOpen && "rotate-180"
              )}
            />
          )}
        </Link>

        {hasChildren && isItemOpen && (
          <div
            className="ml-5 mt-1 mb-1.5 flex flex-col space-y-1 border-l pl-4"
            style={{ borderColor: "var(--sidebar-border)" }}
          >
            {item.children!.map((child) => {
              const childActive = child.href === activeHref;
              return (
                <Link
                  key={child.href}
                  href={child.href}
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

  const renderQuickAccess = (item: NavigationItem) => {
    const Icon = item.icon;
    const active = isPathActive(item.href, pathname);
    return (
      <Link
        key={item.href}
        href={item.href}
        className="flex flex-1 items-center gap-1.5 rounded-xl border px-2 py-2 text-sm font-medium transition-all duration-150"
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
  };

  const renderRailIcon = (
    key: string,
    Icon: NavigationItem["icon"],
    label: string,
    active: boolean,
    onClick: () => void,
    onMouseEnter?: () => void
  ) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      title={label}
      aria-label={label}
      className="flex h-11 w-11 items-center justify-center rounded-xl transition-all duration-150"
      style={{
        background: active ? "var(--sidebar-active-bg)" : "transparent",
        color: active ? "var(--sidebar-active-text)" : "var(--sidebar-text)"
      }}
      onMouseOver={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = "var(--sidebar-hover-bg)";
      }}
      onMouseOut={(e) => {
        if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
      }}
    >
      <Icon
        className="h-5 w-5"
        style={{ color: active ? "var(--sidebar-icon-active)" : "var(--sidebar-icon)" }}
      />
    </button>
  );

  const renderFlyout = (section: NavigationSection) => (
    <div
      className="absolute left-full top-0 z-40 ml-2 w-56 rounded-xl border p-2 shadow-xl"
      style={{
        background: "var(--sidebar-bg)",
        borderColor: "var(--sidebar-border)"
      }}
    >
      <p
        className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider"
        style={{ color: "var(--sidebar-text-muted)" }}
      >
        {section.label}
      </p>
      <div className="flex flex-col space-y-0.5">
        {section.items.map((item) => {
          const Icon = item.icon;
          const active = isItemActive(item, activeHref);
          if (item.disabled) {
            return (
              <span
                key={item.href}
                className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium opacity-40"
                style={{ color: "var(--sidebar-text)" }}
              >
                <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--sidebar-icon)" }} />
                <span className="truncate">{item.label}</span>
                <span className="ml-auto text-[8px] uppercase tracking-wider">breve</span>
              </span>
            );
          }
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setHoverSection(null)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-150"
              style={{
                color: active ? "var(--sidebar-active-text)" : "var(--sidebar-text)",
                background: active ? "var(--sidebar-active-bg)" : "transparent"
              }}
              onMouseEnter={(e) => {
                if (!active) (e.currentTarget as HTMLAnchorElement).style.background = "var(--sidebar-hover-bg)";
              }}
              onMouseLeave={(e) => {
                if (!active) (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
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
  );

  return (
    <aside
      className={cn(
        "hidden h-screen shrink-0 p-3 shadow-xl transition-[width] duration-200 lg:sticky lg:top-0 lg:flex lg:flex-col",
        isCollapsed ? "lg:w-[76px]" : "lg:w-72"
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
          isCollapsed && "flex-col items-center"
        )}
      >
        {!isCollapsed ? (
          <>
            <div className="min-w-0 flex-1">
              <ThemedLogo className="h-14 w-full object-contain object-left" />
              <p className="mt-2 text-xs font-medium" style={{ color: "var(--sidebar-text-muted)" }}>
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
              style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
            >
              ID
            </div>
            <button
              type="button"
              onClick={onToggleCollapse}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition"
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
      {!isCollapsed ? (
        <nav className="mt-1 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
          {/* Acesso rápido */}
          <div className="px-1 pb-2">
            <p
              className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-[0.12em]"
              style={{ color: "var(--sidebar-text-muted)" }}
            >
              Acesso rápido
            </p>
            <div className="flex gap-1.5">{quickAccessItems.map(renderQuickAccess)}</div>
          </div>

          {/* Seções em acordeão */}
          {visibleSections.map((section) => {
            const SectionIcon = section.icon;

            // Seção-link: item principal sem acordeão (Dashboard, Notas fiscais, Maestro).
            if (section.href) {
              const active = section.href === activeHref;
              return (
                <Link
                  key={section.id}
                  href={section.href}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 transition-all duration-150"
                  style={
                    active
                      ? {
                          background: "var(--sidebar-active-bg)",
                          color: "var(--sidebar-active-text)"
                        }
                      : { color: "var(--sidebar-text-muted)" }
                  }
                  onMouseEnter={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLAnchorElement).style.background =
                        "var(--sidebar-hover-bg)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                    }
                  }}
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
                  className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all duration-150"
                  style={{ color: "var(--sidebar-text-muted)" }}
                  aria-expanded={open}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "var(--sidebar-hover-bg)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                  }}
                >
                  <SectionIcon className="h-4 w-4 shrink-0" style={{ color: "var(--sidebar-icon)" }} />
                  <span className="flex-1 text-sm font-semibold uppercase tracking-wide">
                    {section.label}
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 transition-transform duration-200",
                      open && "rotate-180"
                    )}
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
      ) : (
        <nav className="flex min-h-0 flex-1 flex-col items-center gap-1.5">
          {quickAccessItems.map((item) =>
            renderRailIcon(
              `fav-${item.href}`,
              item.icon,
              item.label,
              isPathActive(item.href, pathname),
              () => router.push(item.href)
            )
          )}
          <div className="my-1 h-px w-9" style={{ background: "var(--sidebar-border)" }} />
          {visibleSections.map((section) => {
            // Seção-link: navega direto, sem flyout.
            if (section.href) {
              const href = section.href;
              return renderRailIcon(
                `rail-${section.id}`,
                section.icon,
                section.label,
                href === activeHref,
                () => router.push(href)
              );
            }

            return (
            <div
              key={section.id}
              className="relative"
              onMouseEnter={() => setHoverSection(section.id)}
              onMouseLeave={() => setHoverSection(null)}
            >
              {renderRailIcon(
                `rail-${section.id}`,
                section.icon,
                section.label,
                section.items.some((item) => isItemActive(item, activeHref)),
                () => {
                  // Fallback sem hover: abre a seção e expande a sidebar.
                  setOpenSection(section.id);
                  setHoverSection(null);
                  onToggleCollapse();
                }
              )}
              {hoverSection === section.id && renderFlyout(section)}
            </div>
            );
          })}
        </nav>
      )}

      {/* Rodapé — usuário */}
      <div
        className={cn("mt-4 border-t pt-4", isCollapsed && "flex justify-center")}
        style={{ borderColor: "var(--sidebar-border)" }}
      >
        <Link
          href="/minha-conta"
          className={cn(
            "flex items-center rounded-2xl p-3 transition hover:opacity-90",
            isCollapsed ? "justify-center" : "gap-3"
          )}
          style={{ background: "var(--sidebar-hover-bg)", cursor: "pointer" }}
          title={isCollapsed ? user?.name : "Minha Conta"}
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "var(--sidebar-active-bg)", color: "var(--sidebar-active-text)" }}
          >
            <UserRound className="h-5 w-5" />
          </span>
          {!isCollapsed && user ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold" style={{ color: "var(--sidebar-text)" }}>
                {user.name}
              </p>
              <p className="truncate text-xs" style={{ color: "var(--sidebar-text-muted)" }}>
                {user.sector}
              </p>
            </div>
          ) : null}
        </Link>
      </div>
    </aside>
  );
}
