import type { GrupoVinculado } from "../lib/vinculos-do-painel";
import { classeChipDoTipo, dicaDoMembro, destaqueDoCard, textoVinculados } from "../lib/vinculos-do-painel";

/**
 * "Vinculados: #A · #B" — um chip por grupo (roxo = Complemento, rosa =
 * Acompanhar). Cada numero leva uma bolinha: verde = pronto para expedir,
 * ambar = ainda nao; a dica mostra o status. Pedido nos dois tipos: o chip
 * roxo ganha uma bolinha rosa pequena de marcador.
 */
export function ChipVinculados({
  grupos,
  onSoltar
}: {
  grupos: readonly GrupoVinculado[] | undefined;
  /** So o expedicao.admin recebe: abre o "Soltar do grupo" (grupo Acompanhar). */
  onSoltar?: (grupo: GrupoVinculado) => void;
}) {
  if (!grupos || grupos.length === 0) return null;
  const nosDois = destaqueDoCard(grupos) === "AMBOS";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" data-testid="chip-vinculados">
      {grupos.map((g) => (
        <span
          key={`${g.tipo}:${g.grupoId}`}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[12px] font-semibold ${classeChipDoTipo(g.tipo)}`}
          title={g.membros.map((m) => dicaDoMembro(m, g.tipo)).join("\n")}
        >
          {nosDois && g.tipo === "COMPLEMENTO" && (
            <span className="h-2 w-2 shrink-0 rounded-full bg-rose-500" title="Tambem em um grupo Acompanhar" aria-label="Tambem em um grupo Acompanhar" />
          )}
          <span>Vinculados:</span>
          {g.membros.map((m, i) => (
            <span key={m.idInt} className="inline-flex items-center gap-1" title={dicaDoMembro(m, g.tipo)}>
              {i > 0 && <span aria-hidden="true">·</span>}
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${m.pronto ? "bg-emerald-500" : "bg-amber-500"}`}
                aria-label={m.pronto ? "pronto para expedir" : "ainda nao esta pronto"}
              />
              #{m.idInt}
            </span>
          ))}
          <span className="sr-only">{textoVinculados(g)}</span>
          {onSoltar && g.tipo === "ACOMPANHAR" && (
            <button
              type="button"
              onClick={() => onSoltar(g)}
              className="ml-1 rounded border border-rose-300 bg-white px-1.5 text-[11px] font-bold text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-slate-900 dark:text-rose-300"
              title="Tirar um pedido do grupo Acompanhar (com motivo)"
            >
              Soltar do grupo
            </button>
          )}
        </span>
      ))}
    </div>
  );
}
