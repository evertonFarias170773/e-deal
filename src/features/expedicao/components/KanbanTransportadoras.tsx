"use client";

import { useMemo } from "react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import type { ActionMenuItem } from "@/components/common/ActionsMenu";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { formatCurrency } from "@/lib/formatters/currency";
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
  /**
   * O recorte ativo nos cards do topo (`filters.etapa`). Só para NÃO repetir no
   * selo de cada card o que o filtro já disse — ver `mostrarSelo` abaixo.
   *
   * É `string`, e não `EtapaExpedicao`, porque os recortes que atravessam o
   * funil (`DIA`, `ATIVOS`, `TODAS`) não são etapas — e é justamente neles que
   * o selo precisa continuar aparecendo.
   */
  etapaFiltro: string;
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

/**
 * PRONTOS PRIMEIRO, dentro de cada coluna (01/09/2026).
 *
 * A coluna mistura o que ja esta na bancada esperando despacho (`PRONTO`) com o
 * que ainda esta na fabrica, e quem opera precisa ver primeiro o que da para
 * despachar agora. `sort` do JS e ESTAVEL, entao a ordem atual — a que vem da
 * lista filtrada, por `id_int` desc — sobrevive como desempate dentro de cada
 * grupo. Nenhum pedido troca de coluna.
 */
function prontosPrimeiro(pedidos: PedidoExpedicao[]): PedidoExpedicao[] {
  return [...pedidos].sort((a, b) => Number(b.etapa === "PRONTO") - Number(a.etapa === "PRONTO"));
}

