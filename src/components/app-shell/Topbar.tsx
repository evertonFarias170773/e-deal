"use client";

import { Menu } from "lucide-react";
import { CompanySwitcher } from "@/components/app-shell/CompanySwitcher";
import { GlobalSearch } from "@/components/app-shell/GlobalSearch";
import { ThemeToggle } from "@/components/app-shell/ThemeToggle";
import { UserMenu } from "@/components/app-shell/UserMenu";

type TopbarProps = {
  onOpenMenu: () => void;
};

export function Topbar({ onOpenMenu }: TopbarProps) {
  return (
    <header
      className="sticky top-0 z-40 px-4 py-3 backdrop-blur lg:px-6"
      style={{
        background: "color-mix(in srgb, var(--card) 92%, transparent)",
        borderBottom: "1px solid var(--border)"
      }}
    >
      <div className="flex items-center gap-3">
        {/* Botão menu mobile */}
        <button
          type="button"
          onClick={onOpenMenu}
          className="rounded-xl p-2.5 shadow-sm transition lg:hidden"
          style={{
            background: "var(--card)",
            border: "1px solid var(--border)",
            color: "var(--primary)"
          }}
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        {/* Busca global */}
        <GlobalSearch />

        {/* Ações à direita */}
        <div className="ml-auto flex items-center gap-2">
          <CompanySwitcher />
          <ThemeToggle />
          <div className="lg:hidden">
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
