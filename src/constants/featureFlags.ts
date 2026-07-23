// Feature flags de interface.
//
// USE_NEW_SIDEBAR controla qual menu lateral é renderizado no AppLayout:
//   true  -> novo menu "Acordeão por seção" (SidebarNav / MobileSidebarNav)
//   false -> menu antigo em lista plana (Sidebar / MobileSidebar) — fallback intacto
//
// Para reverter ao menu antigo, basta trocar este valor para false.
export const USE_NEW_SIDEBAR = true;
