"use client";

import { useMemo } from "react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import type { ActionMenuItem } from "@/components/common/ActionsMenu";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import type { PedidoExpedicao } from "../types";

/**
 * Visão "Por transportadora" da Expedição: a MESMA lista filtrada da tabela,
 * agrupada em colunas estilo kanban (sem arrastar — trocar a transportadora
 * continua no modal Despachar/Editar, onde tem validação).
 *
 * Colunas: Retira balcão · Motoboy · Correios · uma por transportadora
 * (nome resolvido, ordem alfabética) · "Outros / A definir" por último.
 * Só as não-vazias aparecem.
 */

type AcaoPrimaria = { rotulo: string; acao: () => void } | null;

type KanbanTransportadorasProps = {
  pedidos: PedidoExpedicao[];
  acaoPrimaria: (p: PedidoExpedicao) => AcaoPrimaria;
  itensMenu: (p: PedidoExpedicao) => ActionMenuItem[];
  formatarPeso: (p: PedidoExpedicao) => string;
};

type ColunaKanban = {
  chave: string;
  titulo: string;
  pedidos: PedidoExpedicao[];
};

const COLUNA_OUTROS = "OUTROS";

/** Chave e título da coluna de um pedido, a partir do tipo normalizado + nome resolvido. */
function colunaDoPedido(p: PedidoExpedicao): { chave: string; titulo: string } {
  if (p.tipoFrete === "RETIRA_BALCAO") return { chave: "RETIRA", titulo: "Retira balcão" };
  if (p.tipoFrete === "MOTOBOY") return { chave: "MOTOBOY", titulo: "Motoboy" };
  if (p.tipoFrete === "CORREIOS") return { chave: "CORREIOS", titulo: "Correios" };
  if (p.tipoFrete === "TRANSPORTADORA") {
    const nome = (p.transportadoraNome || p.freteServico).trim();
    if (nome === "") return { chave: COLUNA_OUTROS, titulo: "Outros / A definir" };
    return { chave: `T:${nome.toUpperCase()}`, titulo: nome };
  }
  // SEM_CUSTO e INDEFINIDO: a transportadora real só nasce no despacho.
  return { chave: COLUNA_OUTROS, titulo: "Outros / A definir" };
}

function agruparPorTransportadora(pedidos: PedidoExpedicao[]): ColunaKanban[] {
  const mapa = new Map<string, ColunaKanban>();
  for (const p of pedidos) {
    const { chave, titulo } = colunaDoPedido(p);
    const coluna = mapa.get(chave) ?? { chave, titulo, pedidos: [] };
    coluna.pedidos.push(p);
    mapa.set(chave, coluna);
  }

  const ordemFixaInicio = ["RETIRA", "MOTOBOY", "CORREIOS"];
  const inicio = ordemFixaInicio
    .map((chave) => mapa.get(chave))
    .filter((c): c is ColunaKanban => Boolean(c));
  const transportadoras = Array.from(mapa.values())
    .filter((c) => c.chave.startsWith("T:"))
    .sort((a, b) => a.titulo.localeCompare(b.titulo, "pt-BR"));
  const outros = mapa.get(COLUNA_OUTROS);

  return [...inicio, ...transportadoras, ...(outros ? [outros] : [])];
}

export function KanbanTransportadoras({
  pedidos,
  acaoPrimaria,
  itensMenu,
  formatarPeso
}: KanbanTransportadorasProps) {
  // Visão de BANCADA: só o que está fisicamente na expedição. Em trânsito e
  // entregue já saíram — quem quiser vê-los usa a visão de lista.
  const visiveis = useMemo(
    () => pedidos.filter((p) => p.etapa !== "EM_TRANSITO" && p.etapa !== "ENTREGUE"),
    [pedidos]
  );
  const colunas = useMemo(() => agruparPorTransportadora(visiveis), [visiveis]);

  if (visiveis.length === 0) {
    return (
      <EmptyState
        title={pedidos.length > 0 ? "Nada na bancada neste recorte" : "Nenhum pedido no recorte"}
        description={
          pedidos.length > 0
            ? "Em trânsito e entregues não aparecem na visão por transportadora — use a visão de lista para vê-los."
            : "Ajuste os filtros ou confira se há pedidos aprovados para produção."
        }
      />
    );
  }

  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-2">
      {colunas.map((coluna) => (
        <section
          key={coluna.chave}
          className="w-[250px] shrink-0 rounded-2xl border border-[#d7e5e8] bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
        >
          <header className="mb-3 flex items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
            <h3 className="truncate text-sm font-bold text-slate-900 dark:text-slate-100" title={coluna.titulo}>
              {coluna.titulo}
            </h3>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {coluna.pedidos.length}
            </span>
          </header>

          <div className="space-y-2">
            {coluna.pedidos.map((p) => {
              const ehAtrasado = p.atrasadoDias > 0 && p.etapa !== "ENTREGUE";
              // Sub-estado visual: PRONTO com etiqueta gerada = pacote na bancada
              // aguardando coleta. O status oficial só muda no Despachar.
              const aguardandoTransportadora =
                p.etapa === "PRONTO" && p.etiquetaGerada && p.tipoFrete !== "RETIRA_BALCAO";
              const primario = acaoPrimaria(p);
              // Ação primária vira o primeiro item do ⋯ — mantém o card limpo e a visão operável.
              const acoes: ActionMenuItem[] = [
                ...(primario ? [{ label: primario.rotulo, onClick: primario.acao }] : []),
                ...itensMenu(p)
              ];
              return (
                <article
                  key={p.idInt}
                  className={`rounded-xl border p-2.5 ${
                    // Nesta visão a urgência fica nos chips ATRASADO/HOJE; o fundo
                    // azul clarinho marca quem já tem etiqueta/rastreio gerado.
                    p.etiquetaGerada
                      ? "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30"
                      : "border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className="font-bold text-[#0b2f4a] dark:text-sky-400">#{p.idInt}</span>
                    <ActionsMenu items={acoes} />
                  </div>
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100" title={p.cliente}>
                    {p.cliente}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <StatusBadge
                      status={aguardandoTransportadora ? "AGUARDANDO TRANSPORTADORA" : p.statusInterno}
                    />
                    {ehAtrasado && (
                      <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-black text-white">
                        ATRASADO {p.atrasadoDias}d
                      </span>
                    )}
                    {p.prometidoHoje && (
                      <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[9px] font-black text-white">
                        HOJE
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    {formatarPeso(p)}
                    {p.volumes !== null ? ` · ${p.volumes} vol` : ""}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
