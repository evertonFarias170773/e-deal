"use client";

/**
 * Peças da conferência única da NF-e.
 *
 * A tela deixou de ser dez abas e virou uma página com uma lateral que mostra o
 * estado de cada bloco e o total sempre à vista. Emitir nota é conferir, não
 * preencher — o operador precisa ver de uma vez onde está o problema.
 *
 * Só a casca mora aqui: estado, validações e pré-preenchimento continuam no
 * NfeDetailPage. Estes componentes não sabem nada de NF-e além do que recebem.
 */

import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import type { BlocoNfe } from "../pendencias";

/** `impede` trava a emissão, `aviso` só informa, `ok` está conferido. */
export type EstadoBloco = "impede" | "aviso" | "ok";

export interface ResumoDeBloco {
  id: BlocoNfe;
  estado: EstadoBloco;
  /** Uma informação curta à direita do nome: empresa, total, nº de itens. */
  detalhe?: string;
}

/** Id de DOM do bloco, para a lateral rolar até ele. */
export function ancoraDoBloco(bloco: BlocoNfe): string {
  const slug = bloco
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .toLowerCase();
  return `bloco-${slug}`;
}

function IconeDoEstado({ estado, tamanho = "h-4 w-4" }: { estado: EstadoBloco; tamanho?: string }) {
  if (estado === "impede") return <AlertTriangle className={`${tamanho} shrink-0 text-amber-600`} />;
  if (estado === "aviso") return <Info className={`${tamanho} shrink-0 text-slate-400`} />;
  return <CheckCircle2 className={`${tamanho} shrink-0 text-emerald-500`} />;
}

interface ConferenciaLateralProps {
  blocos: ResumoDeBloco[];
  /** Bloco em foco — o último aberto pela lateral ou por uma pendência. */
  emFoco: BlocoNfe;
  totais: { produtos: number; frete: number; desconto: number; total: number };
  formatarValor: (valor: number) => string;
  onSelecionar: (bloco: BlocoNfe) => void;
}

/**
 * A lateral: estado de cada bloco e os totais. Fica grudada no topo porque o
 * total da nota é a informação que o operador consulta o tempo todo.
 */
export function ConferenciaLateral({
  blocos,
  emFoco,
  totais,
  formatarValor,
  onSelecionar
}: ConferenciaLateralProps) {
  return (
    <aside className="w-full shrink-0 lg:w-[280px] lg:sticky lg:top-4">
      <div className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <h2 className="px-3 pb-2.5 pt-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Conferência da nota
        </h2>

        <nav className="flex flex-col gap-0.5" aria-label="Blocos da nota fiscal">
          {blocos.map((bloco) => {
            const emDestaque = bloco.id === emFoco;
            return (
              <button
                key={bloco.id}
                type="button"
                onClick={() => onSelecionar(bloco.id)}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition ${
                  emDestaque ? "bg-slate-100" : "hover:bg-slate-50"
                }`}
              >
                <IconeDoEstado estado={bloco.estado} />
                <span
                  className={`min-w-0 flex-1 truncate text-sm ${
                    bloco.estado === "impede" ? "font-bold text-slate-900" : "font-semibold text-slate-700"
                  }`}
                >
                  {bloco.id}
                </span>
                {bloco.detalhe && (
                  <span
                    className={`shrink-0 text-xs ${
                      bloco.estado === "impede" ? "font-semibold text-amber-700" : "text-slate-400"
                    }`}
                  >
                    {bloco.detalhe}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="mx-1 my-3 h-px bg-slate-200" />

        <dl className="flex flex-col gap-1.5 px-3 pb-2">
          <div className="flex justify-between text-[13px] text-slate-500">
            <dt>Produtos</dt>
            <dd className="text-slate-700">{formatarValor(totais.produtos)}</dd>
          </div>
          <div className="flex justify-between text-[13px] text-slate-500">
            <dt>Frete</dt>
            <dd className="text-slate-700">{formatarValor(totais.frete)}</dd>
          </div>
          <div className="flex justify-between text-[13px] text-slate-500">
            <dt>Desconto</dt>
            <dd className="text-slate-700">-{formatarValor(totais.desconto)}</dd>
          </div>
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-2 text-[15px] font-bold text-slate-900">
            <dt>Total NF</dt>
            <dd>{formatarValor(totais.total)}</dd>
          </div>
        </dl>
      </div>
    </aside>
  );
}

interface BlocoConferenciaProps {
  id: BlocoNfe;
  estado: EstadoBloco;
  /** Resumo mostrado no cabeçalho enquanto o bloco está recolhido. */
  resumo?: string;
  aberto: boolean;
  onAlternar: () => void;
  children: ReactNode;
}

/**
 * Um bloco da conferência. Recolhido, mostra só o cabeçalho com o resumo —
 * é o que impede a nota de trinta itens de virar uma página infinita.
 */
export function BlocoConferencia({
  id,
  estado,
  resumo,
  aberto,
  onAlternar,
  children
}: BlocoConferenciaProps) {
  return (
    <section
      id={ancoraDoBloco(id)}
      className={`scroll-mt-4 overflow-hidden rounded-3xl border bg-white shadow-sm ${
        estado === "impede" ? "border-amber-200" : "border-[#d7e5e8]"
      }`}
    >
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberto}
        className="flex w-full items-center gap-3 px-6 py-4 text-left transition hover:bg-slate-50"
      >
        <IconeDoEstado estado={estado} tamanho="h-5 w-5" />
        <span className="flex-1 text-base font-bold text-slate-900">{id}</span>
        {!aberto && resumo && <span className="truncate text-sm text-slate-500">{resumo}</span>}
        {aberto ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
        )}
      </button>

      {aberto && <div className="border-t border-slate-200 px-6 py-5">{children}</div>}
    </section>
  );
}
