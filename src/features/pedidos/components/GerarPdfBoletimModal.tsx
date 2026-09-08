"use client";

import { Printer, X, FileStack, FileText } from "lucide-react";

/**
 * A pergunta que aparece depois de salvar o boletim: gerar os PDF agora?
 *
 * POR QUE UM MODAL PRÓPRIO, E NÃO O `ConfirmarAcaoModal`
 *   Aquele confirma UMA ação — tem um botão de confirmar e um de fechar. Aqui a
 *   reimpressão precisa de DUAS saídas afirmativas ("todos os setores" e "só o
 *   setor editado"), e estendê-lo mexeria num componente que Expedição e
 *   Produtos já usam. Um componente novo é mais barato que uma mudança que
 *   outras três telas herdam sem pedir.
 *
 * DUAS CARAS, DECIDIDAS PELO CHAMADOR
 *   `jaImpresso = false` — primeira impressão. Um botão só: gera tudo. Perguntar
 *   "todos ou só um?" antes de existir qualquer PDF seria oferecer uma escolha
 *   sem consequência.
 *
 *   `jaImpresso = true` — reimpressão. Aí a escolha importa: reimprimir tudo
 *   custa papel e confunde quem já tem a via na bancada, e às vezes só um setor
 *   mudou.
 *
 * O "AGORA NÃO" É SAÍDA LEGÍTIMA, não cancelamento: o boletim JÁ foi salvo
 * quando este modal abre. Por isso o texto diz o que aconteceu antes de
 * perguntar — sem isso o operador fecha na dúvida se perdeu o trabalho.
 */
export function GerarPdfBoletimModal({
  jaImpresso,
  setorEditado,
  totalSetores,
  gerando,
  onGerarTodos,
  onGerarSetorEditado,
  onFechar
}: {
  /** Algum setor do pedido já tem `impresso_em`. Decide se há uma ou duas opções. */
  jaImpresso: boolean;
  /** Nome do setor aberto — o que "só o editado" vai gerar. */
  setorEditado: string | null;
  totalSetores: number;
  gerando: boolean;
  onGerarTodos: () => void;
  onGerarSetorEditado: () => void;
  onFechar: () => void;
}) {
  const plural = totalSetores > 1;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (!gerando) onFechar();
      }}
    >
      <div
        className="w-full max-w-lg rounded-3xl bg-white shadow-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="rounded-2xl bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-950">
              <Printer className="h-5 w-5" />
            </span>
            <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
              {jaImpresso ? "Reimprimir o boletim?" : "Gerar os PDF agora?"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onFechar}
            disabled={gerando}
            aria-label="Fechar"
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            <strong className="text-slate-950 dark:text-slate-100">Boletim salvo.</strong>{" "}
            {jaImpresso
              ? "Este pedido já foi impresso antes. Escolha o que gerar agora."
              : plural
                ? `O pedido tem ${totalSetores} setores e cada um tem o seu PDF.`
                : "O PDF do boletim pode ser gerado agora."}
          </p>

          <div className="space-y-2">
            <button
              type="button"
              onClick={onGerarTodos}
              disabled={gerando}
              className="flex w-full items-start gap-3 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-4 text-left transition hover:border-emerald-500 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/40"
            >
              <FileStack className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-400" />
              <span>
                <span className="block text-sm font-bold text-emerald-900 dark:text-emerald-200">
                  {plural ? `Gerar os ${totalSetores} setores` : "Gerar o PDF"}
                </span>
                <span className="block text-xs text-emerald-800/80 dark:text-emerald-300/80">
                  {plural
                    ? "Um arquivo por setor, baixados de uma vez."
                    : "O arquivo é baixado direto."}
                </span>
              </span>
            </button>

            {jaImpresso && setorEditado ? (
              <button
                type="button"
                onClick={onGerarSetorEditado}
                disabled={gerando}
                className="flex w-full items-start gap-3 rounded-2xl border-2 border-slate-200 bg-white p-4 text-left transition hover:border-slate-400 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900"
              >
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-slate-600 dark:text-slate-300" />
                <span>
                  <span className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                    Gerar só {setorEditado}
                  </span>
                  <span className="block text-xs text-slate-600 dark:text-slate-400">
                    O setor que você acabou de editar. Os outros ficam como estão.
                  </span>
                </span>
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 p-5 dark:border-slate-800">
          <button
            type="button"
            onClick={onFechar}
            disabled={gerando}
            className="rounded-2xl px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {gerando ? "Gerando..." : "Agora não"}
          </button>
        </div>
      </div>
    </div>
  );
}
