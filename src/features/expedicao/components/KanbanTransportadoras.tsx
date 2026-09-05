"use client";

import { useMemo } from "react";
import { Truck } from "lucide-react";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import type { ActionMenuItem } from "@/components/common/ActionsMenu";
import { EmptyState } from "@/components/common/EmptyState";
import { StatusBadge } from "@/components/common/StatusBadge";
import { formatCurrency } from "@/lib/formatters/currency";
import {
  categoriaExibida,
  CATEGORIAS_FRETE,
  LABEL_CATEGORIA_FRETE
} from "@/features/orcamentos/lib/categoria-frete";
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


/**
 * Data-calendário curta (`03/09`) da promessa de entrega.
 *
 * FATIA A STRING, não constrói `Date`: `propostas_os.data_termino` é
 * `timestamp` SEM timezone, e o service alerta explicitamente que converter
 * fuso aqui erra o dia. Este `slice(0, 10)` é a MESMA leitura que `promessaDia`
 * faz lá para calcular atraso e `prometidoHoje` — então o dia que o card mostra
 * é exatamente o dia que decide se o chip `ATRASADO` acende.
 *
 * Devolve string vazia quando não há promessa: 16 dos 44 cards do painel em
 * 02/09/2026 estão nessa situação, e a linha simplesmente não aparece.
 */
function dataPrevistaCurta(iso: string | null): string {
  if (!iso) return "";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}` : "";
}

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
  // BRANCO (02/09/2026), não mais `slate-50/50`. Sobre o fundo da página
  // (`--background`, #e8edf2) o cinza translúcido resolvia em #f0f4f7 — quase o
  // próprio fundo, e o card sumia desde que a coluna perdeu a moldura branca.
  // A borda sobe de `slate-200` para `slate-300` pelo mesmo motivo: `slate-200`
  // (#e2e8f0) é mais claro que o fundo e não desenhava contorno nenhum. O 300
  // alinha com `sky/emerald/amber-300` que as outras fases já usam.
  classe: "border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
} as const;

const FASE_BANCADA = {
  rotulo: "na bancada, a despachar",
  classe: "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30"
} as const;

const FASE_COLETA = {
  rotulo: "despachado, aguardando coleta",
  classe: "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
} as const;

const FASE_SAIU = {
  rotulo: "já saiu",
  classe: "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
} as const;

/**
 * Ordem de LEITURA da legenda — o caminho físico do volume, que NÃO é a ordem
 * de avaliação: fábrica → bancada → esperando a transportadora → saiu.
 * A precedência vive em `faseDoCard`.
 */
const FASES_CARD_KANBAN = [FASE_FABRICA, FASE_BANCADA, FASE_COLETA, FASE_SAIU];

/** Etapas em que o volume JÁ SAIU da bancada — onde o verde passa a valer. */
const ETAPAS_FORA_DA_BANCADA: EtapaExpedicao[] = ["A_RETIRAR", "EM_TRANSITO", "ENTREGUE"];

/**
 * LARANJA — "aguardando coleta". NO AR DESDE 02/09/2026 (Etapa 7).
 *
 * A flag `COLETA_TEM_FONTE_NO_BANCO` saiu junto com a migration de `613961c`,
 * que criou `expedicoes.coletado_em`. A condição também saiu daqui: ela é
 * derivada UMA VEZ no pipeline da lista, em `PedidoExpedicao.aguardandoColeta`
 * — despacho confirmado + `coletado_em` nula + etapa `PRONTO` + transporte
 * `TRANSPORTADORA`/`MOTOBOY`. O card só lê o campo; a cor e a ação primária
 * bebem da mesma fonte e não podem discordar.
 */

/**
 * PRECEDÊNCIA DAS CORES — INVERTIDA em 02/09/2026.
 *
 *   1. laranja  aguardando coleta (`p.aguardandoColeta`, derivado no service)
 *   2. azul     em `EXPEDICAO`, etapa `PRONTO` — COM OU SEM etiqueta
 *   3. verde    pedido que já saiu da bancada
 *   4. branco   o resto
 *
 * POR QUE INVERTEU. Até aqui o verde vencia sempre, e como quase todo pedido
 * tem etiqueta em algum momento, o painel virou monocromático: 33 verdes, 1
 * azul e 10 cinzas em 44. O azul, que deveria marcar o que PEDE AÇÃO, aparecia
 * por uma janela de segundos — no 21487 durou 25 segundos, entre imprimir a
 * etiqueta e confirmar o despacho. A cor tinha deixado de ajudar a achar
 * trabalho.
 *
 * A LEITURA NOVA: azul é o que ainda está na bancada e precisa de ação; verde é
 * o que já saiu. Por isso o azul agora IGNORA a etiqueta — imprimir a etiqueta
 * não tira o pedido da bancada, só o despacho tira — e o verde passa a exigir
 * `ETAPAS_FORA_DA_BANCADA`, senão ele voltaria a roubar o azul.
 *
 * Efeito colateral aceito: pedido ainda em produção/acabamento que já tenha
 * rastreio deixa de ser verde e vira branco. São zero no painel de hoje, e é a
 * leitura correta — ele não saiu de lugar nenhum.
 *
 * O VERDE PAROU DE EXIGIR ETIQUETA (03/09/2026). O despacho é o único divisor
 * de estado da Expedição, e a etiqueta não muda estado nenhum — então ela não
 * podia continuar decidindo uma cor. `p.etiquetaGerada &&` na terceira linha
 * jogava em BRANCO pedido que já tinha saído sem etiqueta impressa, e branco é
 * "ainda na fábrica": a cor dizia o contrário do fato. Medido em 03/09/2026,
 * são 3 no painel — 20961 (EM TRANSITO), 21244 e 21557 (ENTREGUE), os três sem
 * etiqueta, sem prepostagem e sem rastreio. Passam a verde, que é onde sempre
 * deveriam estar. Nenhum pedido troca de cor em qualquer outra direção.
 */
function faseDoCard(p: PedidoExpedicao) {
  if (p.aguardandoColeta) return FASE_COLETA;
  if (p.etapa === "PRONTO") return FASE_BANCADA;
  if (ETAPAS_FORA_DA_BANCADA.includes(p.etapa)) return FASE_SAIU;
  return FASE_FABRICA;
}

/**
 * PONTO DE ESTADO — o mesmo sistema de cores, para a VISÃO DE LISTA (02/09/2026).
 *
 * A lista não pode pintar o fundo da linha: ele já é do realce de URGÊNCIA
 * (vermelho para atrasado, âmbar para prometido hoje), que é informação mais
 * escassa e não pode ser disputada. O estado entra como um ponto de 8 px antes
 * do badge de Status — mesma precedência, mesmas quatro cores, mesma fonte:
 * `faseDoCard` e `fase.classe`, exatamente o que o card pinta. Não há como
 * divergirem.
 *
 * O `ring` translúcido não é cor nova: é a mesma tinta neutra do fio do rodapé
 * do card. Existe porque um ponto laranja (`amber-50`) sobre uma linha realçada
 * de âmbar quase some — é o caso real do 21503, que hoje é aguardando coleta E
 * prometido hoje. O anel dá a borda que o realce come.
 */
export function PontoEstadoKanban({ pedido }: { pedido: PedidoExpedicao }) {
  const fase = faseDoCard(pedido);
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full border ring-1 ring-slate-900/15 dark:ring-slate-100/20 ${fase.classe}`}
      title={fase.rotulo}
      aria-hidden="true"
    />
  );
}

