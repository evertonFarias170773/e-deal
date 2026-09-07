import type { ReactNode } from "react";

/**
 * Layout do segmento publico /c (cadastro online por link do atendente).
 *
 * Espelha o de /os: sem navegacao, sem menu, sem link para o ERP e sem
 * AuthGuard. Quem abre este endereco e um cliente com um link no WhatsApp —
 * nao deve haver porta nenhuma daqui para dentro do sistema.
 */
export default function CadastroOnlineLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-xl">{children}</div>
    </main>
  );
}
