import { useEffect, Fragment, useState } from "react";
import Link from "next/link";
import { X, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { APP_NAME } from "@/constants/brand";
import { navigationItems } from "@/constants/navigation";
import { usePathname } from "next/navigation";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";

type MobileSidebarProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function MobileSidebar({ isOpen, onClose }: MobileSidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const [isConfigExpanded, setIsConfigExpanded] = useState(false);

  // Close MobileSidebar on ESC key press
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
              {APP_NAME}
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
        <nav className="space-y-0.5 pb-8">
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

            const isConfig = item.href === "/configuracoes";
            const handleConfigClick = (e: React.MouseEvent) => {
              if (isConfig) {
                e.preventDefault();
                setIsConfigExpanded(!isConfigExpanded);
              } else {
                onClose();
              }
            };

            return (
              <Fragment key={item.href}>
                <Link
                  href={item.href}
                  onClick={handleConfigClick}
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
                  {isConfig && (
                    <ChevronDown 
                      className={cn(
                        "ml-auto h-4 w-4 transition-transform duration-200 text-neutral-400",
                        isConfigExpanded && "rotate-180"
                      )} 
                    />
                  )}
                </Link>

                {/* Subitens de Configurações ou outros menus agrupados no mobile */}
                {item.children && item.children.length > 0 && (!isConfig || isConfigExpanded) && (
                  <div 
                    className="ml-6 mt-1 mb-2 pl-4 border-l space-y-0.5 flex flex-col" 
                    style={{ borderColor: "var(--sidebar-border)" }}
                  >
                    {item.children.map((child) => {
                      const isChildActive = pathname === child.href || pathname.startsWith(`${child.href}/`);
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onClose}
                          className={cn(
                            "rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-150 flex items-center justify-between",
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
      </div>
    </div>
  );
}
