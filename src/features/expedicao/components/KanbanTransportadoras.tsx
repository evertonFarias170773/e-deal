"use client";

import { useMemo } from "react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import type { ActionMenuItem } from "@/components/common/ActionsMenu";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { formatCurrency } from "@/lib/formatters/currency";
import type { EtapaExpedicao, PedidoExpedicao } from "../types";

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

/**
 * FONTE ÚNICA das cores de fundo do card — o card pinta daqui e a LEGENDA lê
 * daqui (02/09/2026).
 *
 * Antes as classes viviam soltas no `className` do `<article>`. Uma legenda que
 * repetisse esses tons teria virado uma segunda verdade sobre a mesma cor,
 * livre para divergir na primeira vez que alguém trocasse um `sky-300`. Aqui o
 * marcador da legenda recebe LITERALMENTE a mesma string de classe do card, o
 * que torna a divergência impossível por construção.
 *
 * Tons do sistema, sem cor nova: `emerald`, `sky` e `slate` já eram os do card,
 * e `amber` já vivia no chip `HOJE` logo abaixo. Todos no par 300/50.
 */
const FASE_FABRICA = {
  rotulo: "ainda na fábrica",
  classe: "border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-800/40"
} as const;

const FASE_BANCADA = {
  rotulo: "na bancada, pede ação",
  classe: "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30"
} as const;

const FASE_COLETA = {
  rotulo: "aguardando coleta",
  classe: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
} as const;

const FASE_ROTULADO = {
  rotulo: "já saiu, rotulado",
  classe: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
} as const;

/**
 * Ordem de LEITURA da legenda — o caminho físico do volume, que NÃO é a ordem
 * de avaliação: fábrica → bancada → esperando a transportadora → saiu.
 * A precedência vive em `faseDoCard`.
 */
const FASES_CARD_KANBAN = [FASE_FABRICA, FASE_BANCADA, FASE_COLETA, FASE_ROTULADO];

/** Etapas em que o volume JÁ SAIU da bancada — onde o verde passa a valer. */
const ETAPAS_FORA_DA_BANCADA: EtapaExpedicao[] = ["A_RETIRAR", "EM_TRANSITO", "ENTREGUE"];

/**
 * LARANJA — "aguardando coleta". PREVISTO na precedência, ainda SEM OCUPANTE.
 *
 * O estado é DERIVADO (Desenho A da Etapa 7, commit 613961c): despacho
 * confirmado + `expedicoes.coletado_em` nula + etapa `PRONTO` + transporte
 * `TRANSPORTADORA` ou `MOTOBOY` — o volume saiu da bancada mas a transportadora
 * ainda não passou.
 *
 * `coletado_em` NÃO EXISTE no banco: a migration está escrita e não foi
 * aplicada, e este bloco não a aplica. Sem a coluna, a última condição não tem
 * como ser avaliada e o estado não pode ser distinguido de "ainda na bancada".
 *
 * A saída é uma flag ANOTADA COMO `boolean` — e não inferida como `false`, o
 * que tornaria o resto do corpo código morto para o compilador. Assim a
 * condição fica escrita, tipada e verificada pelo `tsc`, devolvendo `false`
 * para todo pedido até a coluna existir. Ligar é trocar a flag e ler
 * `coletado_em` no service; nada mais nesta precedência muda.
 */
const COLETA_TEM_FONTE_NO_BANCO: boolean = false;

function aguardandoColeta(p: PedidoExpedicao): boolean {
  return (
    COLETA_TEM_FONTE_NO_BANCO &&
    p.despachoConfirmado &&
    p.etapa === "PRONTO" &&
    (p.tipoFrete === "TRANSPORTADORA" || p.tipoFrete === "MOTOBOY")
  );
}

