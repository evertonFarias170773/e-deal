"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { MobileSidebar } from "@/components/app-shell/MobileSidebar";
import { Sidebar } from "@/components/app-shell/Sidebar";
import { Topbar } from "@/components/app-shell/Topbar";
import { GlobalChatProvider } from "@/features/chat/context/GlobalChatContext";
import { GlobalChatBubble } from "@/features/chat/components/GlobalChatBubble";

export function AppLayout({ children }: { children: ReactNode }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  return (
    <GlobalChatProvider>
      <div className="min-h-screen lg:flex" style={{ background: "var(--background)" }}>
        <Sidebar
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((current) => !current)}
        />
        <MobileSidebar isOpen={isMobileMenuOpen} onClose={() => setIsMobileMenuOpen(false)} />
        <div className="min-w-0 flex-1">
          <Topbar onOpenMenu={() => setIsMobileMenuOpen(true)} />
          <main className="p-4 lg:p-6">{children}</main>
          <GlobalChatBubble />
        </div>
      </div>
    </GlobalChatProvider>
  );
}
