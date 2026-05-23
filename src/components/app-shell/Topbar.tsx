"use client";

import { Menu } from "lucide-react";
import { CompanySwitcher } from "@/components/app-shell/CompanySwitcher";
import { GlobalSearch } from "@/components/app-shell/GlobalSearch";
import { UserMenu } from "@/components/app-shell/UserMenu";

type TopbarProps = {
  onOpenMenu: () => void;
};

export function Topbar({ onOpenMenu }: TopbarProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-[#d7e5e8] bg-[#f3f7f8]/90 px-4 py-3 backdrop-blur lg:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMenu}
          className="rounded-2xl border border-[#d7e5e8] bg-white p-2.5 text-[#0b2f4a] shadow-sm lg:hidden"
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <GlobalSearch />

        <div className="ml-auto flex items-center gap-2">
          <CompanySwitcher />
          <div className="lg:hidden">
            <UserMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
