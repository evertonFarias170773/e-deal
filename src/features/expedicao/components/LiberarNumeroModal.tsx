"use client";

import type { RespostaLiberacao } from "@/features/expedicao/services/aviso-pronto.client";

/**
 * Janela "Liberar número" (só ADM): o aviso por diálogo ficou em resultado
 * desconhecido e o WhatsApp está travado. Quem conferiu no ChatGuru responde se
 * a mensagem foi enviada ou não. Nada é reenviado aqui.
 *
 * soltarTrava (v19): o aviso já terminou, mas a conversa ficou presa na trava
 * compartilhada com o Imposition. Só confirma e solta; o estado do aviso não muda.
 */
export function LiberarNumeroModal({
  idInt,
  teste = false,
  soltarTrava = false,
  ocupado,
  onEscolher,
  onClose,
}: {
  idInt: number;
  /** Envio do "Testar modelo". */
  teste?: boolean;
  /** Aviso terminado com a conversa presa na trava compartilhada. */
  soltarTrava?: boolean;
  ocupado: boolean;
  onEscolher: (resposta: RespostaLiberacao) => void;
  onClose: () => void;
}) {
  const doPedido = teste
    ? `O envio de teste do pedido ${idInt}`
    : `O aviso do pedido ${idInt}`;
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Liberar número"
      onClick={() => {
        if (!ocupado) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-6 text-left text-sm text-slate-700 shadow-2xl dark:bg-slate-900 dark:text-slate-300"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
          Liberar número
        </h2>
        {soltarTrava ? (
          <p className="mt-2">
            {doPedido} já terminou, mas a conversa ficou presa na trava
            compartilhada com o Imposition: novos envios para este WhatsApp, do
            Vibe e do envio de arte, ficam parados. Soltar a conversa? Nada é
            reenviado e o estado do aviso não muda.
          </p>
        ) : (
          <p className="mt-2">
            {doPedido} ficou em resultado desconhecido. Confira no ChatGuru se a
            mensagem chegou ao cliente e responda. Nada é reenviado aqui.
          </p>
        )}
        <div className="mt-5 flex flex-col gap-2">
          {soltarTrava ? (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => onEscolher("soltar")}
              className="rounded-2xl bg-amber-700 px-4 py-2.5 font-semibold text-white hover:bg-amber-800 disabled:opacity-50"
            >
              Soltar a conversa
            </button>
          ) : (
            <>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => onEscolher("enviada")}
                className="rounded-2xl bg-emerald-700 px-4 py-2.5 font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                Conferi no ChatGuru: a mensagem foi enviada
              </button>
              <button
                type="button"
                disabled={ocupado}
                onClick={() => onEscolher("nao_enviada")}
                className="rounded-2xl bg-slate-950 px-4 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-950"
              >
                Conferi no ChatGuru: a mensagem não foi enviada
              </button>
            </>
          )}
          <button
            type="button"
            disabled={ocupado}
            onClick={onClose}
            className="rounded-2xl border border-slate-200 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
