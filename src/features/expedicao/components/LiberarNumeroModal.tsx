"use client";

/**
 * Janela "Liberar número" (só ADM): o aviso por diálogo ficou em resultado
 * desconhecido e o WhatsApp está travado. Quem conferiu no ChatGuru responde se
 * a mensagem foi enviada ou não. Nada é reenviado aqui.
 */
export function LiberarNumeroModal({
  idInt,
  teste = false,
  ocupado,
  onEscolher,
  onClose
}: {
  idInt: number;
  /** Envio do "Testar modelo". */
  teste?: boolean;
  ocupado: boolean;
  onEscolher: (resposta: "enviada" | "nao_enviada") => void;
  onClose: () => void;
}) {
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
        <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">Liberar número</h2>
        <p className="mt-2">
          {teste ? `O envio de teste do pedido ${idInt}` : `O aviso do pedido ${idInt}`} ficou em resultado desconhecido. Confira no
          ChatGuru se a mensagem chegou ao cliente e responda. Nada é reenviado aqui.
        </p>
        <div className="mt-5 flex flex-col gap-2">
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