function agruparPorTransportadora(pedidos: PedidoExpedicao[]): ColunaKanban[] {
  const mapa = new Map<string, ColunaKanban>();
  for (const p of pedidos) {
    const { chave, titulo } = colunaDoPedido(p);
    const coluna = mapa.get(chave) ?? { chave, titulo, pedidos: [] };
    coluna.pedidos.push(p);
    mapa.set(chave, coluna);
  }
  for (const coluna of mapa.values()) coluna.pedidos = prontosPrimeiro(coluna.pedidos);

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
  formatarPeso,
  etapaFiltro
}: KanbanTransportadorasProps) {
  /**
   * O KANBAN MOSTRA O QUE O RECORTE ENTREGAR (01/09/2026).
   *
   * Até aqui ele descartava EM_TRANSITO e ENTREGUE por conta própria — era a
   * "visão de bancada", e fazia sentido enquanto o Kanban era o modo opcional.
   * Com ele virando a visão inicial, esse filtro escondido passou a contradizer
   * os cards do topo: clicar em "Em trânsito" ou "Entregues" abria um Kanban
   * vazio, sem explicar por quê. Quem recorta agora são os cards e os filtros,
   * e só eles.
   */
  const colunas = useMemo(() => agruparPorTransportadora(pedidos), [pedidos]);

  if (pedidos.length === 0) {
    return (
      <EmptyState
        title="Nenhum pedido no recorte"
        description="Ajuste os filtros ou confira se há pedidos aprovados para produção."
      />
    );
  }

  return (
    // `pb-4` e não `pb-2`: sem a caixa da coluna, quem separa card de fundo é a
    // sombra — e ela precisa de folga embaixo para não ser cortada pelo scroll.
    <div className="flex items-start gap-6 overflow-x-auto pb-4">
      {colunas.map((coluna) => (
        <section
          key={coluna.chave}
          /**
           * COLUNA SEM MOLDURA (02/09/2026).
           *
           * A caixa branca com borda e sombra desenhava DUAS bordas em volta de
           * cada pedido — a da coluna e a do card. Agora a coluna é só largura e
           * um rótulo: os cards ficam soltos sobre o fundo da página e a
           * separação entre transportadoras vem do `gap-6` e do título.
           *
           * 344 px, ~30% acima dos 288 anteriores: o card ocupa a coluna inteira
           * (não há mais padding de coluna), e o nome do cliente cabe sem cortar.
           */
          className="w-[344px] shrink-0"
        >
          <header className="mb-3 flex items-center justify-between gap-2 px-1">
            <h3 className="truncate text-[15px] font-bold text-slate-900 dark:text-slate-100" title={coluna.titulo}>
              {coluna.titulo}
            </h3>
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[13px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {coluna.pedidos.length}
            </span>
          </header>

          {/* 16 px entre cards (era 8): com a moldura fora, o espaçamento é o
              que agrupa a coluna — apertado demais ele vira uma massa só. */}
          <div className="space-y-4">
            {coluna.pedidos.map((p) => {
              const ehAtrasado = p.atrasadoDias > 0 && p.etapa !== "ENTREGUE";
              // Sub-estado visual: PRONTO com etiqueta gerada = pacote na bancada
              // aguardando coleta. O status oficial só muda no Despachar.
              const aguardandoTransportadora =
                p.etapa === "PRONTO" && p.etiquetaGerada && p.tipoFrete !== "RETIRA_BALCAO";
              /**
               * O SELO SOME QUANDO SÓ REPETE O RECORTE (01/09/2026).
               *
               * Com o card "Em trânsito" ativo, TODO card da tela dizia "Em
               * Trânsito": uma linha inteira gasta para repetir o filtro, e o
               * que era exceção (atrasado, prometido hoje) competia com ela.
               * Nos recortes que atravessam etapas — `DIA`, `ATIVOS`, `TODAS` —
               * a etapa varia de card para card e o selo volta sozinho, porque
               * nenhum deles é igual a uma `EtapaExpedicao`.
               *
               * "Aguardando transportadora" NUNCA some: é sub-estado visual
               * (etiqueta impressa, volume esperando coleta), diz mais do que a
               * etapa e não existe como filtro no topo.
               */
              const mostrarSelo = aguardandoTransportadora || p.etapa !== etapaFiltro;
              const primario = acaoPrimaria(p);
              // Ação primária vira o primeiro item do ⋯ — mantém o card limpo e a visão operável.
              const acoes: ActionMenuItem[] = [
                ...(primario ? [{ label: primario.rotulo, onClick: primario.acao }] : []),
                ...itensMenu(p)
              ];
              return (
                <article
                  key={p.idInt}
                  // `shadow-sm`: sem a caixa branca da coluna, é a sombra que
                  // levanta o card do fundo da página.
                  className={`rounded-2xl border p-3.5 shadow-sm ${
                    // PROGRESSÃO VISUAL DA BANCADA: cinza → azul → verde.
                    //
                    //   cinza  ainda não chegou na bancada (produção, acabamento)
                    //   azul   PRONTO p/ expedir, etiqueta ainda não impressa
                    //   verde  etiqueta gerada — o volume está rotulado
                    //
                    // O VERDE VENCE quando as duas condições coincidem, e elas
                    // coincidem o tempo todo: o pedido fica PRONTO, alguém
                    // imprime a etiqueta e ele CONTINUA PRONTO até o despacho.
                    // Se o azul vencesse, o verde praticamente não apareceria e
                    // a etiqueta impressa deixaria de ter sinal na tela.
                    //
                    // Verde independe da etapa, de propósito: `A RETIRAR` com
                    // etiqueta de retirada impressa também é volume rotulado,
                    // esperando o cliente. É o caso do 21415.
                    //
                    // Tons do sistema, sem cor nova: `emerald` é o verde de
                    // `CORES_FASE.CONCLUIDO` e `sky` era o azul que este mesmo
                    // card usava até 01/09/2026 — os dois no par 300/50.
                    p.etiquetaGerada
                      ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
                      : p.etapa === "PRONTO"
                        ? "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30"
                        : "border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/40"
                  }`}
                >
                  {/* Linha de identidade: número, cadastro e o menu, tudo em 36 px
                      de altura. O gatilho do menu é ICONE aqui — o botão com
                      rótulo tem ~112 px e sozinho empurrava o "cli" para duas
                      linhas neste card. */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="text-[17px] font-bold tracking-tight text-[#0b2f4a] dark:text-sky-400">
                        #{p.idInt}
                      </span>
                      {/* Cadastro do cliente: a conferência de bancada casa o volume
                          pelo número do cadastro, não pelo nome — homônimos existem. */}
                      {p.idCliente !== null && (
                        <span className="whitespace-nowrap text-[13px] font-semibold text-slate-500 dark:text-slate-400">
                          cli {p.idCliente}
                        </span>
                      )}
                    </span>
                    <ActionsMenu items={acoes} label="Ações" variant="icone" />
                  </div>
                  {/* Duas linhas, não uma: "LISITON DOCUMENTOS SEGUROS LTDA" e
                      "LISITON DOCUMENTOS SEGUROS ME" truncavam idênticos em uma
                      linha só. O `title` continua entregando o nome inteiro. */}
                  <p
                    className="mt-1.5 line-clamp-2 text-[16px] font-semibold leading-[1.3] text-slate-900 dark:text-slate-100"
                    title={p.cliente}
                  >
                    {p.cliente}
                  </p>
                  {(mostrarSelo || ehAtrasado || p.prometidoHoje) && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      {mostrarSelo && (
                        <StatusBadge
                          status={aguardandoTransportadora ? "AGUARDANDO TRANSPORTADORA" : p.statusInterno}
                        />
                      )}
                      {ehAtrasado && (
                        <span className="rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-black text-white">
                          ATRASADO {p.atrasadoDias}d
                        </span>
                      )}
                      {p.prometidoHoje && (
                        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-black text-white">
                          HOJE
                        </span>
                      )}
                    </div>
                  )}
                  {/* Rodapé de números, separado por fio: peso à esquerda, frete
                      SEMPRE à direita. O frete aparecia só em alguns cards e a
                      linha ficava com comprimento diferente em cada um; com o
                      "—" no lugar do ausente, as duas colunas alinham entre
                      cards e a coluna inteira fica legível na vertical.

                      `slate-600`, não `slate-500`: sobre o verde e o azul do card
                      o cinza anterior ficava em ~4,5:1, no limite do AA. */}
                  <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-slate-900/10 pt-2.5 dark:border-slate-100/10">
                    <span className="truncate text-[14px] font-semibold text-slate-600 dark:text-slate-400">
                      {formatarPeso(p)}
                      {p.volumes !== null ? ` · ${p.volumes} vol` : ""}
                    </span>
                    {/* Frete só quando há valor. Nulo é ausência e zero é frete
                        grátis ou FOB — nenhum dos dois vira "R$ 0,00" no card,
                        que leria como cobrança de zero em vez de "não se aplica".

                        `freteCobrado` é `propostas.valor_frete`, o que a proposta
                        COBRA — e não `freteValor`, que é o valor COTADO em
                        `cotacao_frete` e não acompanha recotação. Os dois batem
                        em toda a base hoje; divergem depois de uma recotação. */}
                    <span className="shrink-0 text-[14px] font-semibold text-slate-600 dark:text-slate-400">
                      {p.freteCobrado !== null && p.freteCobrado > 0 ? (
                        <>
                          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-500">frete </span>
                          {formatCurrency(p.freteCobrado)}
                        </>
                      ) : (
                        "—"
                      )}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