/**
 * Legenda das cores. Vive ao lado do alternador de visão e vale nas DUAS: no
 * Kanban explica o fundo do card, na lista explica o ponto de estado
 * (`PontoEstadoKanban`). Um componente só, sem cópia — os marcadores leem
 * `fase.classe`, a mesma string que o card e o ponto pintam.
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

/**
 * COLUNAS FIXAS POR CATEGORIA (05/09/2026).
 *
 * O QUE MUDOU, E POR QUE
 *   Até aqui a coluna nascia do NOME da transportadora (`T:${nome}`), e o painel
 *   crescia sem limite: cada transportadora nova virava uma coluna, e a bancada
 *   passava a rolar de lado para achar o que despachar. As sete categorias são
 *   fechadas por decisão de negócio, e o nome continua onde sempre esteve — no
 *   card.
 *
 * A CATEGORIA JÁ VEM RESOLVIDA. `p.categoriaFrete` saiu de `categoriaFreteVigente`
 * no service, com a precedência do despacho aplicada uma vez só. Este componente
 * NÃO reaplica regra nenhuma: só agrupa.
 *
 * `null` cai em EXTRAS por `categoriaExibida`, que é o ponto único dessa decisão.
 * Enquanto o histórico não for classificado (Etapa 7), é lá que quase tudo mora —
 * e isso é esperado, não defeito.
 *
 * A ORDEM É A DE `CATEGORIAS_FRETE`, não alfabética: ela é a sequência que a
 * direção pediu, e alfabética jogaria AEREO na frente de CORREIOS.
 *
 * COLUNA VAZIA NÃO APARECE. Sete colunas sempre visíveis, com cinco delas em
 * branco, gastariam a largura que a bancada usa para trabalhar.
 */
