"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { MobileSidebar } from "@/components/app-shell/MobileSidebar";
import { MobileSidebarNav } from "@/components/app-shell/MobileSidebarNav";
import { Sidebar } from "@/components/app-shell/Sidebar";
import { SidebarNav } from "@/components/app-shell/SidebarNav";
import { Topbar } from "@/components/app-shell/Topbar";
import { USE_NEW_SIDEBAR } from "@/constants/featureFlags";
import { GlobalChatProvider } from "@/features/chat/context/GlobalChatContext";
import { GlobalChatBubble } from "@/features/chat/components/GlobalChatBubble";

export function AppLayout({ children }: { children: ReactNode }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <GlobalChatProvider>
      <div className="min-h-screen lg:flex" style={{ background: "var(--background)" }}>
        {USE_NEW_SIDEBAR ? (
          <SidebarNav
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed((current) => !current)}
          />
        ) : (
          <Sidebar
            isCollapsed={isSidebarCollapsed}
            onToggleCollapse={() => setIsSidebarCollapsed((current) => !current)}
          />
        )}
        {USE_NEW_SIDEBAR ? (
          <MobileSidebarNav isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)} />
        ) : (
          <MobileSidebar isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)} />
        )}
        <div className="min-w-0 flex-1">
          <Topbar onOpenMenu={() => setIsMobileMenuOpen(true)} />
          <main className="p-4 lg:p-6">{children}</main>
          <GlobalChatBubble />
        </div>
      </div>
    </GlobalChatProvider>
  );
}