/**
 * PRECEDÊNCIA DAS CORES — INVERTIDA em 02/09/2026.
 *
 *   1. laranja  aguardando coleta (previsto; ver `aguardandoColeta`)
 *   2. azul     em `EXPEDICAO`, etapa `PRONTO` — COM OU SEM etiqueta
 *   3. verde    etiqueta gerada em pedido que já saiu da bancada
 *   4. cinza    o resto
 *
 * POR QUE INVERTEU. Até aqui o verde vencia sempre, e como quase todo pedido
 * tem etiqueta em algum momento, o painel virou monocromático: 33 verdes, 1
 * azul e 10 cinzas em 44. O azul, que deveria marcar o que PEDE AÇÃO, aparecia
 * por uma janela de segundos — no 21487 durou 25 segundos, entre imprimir a
 * etiqueta e confirmar o despacho. A cor tinha deixado de ajudar a achar
 * trabalho.
 *
 * A LEITURA NOVA: azul é o que ainda está na bancada e precisa de ação; verde é
 * o que já saiu, rotulado. Por isso o azul agora IGNORA a etiqueta — imprimir a
 * etiqueta não tira o pedido da bancada, só o despacho tira — e o verde passa a
 * exigir `ETAPAS_FORA_DA_BANCADA`, senão ele voltaria a roubar o azul.
 *
 * Efeito colateral aceito: pedido ainda em produção/acabamento que já tenha
 * rastreio deixa de ser verde e vira cinza. São zero no painel de hoje, e é a
 * leitura correta — ele não saiu de lugar nenhum.
 */
function faseDoCard(p: PedidoExpedicao) {
  if (aguardandoColeta(p)) return FASE_COLETA;
  if (p.etapa === "PRONTO") return FASE_BANCADA;
  if (p.etiquetaGerada && ETAPAS_FORA_DA_BANCADA.includes(p.etapa)) return FASE_ROTULADO;
  return FASE_FABRICA;
}

/**
 * Legenda das cores do card. Vive ao lado do alternador de visão e só aparece
 * no Kanban — na lista os fundos não existem, e uma legenda sem referente é
 * ruído.
 *
 * O marcador é um quadradinho arredondado, não um círculo: ele repete
 * `fase.classe` inteira (borda + fundo), então lê como um card em miniatura, e
 * é a MESMA cor que está na tela, não uma aproximação.
 */
export function LegendaCoresKanban() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {FASES_CARD_KANBAN.map((fase) => (
        <span
          key={fase.rotulo}
          className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium text-slate-600 dark:text-slate-400"
        >
          {/* 16 px (era 12): a 12 px o fundo quase não aparecia — sobrava a
              borda e a legenda perdia a função. O rótulo sobe junto, de 11 para
              12 px, para o par não ficar desequilibrado; `items-center` mantém
              quadrado e texto alinhados. Classe de cor inalterada. */}
          <span className={`h-4 w-4 shrink-0 rounded-[5px] border ${fase.classe}`} aria-hidden="true" />
          {fase.rotulo}
        </span>
      ))}
    </div>
  );
}

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
                  // A cor sai de `faseDoCard` (precedência) + `fase.classe`
                  // (tons) — a MESMA string que a legenda pinta no marcador.
                  className={`rounded-2xl border p-3.5 shadow-sm ${faseDoCard(p).classe}`}
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
                  {/* CONTEXTO DO PEDIDO (02/09/2026) — os mesmos campos da coluna
                      "Cliente" da lista, lidos da MESMA fonte (`p.cidadeUf` e
                      `p.pagador` do `PedidoExpedicao`), então card e lista não
                      têm como divergir: é literalmente o mesmo objeto.

                      Cores e rótulo da lista preservados — cidade em
                      `slate-500`, pagador em `indigo-700` com o prefixo
                      "Pagador:". Sem o prefixo ele leria como um segundo nome
                      de cliente. O corpo sobe de 11 px para 13 px porque este
                      card é ~30% maior que a célula da tabela.

                      `p.pagador` já nasce vazio quando o pagador é o próprio
                      cliente (regra `temPagadorDistinto`, no service), então a
                      linha simplesmente não existe nesse caso — nunca aparece
                      vazia. */}
                  {(p.cidadeUf || p.pagador) && (
                    <div className="mt-1 space-y-0.5">
                      {p.cidadeUf && (
                        <p
                          className="truncate text-[13px] leading-snug text-slate-500 dark:text-slate-400"
                          title={p.cidadeUf}
                        >
                          {p.cidadeUf}
                        </p>
                      )}
                      {p.pagador && (
                        <p
                          className="truncate text-[13px] font-medium leading-snug text-indigo-700 dark:text-indigo-400"
                          title={`Pagador: ${p.pagador}`}
                        >
                          Pagador: {p.pagador}
                        </p>
                      )}
                    </div>
                  )}
                  {(mostrarSelo || ehAtrasado || p.prometidoHoje) && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