function agruparPorCategoria(pedidos: PedidoExpedicao[]): ColunaKanban[] {
  const mapa = new Map<string, ColunaKanban>();
  for (const p of pedidos) {
    const chave = categoriaExibida(p.categoriaFrete);
    const coluna = mapa.get(chave) ?? { chave, titulo: LABEL_CATEGORIA_FRETE[chave], pedidos: [] };
    coluna.pedidos.push(p);
    mapa.set(chave, coluna);
  }
  for (const coluna of mapa.values()) coluna.pedidos = prontosPrimeiro(coluna.pedidos);

  return CATEGORIAS_FRETE.map((c) => mapa.get(c)).filter((c): c is ColunaKanban => Boolean(c));
}

/**
 * QUEM LEVA O PEDIDO — a linha que a coluna deixou de dizer.
 *
 * POR QUE ELA EXISTE
 *   Enquanto a coluna era o NOME da transportadora, o card não precisava
 *   repeti-lo: quem olhava a coluna já sabia. Com as colunas por categoria, o
 *   operador que separa um volume em RODOVIARIO, AEREO ou EXTRAS não tem como
 *   saber quem leva sem abrir o pedido. A informação voltou, agora no card.
 *
 * DE ONDE VEM
 *   `p.rotuloTransporte`, resolvido no service e NÃO reimplementado aqui: ele já
 *   aplica a precedência do módulo inteiro — o que o expedidor registrou vence o
 *   que o orçamento previa, quando o despacho está confirmado. Nenhuma consulta
 *   nova; o campo já vinha no objeto que o card recebe.
 *
 * RETIRA É A EXCEÇÃO, e é deliberada. Ali não existe transportadora: a
 *   mercadoria é buscada no balcão. O rótulo resolvido hoje já diz "Retira
 *   balcão" ou "Retirada Local" nos 19 pedidos da coluna, mas ele PODE devolver
 *   o serviço de uma cotação que sobrou — um "SEDEX" num pedido de balcão. Em
 *   vez de depender de o dado estar bom, a coluna RETIRA imprime um texto fixo,
 *   que nunca pode contradizê-la.
 *
 * NUNCA MUDO. Sem nome resolvido, `rotuloTransporte` cai em `labelTipoFrete`,
 *   que devolve "A definir" — e aí o card diz "Transporte a definir", que é uma
 *   pendência declarada, não uma transportadora inventada.
 */
