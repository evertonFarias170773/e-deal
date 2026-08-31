// Feature flags de interface.
//
// USE_NEW_SIDEBAR controla qual menu lateral é renderizado no AppLayout:
//   true  -> novo menu "Acordeão por seção" (SidebarNav / MobileSidebarNav)
//   false -> menu antigo em lista plana (Sidebar / MobileSidebar) — fallback intacto
//
// Para reverter ao menu antigo, basta trocar este valor para false.
export const USE_NEW_SIDEBAR = true;

// CADASTRO_ID_AUTOMATICO controla o par de modos do campo "ID do cliente" no
// cadastro NOVO:
//   true  -> a tela abre em "Automatico": o campo fica readOnly e o numero e
//            gerado pelo banco (DEFAULT public.fn_proximo_id_cliente(), a partir
//            de 70.000). O atendente pode trocar para "Informar manualmente".
//   false -> a tela volta ao comportamento anterior: um unico campo obrigatorio,
//            digitado a mao, sem os radios.
//
// Reverter nao exige deploy de banco: a coluna continua aceitando valor
// explicito, e valor explicito sempre vence o DEFAULT.
export const CADASTRO_ID_AUTOMATICO = true;