function quemLeva(p: PedidoExpedicao, categoria: string): string {
  if (categoria === "RETIRA") return "Retira no balcão";
  const rotulo = p.rotuloTransporte.trim();
  if (rotulo === "" || rotulo === "A definir") return "Transporte a definir";
  return rotulo;
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
  const colunas = useMemo(() => agruparPorCategoria(pedidos), [pedidos]);

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
               * O SUB-ESTADO "Aguardando transportadora" SAIU EM 03/09/2026.
               * Ele era `PRONTO` + etiqueta gerada + não-balcão, e forçava o
               * selo a aparecer sempre. Prometia uma mudança de estado que não
               * existe: imprimir a etiqueta não move o pedido de lugar nenhum —
               * só o despacho move. Além disso a lista, que sempre imprimiu
               * `p.statusInterno` cru, dizia "Na Expedição" no mesmo pedido em
               * que o card dizia "Aguardando transportadora". As duas telas
               * agora leem o mesmo campo.
               *
               * A ação que falta não se perdeu junto: o card continua AZUL ("na
               * bancada, a despachar") e `acaoPrimaria` — que nunca leu o selo —
               * segue abrindo o ⋯ com "Despachar" no topo.
               */
              const mostrarSelo = p.etapa !== etapaFiltro;
              // Promessa de entrega, curta. Vazia = pedido sem `data_termino`,
              // e aí nada é exibido — nem rótulo, nem travessão.
              const prevista = dataPrevistaCurta(p.dataPromessa);
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
                      {/* Mesmo corpo do `#id`, sem negrito: o cadastro é tão
                          identificador quanto o número do pedido na conferência
                          de bancada, e a hierarquia entre os dois fica só no
                          peso e na cor, não no tamanho. */}
                      {p.idCliente !== null && (
                        <span className="whitespace-nowrap text-[17px] font-normal text-slate-500 dark:text-slate-400">
                          cli {p.idCliente}
                        </span>
                      )}
                    </span>
                    <ActionsMenu items={acoes} label="Ações" variant="icone" />
                  </div>
                  {/* Duas linhas, não uma: "LISITON DOCUMENTOS SEGUROS LTDA" e
                      "LISITON DOCUMENTOS SEGUROS ME" truncavam idênticos em uma
                      linha só. O `title` continua entregando o nome inteiro. */}
                  {/* FANTASIA, com a razão no `title` (02/09/2026). É o nome
                      pelo qual a bancada conhece o cliente: "DSEG IMPRESSOS"
                      cabe em meia linha onde "LISITON DOCUMENTOS SEGUROS LTDA"
                      ocupava as duas. Cai na razão quando não há fantasia — 5
                      dos 24 clientes do painel, quase todos pessoa física.
                      A LISTA segue mostrando a razão: `p.cliente` não mudou. */}
                  <p
                    className="mt-1.5 line-clamp-2 text-[16px] font-semibold leading-[1.3] text-slate-900 dark:text-slate-100"
                    title={p.cliente}
                  >
                    {p.clienteExibicao}
                  </p>
                  {/* CONTEXTO DO PEDIDO (02/09/2026).

                      A CIDADE É A DO ENDEREÇO DE ENTREGA (03/09/2026), não a do
                      cadastro do cliente. Vinha de `p.cidadeUf`, que é
                      `clientes.cidade_uf` — e nos 18 pedidos do 8469 isso dizia
                      "Santa Cruz do Sul" enquanto o volume ia para Santarém/PA,
                      Goiânia/GO, Porto Velho/RO. O card mostrava uma cidade e a
                      etiqueta imprimia outra.

                      Agora sai de `p.enderecoEntrega.cidadeUf`, resolvido por
                      `idEnderecoEntregaVigente` — a MESMA função e o MESMO
                      endereço que a etiqueta, a Declaração e o modal usam. Sem
                      fallback para o cadastro de propósito: sem endereço, sem
                      linha; cair no cadastro reintroduziria justamente o erro.

                      Cores da lista preservadas — cidade em `slate-500`,
                      pagador em `indigo-700`. O corpo sobe de 11 px para 13 px
                      porque este card é ~30% maior que a célula da tabela.

                      O PREFIXO "Pagador:" SAIU do texto visível (02/09/2026):
                      quem separa a linha do nome do cliente e da cidade é a
                      COR, que continua sendo o indigo e é exclusiva dela no
                      card. O prefixo fica só no `title`, onde ainda explica o
                      que aquela linha é para quem passa o mouse. A LISTA
                      mantém o prefixo — lá a coluna é estreita, o texto é
                      menor e não há cor que a distinga tão bem.

                      `p.pagador` já nasce vazio quando o pagador é o próprio
                      cliente (regra `temPagadorDistinto`, no service), então a
                      linha simplesmente não existe nesse caso — nunca aparece
                      vazia. */}
                  {(p.enderecoEntrega?.cidadeUf || p.pagador) && (
                    <div className="mt-1 space-y-0.5">
                      {p.enderecoEntrega?.cidadeUf && (
                        <p
                          className="truncate text-[13px] leading-snug text-slate-500 dark:text-slate-400"
                          title={p.enderecoEntrega.rotulo}
                        >
                          {p.enderecoEntrega.cidadeUf}
                        </p>
                      )}
                      {p.pagador && (
                        <p
                          className="truncate text-[13px] font-medium leading-snug text-indigo-700 dark:text-indigo-400"
                          title={`Pagador: ${p.pagador}`}
                        >
                          {p.pagador}
                        </p>
                      )}
                    </div>
                  )}
                  {/* QUEM LEVA, em destaque — a informacao que a coluna deixou
                      de dizer quando virou categoria.

                      EM DESTAQUE DE VERDADE, e nao mais um cinza no rodape: e o
                      que o operador procura ao separar o volume na bancada. Vem
                      como chip, com contorno e icone, para se distinguir das
                      linhas de contexto (cidade, pagador) sem competir com o
                      nome do cliente, que continua sendo o maior texto do card.

                      NADA FOI REMOVIDO NEM MOVIDO: o chip entra como uma linha
                      nova entre o contexto e os selos. `min-w-0` + `truncate`
                      seguram nome longo em tela estreita, e o `title` entrega o
                      texto inteiro. */}
                  <div className="mt-2 flex">
                    <span
                      className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-slate-900/15 bg-white/70 px-2 py-1 dark:border-slate-100/20 dark:bg-slate-900/40"
                      title={`Transporte: ${quemLeva(p, coluna.chave)}`}
                    >
                      <Truck className="h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden="true" />
                      <span className="truncate text-[14px] font-bold leading-tight text-slate-800 dark:text-slate-100">
                        {quemLeva(p, coluna.chave)}
                      </span>
                    </span>
                  </div>
                  {(mostrarSelo || ehAtrasado || p.prometidoHoje || prevista) && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {mostrarSelo && <StatusBadge status={p.statusInterno} />}
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
                      {/* Data prevista, encostada à direita da MESMA linha dos
                          selos: é a informação que decide urgência, e fica ao
                          lado de quem já a traduziu em ATRASADO/HOJE. Texto
                          discreto, não chip — um chip a mais competiria com as
                          cores que significam status. */}
                      {prevista && (
                        <span className="ml-auto whitespace-nowrap text-[13px] font-semibold text-slate-600 dark:text-slate-400">
                          <span className="text-[10px] font-medium text-slate-500 dark:text-slate-500">prev </span>
                          {prevista}
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
