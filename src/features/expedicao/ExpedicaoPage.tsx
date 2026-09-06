"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Bike,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  LayoutGrid,
  MapPin,
  Package,
  PackageCheck,
  Search,
  Send,
  Truck
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SummaryCard } from "@/components/common/SummaryCard";
import { StatusBadge } from "@/components/common/StatusBadge";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { EmptyState } from "@/components/common/EmptyState";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { formatCurrency } from "@/lib/formatters/currency";
import { codecs } from "@/lib/url-state";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebouncedInput } from "@/hooks/useDebouncedValue";
import { listarPainelExpedicao } from "./services/expedicao.service";
import { encerrarTeste } from "@/features/pedidos/services/encerrar-teste.client";
import { marcarPronto, marcarEntregue, confirmarColeta } from "./services/expedicao-acoes.service";
import { marcarPrepostagemCancelada } from "./services/correios.client";
import { liberarRecotacao, revogarRecotacao } from "./services/recotacao.client";
import { abrirDeclaracaoConteudo } from "./services/etiqueta.client";
import { ConfirmarAcaoModal } from "./components/ConfirmarAcaoModal";
import {
  avisoFiltroLegado,
  FILTRO_FRETE_TODOS,
  resolverFiltroCategoria
} from "./lib/filtro-categoria";
import { categoriaExibida, CATEGORIAS_FRETE, LABEL_CATEGORIA_FRETE } from "@/features/orcamentos/lib/categoria-frete";
import { avisoEntregaCedoDemais } from "./lib/entrega-cedo";
import { rotuloClienteComNumero } from "./lib/cliente-rotulo";
import { DespacharModal } from "./components/DespacharModal";
import { RetiradaModal } from "./components/RetiradaModal";
import { VoltarStatusModal } from "./components/VoltarStatusModal";
import { TransportadorasModal } from "./components/TransportadorasModal";
import { RastreioModal } from "./components/RastreioModal";
import { CorrigirFreteModal } from "./components/CorrigirFreteModal";
import { DiferencaFinanceiraModal } from "@/features/orcamentos/components/DiferencaFinanceiraModal";
import type { AcaoFinanceiraDiferenca } from "@/features/cobrancas/types";
import { STATUS_CORRIGIVEIS } from "./services/corrigir-frete-simulacao";
import type { RespostaConfirmacao } from "./services/corrigir-frete.client";
import { KanbanTransportadoras, LegendaCoresKanban, PontoEstadoKanban } from "./components/KanbanTransportadoras";
import type { EtapaExpedicao, PedidoExpedicao, TipoFreteNormalizado } from "./types";

const filterClass =
  "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200";

/**
 * OS CINCO CARDS SAO INDEPENDENTES (01/09/2026).
 *
 * Sairam os cards "Todos" e "Em fabricacao", sairam TODOS os chips de alerta, e
 * o clique deixou de alternar: clicar no card ativo nao desfaz mais o filtro.
 * Com isso morreram o filtro `alerta` da URL, o mapa `CASA_ALERTA`, as contagens
 * dos chips e o valor de filtro `FABRICACAO`.
 *
 * O que NAO morreu foram os dois criterios dos chips "Atrasados" e "Prometidos
 * hoje": eles viraram o card "Expedicao do dia". Os predicados abaixo sao os
 * mesmos, sem uma virgula de diferenca — e por isso a contagem do card e, por
 * construcao, a soma exata que os dois chips mostravam. Sem sobreposicao:
 * `atrasadoDias > 0` exige promessa ANTES de hoje e `prometidoHoje` exige IGUAL
 * a hoje, entao nenhum pedido conta duas vezes.
 */

/** Promessa vencida e pedido ainda em aberto. */
function ehAtrasado(p: PedidoExpedicao): boolean {
  return p.atrasadoDias > 0 && p.etapa !== "ENTREGUE";
}

/** `prometidoHoje` ja nasce false para ENTREGUE no servico, entao nao repete o corte. */
function ehPrometidoHoje(p: PedidoExpedicao): boolean {
  return p.prometidoHoje;
}

/**
 * O recorte do card "Entregues": entregue nos ULTIMOS 7 DIAS.
 *
 * PONTO UNICO. A contagem do cartao e o filtro que o clique aplica leem ESTA
 * funcao, e so ela — se cada um tivesse a sua condicao, o numero exibido e a
 * lista aberta divergiriam no dia em que alguem mexesse num dos dois.
 *
 * A JANELA NAO E A MESMA DA EXIBICAO. O painel guarda entregue por 30 dias; o
 * cartao pergunta o que saiu na semana. As duas sao deliberadas e estao
 * documentadas juntas no topo de `expedicao.service.ts`. `entregueNaJanelaDoCard`
 * ja chega decidido de la, porque calcular "hoje" aqui seria chamada impura em
 * render.
 */
function ehEntregueNoCard(p: PedidoExpedicao): boolean {
  return p.entregueNaJanelaDoCard;
}

/**
 * O recorte do card "Expedicao do dia": `dataPromessa <= hoje`, em QUALQUER
 * etapa — inclusive PRODUCAO e ACABAMENTO. Pedido atrasado que ainda esta na
 * fabrica e problema do dia tanto quanto o que ja esta na bancada, e com o card
 * "Em fabricacao" fora e por aqui que ele aparece.
 */
function ehExpedicaoDoDia(p: PedidoExpedicao): boolean {
  return ehAtrasado(p) || ehPrometidoHoje(p);
}

/**
 * Valor de FILTRO do card "Expedicao do dia" — e o estado INICIAL da pagina, no
 * lugar de "Pronto p/ expedir", e o alvo do "Limpar filtros".
 *
 * Nao e uma `EtapaExpedicao`: e recorte por PROMESSA, nao por etapa, e por isso
 * atravessa o funil inteiro. Tomou o lugar do "Pronto p/ expedir" porque a
 * pergunta que abre o dia nao e "o que esta na bancada", e sim "o que tem de
 * sair hoje".
 */
const ETAPA_DIA = "DIA";
const ETAPA_INICIAL = ETAPA_DIA;

/**
 * Visão com que a página ABRE — o Kanban por transportadora, desde 01/09/2026.
 *
 * A bancada trabalha por transportadora: o que importa na hora de despachar é
 * "o que sai pela SVT hoje", não uma tabela ordenada por número de pedido. A
 * lista continua inteira, a um clique no alternador.
 *
 * É também o alvo do "Limpar filtros", junto com `ETAPA_INICIAL`: limpar devolve
 * ao ponto de partida da tela, e a visão faz parte dele.
 */
const VISAO_INICIAL = "transportadoras";

const ICONE_TIPO_FRETE: Record<TipoFreteNormalizado, typeof Truck> = {
  CORREIOS: Send,
  MOTOBOY: Bike,
  TRANSPORTADORA: Truck,
  RETIRA_BALCAO: MapPin,
  SEM_CUSTO: Package,
  INDEFINIDO: AlertCircle
};

function formatarPromessa(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function formatarPeso(p: PedidoExpedicao): string {
  if (p.pesoKg === null) return "—";
  const kg = p.pesoKg.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const sufixo = p.pesoOrigem === "aferido" ? "" : p.pesoOrigem === "cotado" ? " (cotado)" : " (previsto)";
  return `${kg} kg${sufixo}`;
}

export function ExpedicaoPage() {
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const router = useRouter();
  const [pedidos, setPedidos] = useState<PedidoExpedicao[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const canOperar = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "expedicao.processar");
  /**
   * O MODO DO MODAL E SINAL EXPLICITO, NAO DERIVADO DA ETAPA (02/09/2026).
   *
   * Era `modoEdicao={pedidoDespacho.etapa !== "PRONTO"}`: enquanto "Editar
   * dados de expedicao" so aparecia depois do despacho, etapa e modo eram a
   * mesma coisa. Deixaram de ser — a acao passou a aparecer sempre que ha
   * etiqueta gerada, inclusive em `PRONTO`, onde ela precisa abrir em EDICAO
   * enquanto "Despachar" abre em DESPACHO. Duas portas, o mesmo pedido, modos
   * diferentes: quem abre e que diz qual.
   */
  const [pedidoDespacho, setPedidoDespacho] = useState<
    { pedido: PedidoExpedicao; modo: "DESPACHO" | "EDICAO" } | null
  >(null);
  const [pedidoRetirada, setPedidoRetirada] = useState<PedidoExpedicao | null>(null);
  const [pedidoVoltar, setPedidoVoltar] = useState<PedidoExpedicao | null>(null);
  const [pedidoRastreio, setPedidoRastreio] = useState<PedidoExpedicao | null>(null);
  /**
   * O PEDIDO DA CORREÇÃO É DERIVADO DA LISTA, não uma cópia dele.
   *
   * Guardar o objeto congelava o que o modal lia: `recarregar()` troca o array
   * inteiro por objetos novos, e a referência guardada continuava apontando para
   * o estado anterior à gravação — a modalidade velha sobrevivia ali mesmo com o
   * banco já corrigido. Guardando o `id_int` e procurando na lista viva, todo
   * `recarregar()` atualiza também o que o modal lê, sem nenhuma leitura a mais.
   *
   * Some da tela se o pedido sair do painel, que é o comportamento correto: o
   * modal não deve seguir aberto sobre um pedido que não está mais na lista.
   */
  const [corrigirFreteId, setCorrigirFreteId] = useState<number | null>(null);
  const pedidoCorrigirFrete = useMemo(
    () => (corrigirFreteId === null ? null : (pedidos.find((p) => p.idInt === corrigirFreteId) ?? null)),
    [corrigirFreteId, pedidos]
  );

  /**
   * Crédito ao cliente gerado por uma correção JÁ GRAVADA, esperando destino.
   * Alimenta o `DiferencaFinanceiraModal` de Orçamentos — ele exige a pendência
   * criada, e é por isso que este estado só nasce depois do confirmar.
   */
  const [diferencaModal, setDiferencaModal] = useState<{
    idInt: number;
    idCliente: number;
    idPendencia: number;
    nomeCliente: string;
    valorPagoConfirmado: number;
    novoTotal: number;
    diferenca: number;
  } | null>(null);
  const [transportadorasAberto, setTransportadorasAberto] = useState(false);
  const [salvandoAcao, setSalvandoAcao] = useState<number | null>(null);
  /** Pedido cuja prepostagem esta sendo marcada como cancelada (trava o item). */
  const [marcandoCanceladaId, setMarcandoCanceladaId] = useState<number | null>(null);
  // Confirmação de mudança de status no modal do sistema, não no confirm() do navegador.
  /**
   * `aviso` e calculado no CLIQUE, nao no render: ler o relogio durante o render
   * e chamada impura, e o valor precisa ser o do instante em que o operador
   * decidiu. Nulo quando nao ha o que avisar — que e o caso de tudo que nao e
   * Correios recem-postado.
   */
  const [confirmacao, setConfirmacao] = useState<{
    pedido: PedidoExpedicao;
    tipo: "PRONTO" | "ENTREGUE" | "COLETA";
    aviso?: string | null;
  } | null>(null);

  /**
   * Abre a confirmacao de entrega ja com o aviso.
   *
   * `agora` vem de fora, do proprio manipulador do clique: ler o relogio aqui
   * dentro faria desta funcao uma chamada impura que o eslint acusa por ser
   * declarada no corpo do componente — a mesma regra que ja barrou `Date.now()`
   * no render da lista de OS. No manipulador ela e legitima, e o instante e
   * exatamente o da decisao.
   */
  function pedirConfirmacaoDeEntrega(p: PedidoExpedicao, agora: number) {
    setConfirmacao({ pedido: p, tipo: "ENTREGUE", aviso: avisoEntregaCedoDemais(p, agora) });
  }

  function atorAtual() {
    return {
      uid: user?.id ?? null,
      // MockUser não tem campo `nome` (brief previa `user?.nome`) — o campo real é `name`.
      nome: user?.name ?? user?.email ?? null
    };
  }

  async function handleMarcarPronto(p: PedidoExpedicao) {
    if (salvandoAcao !== null) return;
    setSalvandoAcao(p.idInt);
    const res = await marcarPronto(p.idInt, p.statusInterno, atorAtual());
    setSalvandoAcao(null);
    if (res.success) {
      showToast({ type: "success", title: "Pedido pronto para expedir", description: `#${p.idInt} agora está na bancada da expedição.` });
    } else {
      showToast({ type: "error", title: "Não foi possível marcar pronto", description: res.error });
    }
    void recarregar();
  }

  /**
   * AGUARDANDO COLETA -> EM TRANSITO (02/09/2026, Etapa 7). Espelha
   * `handleMarcarPronto`: mesmo guard de concorrencia, mesmo toast, mesmo
   * `recarregar`. `canOperar` ja e exigido em `acaoPrimaria`, que e o unico
   * caminho ate aqui.
   */
  async function handleConfirmarColeta(p: PedidoExpedicao) {
    if (salvandoAcao !== null) return;
    setSalvandoAcao(p.idInt);
    const res = await confirmarColeta(p.idInt, atorAtual());
    setSalvandoAcao(null);
    if (res.success) {
      showToast({ type: "success", title: "Coleta confirmada", description: `#${p.idInt} saiu com a transportadora e está EM TRANSITO.` });
    } else {
      showToast({ type: "error", title: "Não foi possível confirmar a coleta", description: res.error });
    }
    void recarregar();
  }

  async function handleMarcarEntregue(p: PedidoExpedicao) {
    if (salvandoAcao !== null) return;
    setSalvandoAcao(p.idInt);
    const res = await marcarEntregue(p.idInt, atorAtual());
    setSalvandoAcao(null);
    if (res.success) {
      showToast({ type: "success", title: "Pedido entregue", description: `#${p.idInt} concluído.` });
    } else {
      showToast({ type: "error", title: "Não foi possível concluir", description: res.error });
    }
    void recarregar();
  }

  /** Botão primário contextual por etapa — compartilhado entre a coluna "Ações" e o card mobile. */
  function acaoPrimaria(p: PedidoExpedicao) {
    const ocupado = salvandoAcao === p.idInt;
    return !canOperar
      ? null
      : p.etapa === "PRODUCAO" || p.etapa === "ACABAMENTO"
        ? { rotulo: ocupado ? "Salvando..." : "Marcar pronto", acao: () => setConfirmacao({ pedido: p, tipo: "PRONTO" }) }
        : // AGUARDANDO COLETA vem ANTES de PRONTO: o pedido continua na etapa
          // `PRONTO` (segue em EXPEDICAO), mas o que falta nele nao e despachar
          // — ja foi despachado — e sim registrar que o carro passou.
          p.aguardandoColeta
          ? { rotulo: ocupado ? "Salvando..." : "Confirmar coleta", acao: () => setConfirmacao({ pedido: p, tipo: "COLETA" }) }
          : p.etapa === "PRONTO"
          ? { rotulo: "Despachar", acao: () => setPedidoDespacho({ pedido: p, modo: "DESPACHO" }) }
          : p.etapa === "A_RETIRAR"
            ? { rotulo: "Confirmar retirada", acao: () => setPedidoRetirada(p) }
            : p.etapa === "EM_TRANSITO"
              ? { rotulo: ocupado ? "Salvando..." : "Marcar entregue", acao: () => pedirConfirmacaoDeEntrega(p, Date.now()) }
              : null;
  }

  /**
   * Marca no ERP que a prepostagem ja foi cancelada no portal dos Correios.
   *
   * Nao chama os Correios: o cancelamento e manual e acontece fora do sistema.
   * A rota grava a data, o uid e o nome a partir da SESSAO DO SERVIDOR e nao
   * toca em prepostagem, objeto ou rastreio — que continuam no banco.
   */
  async function handleMarcarPrepostagemCancelada(p: PedidoExpedicao) {
    if (marcandoCanceladaId !== null) return;
    setMarcandoCanceladaId(p.idInt);
    const res = await marcarPrepostagemCancelada(p.idInt);
    setMarcandoCanceladaId(null);
    if (!res.success) {
      showToast({ type: "error", title: "Nao foi possivel marcar", description: res.errorMessage });
      return;
    }
    showToast({
      type: res.jaMarcada ? "info" : "success",
      title: res.jaMarcada ? "Ja estava marcada" : "Prepostagem marcada como cancelada",
      description: `Pedido #${p.idInt}: o rastreio e a etiqueta oficial saem da tela e uma nova prepostagem pode ser gerada.`
    });
    void recarregar();
  }

  /**
   * Liberar / cancelar a recotacao de frete de um pedido (Parte C).
   * O expedidor nao recota por conta propria: o botao no modal Despachar nasce
   * bloqueado e depende desta autorizacao, que e de USO UNICO — a aplicacao a
   * consome e o botao volta a bloquear.
   */
  async function handleLiberarRecotacao(p: PedidoExpedicao) {
    const res = await liberarRecotacao(p.idInt);
    if (res.success) {
      showToast({
        type: "success",
        title: res.idempotente ? "Já estava liberado" : "Recotação liberada",
        description: res.idempotente
          ? `O pedido ${p.idInt} já tinha liberação ativa${res.liberadoPorNome ? ` (por ${res.liberadoPorNome})` : ""}.`
          : `O expedidor já pode recotar o frete do pedido ${p.idInt}. Vale para uma aplicação.`
      });
    } else {
      showToast({ type: "error", title: "Não foi possível liberar", description: res.errorMessage });
    }
    void recarregar();
  }

  async function handleCancelarLiberacao(p: PedidoExpedicao) {
    const res = await revogarRecotacao(p.idInt);
    if (res.success) {
      showToast({
        type: "success",
        title: "Liberação cancelada",
        description: `A recotação do pedido ${p.idInt} voltou a ficar bloqueada.`
      });
    } else {
      showToast({ type: "error", title: "Não foi possível cancelar", description: res.errorMessage });
    }
    void recarregar();
  }

  async function handleEncerrarTeste(p: PedidoExpedicao) {
    if (encerrandoTesteId !== null) return;
    const ok = window.confirm(
      `Encerrar o pedido #${p.idInt} como TESTE?\n\n` +
        `Ele sai deste painel, do painel de Produção, do Kanban e da fila de impressão.\n` +
        `Continua acessível por busca e por URL, e segue contando no faturamento.\n\n` +
        `Para reabrir, use o menu Ações em Orçamentos.`
    );
    if (!ok) return;
    setEncerrandoTesteId(p.idInt);
    try {
      const res = await encerrarTeste(p.idInt);
      if (res.success) {
        showToast({
          type: "success",
          title: res.idempotente ? "Pedido já estava encerrado" : "Teste encerrado",
          description: `#${p.idInt} saiu das listas operacionais. Reabra em Orçamentos, se precisar.`
        });
        void recarregar();
      } else {
        showToast({
          type: "error",
          title: "Erro ao encerrar",
          description: res.errorMessage || "Não foi possível encerrar o teste."
        });
      }
    } finally {
      setEncerrandoTesteId(null);
    }
  }

  /** Itens do menu "⋯" contextual — compartilhado entre a coluna "Ações" e o card mobile. */
  function itensMenu(p: PedidoExpedicao) {
    return [
      ...(p.codigoRastreamento
        ? [{ label: "Rastrear objeto", onClick: () => setPedidoRastreio(p) }]
        : []),
      // Marcar que a prepostagem foi cancelada NO PORTAL dos Correios. So faz
      // sentido enquanto existe prepostagem e ela ainda nao foi marcada; a
      // permissao vale mesmo — a rota reconfere `expedicao.admin` no servidor.
      ...(canAdminExpedicao && p.expedicao?.correiosIdPrepostagem && !p.expedicao?.prepostagemCanceladaEm
        ? [
            {
              label:
                marcandoCanceladaId === p.idInt
                  ? "Marcando..."
                  : "Marcar prepostagem como cancelada",
              destructive: true,
              onClick: () => { void handleMarcarPrepostagemCancelada(p); }
            }
          ]
        : []),
      // Só aparece quando não é redundante com o botão primário: PRODUCAO/ACABAMENTO
      // ainda não têm dados de expedição para editar e PRONTO já tem "Despachar".
      // ETIQUETA GERADA BASTA (02/09/2026). Antes a acao so existia depois do
      // despacho, e reimprimir ou corrigir a observacao de um pedido AINDA na
      // bancada era impossivel — a unica porta era "Despachar", que confirma o
      // despacho. Agora as duas coexistem em `PRONTO`: esta so edita e
      // reimprime, e abre em EDICAO por sinal explicito.
      //
      // Os estados que ja tinham a acao seguem com ela: a condicao e OU, nao
      // substituicao. `canOperar` continua sendo o gate.
      ...(canOperar && (p.etiquetaGerada || ["A_RETIRAR", "EM_TRANSITO", "ENTREGUE"].includes(p.etapa))
        ? [
            {
              label: "Editar dados de expedição",
              onClick: () => setPedidoDespacho({ pedido: p, modo: "EDICAO" })
            }
          ]
        : []),
      // A ETIQUETA SAIU DAQUI EM 01/09/2026. Passou a viver dentro do
      // DespacharModal, junto do despacho que ela documenta, e so habilita depois
      // dos campos minimos — antes dava para imprimir o rotulo de um envio que
      // ninguem tinha terminado de declarar. Reimpressao de pedido ja despachado
      // continua possivel por "Editar dados de expedicao", logo acima: abre o
      // MESMO modal em modo edicao, onde os campos minimos nao sao exigidos.
      // A regra de escolha do modelo vive em `lib/etiqueta-do-pedido.ts`.
      // Sem NF-e autorizada, a remessa viaja com declaração de conteúdo. O rótulo
      // dos Correios traz só a etiqueta — este é o papel que vai no volume.
      ...(p.etapa !== "PRODUCAO" && p.etapa !== "ACABAMENTO" && p.nfStatus !== "AUTORIZADA"
        ? [{
            label: "Declaração de conteúdo",
            onClick: () => {
              void abrirDeclaracaoConteudo(p.idInt).then((res) => {
                if (!res.success) {
                  showToast({ type: "error", title: "Erro na declaração", description: res.errorMessage });
                }
              });
            }
          }]
        : []),
      // Boletim no lugar dos detalhes da proposta: na bancada o que se consulta é
      // o que foi produzido, não a negociação. Sempre `modo=edicao` — pedido que
      // chegou à expedição já tem OS aberta.
      { label: "Boletim da produção", onClick: () => router.push(`/pedidos/boletim?id_int=${p.idInt}&modo=edicao`) },
      // Liberacao da recotacao de frete. Sem filtro por modalidade de proposito:
      // o admin costuma liberar ANTES de o expedidor declarar CIF na bancada, e
      // esconder o item nesse momento o deixaria sem affordance e sem
      // explicacao. Os gates de CIF continuam nas duas rotas.
      ...(canAdminExpedicao && p.statusInterno === "EXPEDICAO"
        ? p.liberacaoRecotacao
          ? [
              { label: "Recotação já liberada", disabled: true, onClick: () => {} },
              {
                label: "Cancelar liberação",
                destructive: true,
                onClick: () => void handleCancelarLiberacao(p)
              }
            ]
          : [{ label: "Liberar recotação de frete", onClick: () => void handleLiberarRecotacao(p) }]
        : []),
      // Correcao de frete pos-liberacao: trocar a modalidade (e a transportadora)
      // de um pedido que ja saiu do orcamento. Fica ao lado da recotacao porque
      // as duas mexem no frete, mas sao coisas diferentes — aquela recota o
      // preco, esta corrige QUEM PAGA. Some quando a NF esta autorizada, o
      // despacho foi confirmado, o pedido foi entregue ou o status saiu da
      // faixa; a rota reconfere tudo isso no servidor.
      ...(podeCorrigirFrete(p)
        ? [{ label: "Corrigir frete", onClick: () => setCorrigirFreteId(p.idInt) }]
        : []),
      // Sem retorno definido a partir de PRODUCAO/ACABAMENTO no service (voltarStatus) — affordance morta.
      ...(canOperar && p.etapa !== "PRODUCAO" && p.etapa !== "ACABAMENTO"
        ? [{ label: "Voltar status", destructive: true, onClick: () => setPedidoVoltar(p) }]
        : []),
      // Encerrar pedido de teste: sai deste painel na hora. Só "Encerrar" aqui —
      // "Reabrir" mora em Orcamentos, onde o pedido marcado continua visivel com
      // badge; nesta lista ele ja nao existe mais.
      ...(canEncerrarTeste
        ? [{
            label: encerrandoTesteId === p.idInt ? "Encerrando teste..." : "Encerrar teste",
            destructive: true,
            onClick: () => void handleEncerrarTeste(p)
          }]
        : [])
    ];
  }

  const canView = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "expedicao.view");

  /**
   * Quem libera a recotacao de frete. A chave `expedicao.admin` ja existia no
   * catalogo de perfis e nao era usada em lugar nenhum — este e o uso dela.
   * Como `hasPermissao` cai em `isSuperAdmin || isAdmin` quando o usuario nao
   * tem permissoes resolvidas, a chave nao restringe quem ja e admin: ela
   * existe para poder delegar a liberacao sem dar admin geral do ERP.
   */
  const canAdminExpedicao = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "expedicao.admin");

  /**
   * Encerrar pedido de teste. Chave `propostas.release_producao`, a MESMA de
   * "Retirar da Producao" — mesma natureza, tirar pedido das listas
   * operacionais. Nao e `expedicao.admin`: a marcacao vale para todos os
   * paineis, nao so para este. Esconder o item nao protege nada (a RLS de
   * propostas e aberta); quem tranca e POST /api/pedidos/encerrar-teste.
   */
  const canEncerrarTeste = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "propostas.release_producao");

  /**
   * Corrigir o frete de um pedido já liberado. A MESMA chave que libera a edição
   * de proposta paga — decisão do dono, sem permissão nova. Esconder o item não
   * protege nada: quem tranca é `/api/expedicao/corrigir-frete`, que reconfere a
   * permissão no servidor a cada chamada, no `simular` e no `confirmar`.
   */
  const canCorrigirFrete = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "propostas.editar_paga");

  // As opcoes de destino do credito sao as MESMAS de Orcamentos, pelas MESMAS
  // chaves. O modal e o mesmo componente: divergir aqui daria a um operador da
  // Expedicao uma opcao que a mesma pessoa nao tem na proposta.
  const canBonificarCredito = Boolean(user?.isSuperAdmin || hasPermissao(user, "financeiro.bonificar"));
  const canDevolverCredito = Boolean(user?.isSuperAdmin || hasPermissao(user, "financeiro.devolver"));
  const canDebitoFuturo = Boolean(user?.isSuperAdmin || hasPermissao(user, "financeiro.debito_futuro"));

  /**
   * As MESMAS quatro barreiras da rota, avaliadas com o que o painel já tem em
   * memória — nenhuma consulta a mais, e nenhuma delas é inventada aqui:
   * `STATUS_CORRIGIVEIS` vem do próprio módulo que a rota usa.
   *
   * Isto é affordance, não segurança. O servidor reavalia tudo do zero no
   * `confirmar`, porque entre abrir o menu e clicar a NF pode ter sido
   * autorizada e o despacho pode ter sido confirmado — e aí a mensagem dele é
   * que aparece, inclusive a orientação de voltar um passo.
   */
  function podeCorrigirFrete(p: PedidoExpedicao) {
    if (!canCorrigirFrete) return false;
    if (p.nfStatus === "AUTORIZADA") return false;
    if (p.despachoConfirmado) return false;
    if (p.etapa === "ENTREGUE") return false;
    return STATUS_CORRIGIVEIS.includes(
      p.statusInterno.trim().toUpperCase() as (typeof STATUS_CORRIGIVEIS)[number]
    );
  }

  /**
   * Destino do crédito, pela MESMA rota que Orçamentos usa
   * (`/api/orcamentos/resolver-diferenca`) e sobre a pendência que a correção
   * acabou de abrir. Nenhuma regra financeira vive aqui.
   */
  async function handleDiferencaConfirm(acao: AcaoFinanceiraDiferenca) {
    if (!diferencaModal) return;
    const { getSupabaseClient } = await import("@/lib/supabase/client");
    const client = getSupabaseClient();
    const sessao = client ? await client.auth.getSession() : null;
    const token = sessao?.data?.session?.access_token ?? "";
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");

    const payload: Record<string, unknown> = {
      idPendencia: diferencaModal.idPendencia,
      idInt: diferencaModal.idInt,
      idCliente: diferencaModal.idCliente,
      acao: acao.tipo,
      valor: Math.abs(diferencaModal.diferenca),
      observacao: acao.obs
    };
    if (acao.tipo === "ABATER_DEBITO") {
      payload.idDebitoAlvo = acao.idDebitoAlvo;
      payload.valorAbatimento = acao.valorAbatimento;
    }

    const res = await fetch("/api/orcamentos/resolver-diferenca", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    const resultado = await res.json();
    if (!res.ok || !resultado.success) {
      throw new Error(resultado.error ?? "Erro ao registrar a resolução financeira.");
    }

    setDiferencaModal(null);
    showToast({
      type: "success",
      title: "Crédito resolvido",
      description: `#${diferencaModal.idInt}: destino do crédito registrado.`
    });
    void recarregar();
  }

  /** Correção gravada com crédito: a pendência existe, falta o destino. */
  function abrirDestinoDoCredito(p: PedidoExpedicao, res: RespostaConfirmacao) {
    setCorrigirFreteId(null);
    if (!res.pendenciaAtiva || p.idCliente === null) {
      // Não abrimos o modal com dados parciais — ele recusa sem pendência, e o
      // crédito já está registrado na Conta Corrente de qualquer forma.
      showToast({
        type: "info",
        title: "Correção gravada",
        description: `#${p.idInt}: o crédito ficou registrado na Conta Corrente do cliente.`
      });
      void recarregar();
      return;
    }
    setDiferencaModal({
      idInt: p.idInt,
      idCliente: p.idCliente,
      idPendencia: res.pendenciaAtiva.id,
      nomeCliente: p.clienteExibicao || p.cliente,
      valorPagoConfirmado: res.valorPagoConfirmado ?? 0,
      novoTotal: res.valorTotalNovo ?? 0,
      diferenca: res.diferenca ?? 0
    });
    void recarregar();
  }
  const [encerrandoTesteId, setEncerrandoTesteId] = useState<number | null>(null);

  // Filtros na URL — padrão docs/technical/PADRAO-FILTROS-URL-NAVEGACAO.md
  const filtrosSchema = useMemo(
    () => ({
      q: { codec: codecs.texto(), default: "" },
      etapa: { codec: codecs.texto(), default: ETAPA_INICIAL },
      frete: { codec: codecs.texto(), default: "TODOS" },
      emp: { codec: codecs.texto(), default: "TODOS" },
      // Visão: "transportadoras" (colunas kanban) ou "lista" (tabela/cards).
      // O KANBAN É O PADRÃO desde 01/09/2026 — ver VISAO_INICIAL.
      visao: { codec: codecs.texto(), default: VISAO_INICIAL }
    }),
    []
  );
  const { filters, setFilter, setFilters } = useUrlFilters(filtrosSchema);

  /**
   * O `frete` da URL, traduzido. Valor antigo ou torto NUNCA vira lista vazia:
   * o que tem equivalente e traduzido, o resto ABRE o filtro e a tela diz o que
   * aconteceu. A regra vive em `lib/filtro-categoria.ts`, testavel sem tela.
   */
  const filtroCategoria = useMemo(() => resolverFiltroCategoria(filters.frete), [filters.frete]);
  const avisoFiltro = avisoFiltroLegado(filtroCategoria);
  const [search, setSearch] = useDebouncedInput(filters.q, (valor) => setFilter("q", valor));

  async function recarregar() {
    const data = await listarPainelExpedicao();
    setPedidos(data);
    setIsLoaded(true);
  }

  useEffect(() => {
    void (async () => {
      await recarregar();
    })();
  }, []);

  // ---- contagens (sobre o conjunto todo, não o filtrado: cards são atalhos) ----
  const porEtapa = useMemo(() => {
    const contar = (etapas: EtapaExpedicao[]) => pedidos.filter((p) => etapas.includes(p.etapa)).length;
    return {
      // "Expedicao do dia" nao passa por `contar`: ele nao recorta etapa, e sim
      // promessa. Conta sobre o conjunto todo, como os demais.
      dia: pedidos.filter(ehExpedicaoDoDia).length,
      pronto: contar(["PRONTO"]),
      aRetirar: contar(["A_RETIRAR"]),
      emTransito: contar(["EM_TRANSITO"]),
      // Nao passa por `contar`: o cartao recorta por DATA DE ENTREGA, nao so
      // por etapa. Mesmo predicado que o clique aplica, logo abaixo.
      entregues: pedidos.filter(ehEntregueNoCard).length
    };
  }, [pedidos]);

  // ---- filtragem em memória ----
  /**
   * Tudo que passa pelo recorte atual MENOS o alerta: etapa, frete, empresa e
   * busca. É a base dos dois consumidores abaixo — a lista e os números dos
   * chips —, e é justamente por sair do alerta que ela serve aos dois: o chip
   * precisa saber quantos registros apareceriam SE fosse clicado, e o alerta
   * ativo não pode zerar a contagem dos outros três.
   */
  const filtrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pedidos.filter((p) => {
      if (filters.etapa === "ATIVOS" && p.etapa === "ENTREGUE") return false;
      // `DIA` e o unico filtro de card que NAO recorta etapa: ele recorta
      // promessa, e por isso atravessa o funil inteiro. Os demais continuam
      // casando 1 para 1 com `p.etapa`.
      if (filters.etapa === ETAPA_DIA && !ehExpedicaoDoDia(p)) return false;
      // ENTREGUE tambem nao casa 1 para 1 com a etapa: o cartao conta os dos
      // ultimos 7 dias, e o clique tem de abrir exatamente esse conjunto. Sem
      // esta linha a lista mostraria os 30 dias de exibicao e desmentiria o
      // numero que foi clicado.
      if (filters.etapa === "ENTREGUE" && !ehEntregueNoCard(p)) return false;
      if (
        filters.etapa !== "ATIVOS" &&
        filters.etapa !== "TODAS" &&
        filters.etapa !== ETAPA_DIA &&
        p.etapa !== filters.etapa
      )
        return false;

      // Categoria VIGENTE, ja resolvida no service (despacho vence a proposta).
      // `categoriaExibida` e o mesmo ponto unico que o kanban usa para mandar
      // nulo em EXTRAS — filtro e coluna nunca discordam.
      if (filtroCategoria.valor !== FILTRO_FRETE_TODOS && categoriaExibida(p.categoriaFrete) !== filtroCategoria.valor)
        return false;
      if (
        filters.emp !== "TODOS" &&
        p.empresa.toLowerCase().replace(/\s/g, "") !== filters.emp.toLowerCase().replace(/\s/g, "")
      )
        return false;

      if (q === "") return true;
      return (
        String(p.idInt).includes(q) ||
        /**
         * O CADASTRO TAMBÉM ACHA (02/09/2026).
         *
         * O card do Kanban exibe `cli 8469` em destaque, e é por esse número que
         * a bancada casa volume com cadastro — homônimos existem, o número não.
         * A busca não o alcançava.
         *
         * `includes`, e não igualdade, pelo mesmo critério que `idInt` já usa:
         * quem lembra só do começo do número acha assim.
         *
         * COLISÃO COM O NÚMERO DO PEDIDO: medida, e não existe hoje. As faixas
         * não se cruzam (pedidos 20481..21599, e nenhum cadastro do painel cai
         * nessa janela), nenhum `id_int` é igual a um `id_cliente`, e cruzando
         * TODOS os ids do painel como termo de busca o resultado foi zero
         * sobreposição. Digitar "8469" traz os 20 pedidos do cadastro e nenhum
         * pedido por número.
         */
        (p.idCliente !== null && String(p.idCliente).includes(q)) ||
        p.cliente.toLowerCase().includes(q) ||
        /**
         * A FANTASIA TAMBÉM ACHA (02/09/2026).
         *
         * O card do Kanban passou a exibir `clienteExibicao` — o nome fantasia —
         * enquanto a busca só casava `cliente`, a razão gravada na proposta.
         * Digitar o nome que estava na tela não achava nada em 4 dos 21
         * clientes com fantasia no painel: 8469 (DSEG IMPRESSOS × LISITON
         * DOCUMENTOS SEGUROS), 12460 (ARENA DO GREMIO × GREMIO FOOTBALL), 53193
         * (IMPACTO PRODUTORA × ANGELA BEATRIZ…) e 24957 (BOX SERVICE, onde só
         * um espaço difere).
         *
         * SOMA, não troca: a razão continua achando, e é por ela que se procura
         * um pedido a partir de nota fiscal ou contrato. Quando não há fantasia,
         * `clienteExibicao` é a própria razão e este termo não muda nada.
         *
         * Vale nas DUAS visões: este `filtrados` é único, e lista e Kanban
         * consomem o mesmo recorte.
         */
        p.clienteExibicao.toLowerCase().includes(q) ||
        p.codigoRastreamento.toLowerCase().includes(q) ||
        p.transportadoraNome.toLowerCase().includes(q)
      );
    });
  }, [pedidos, filters.etapa, filtroCategoria, filters.emp, search]);

  /**
   * Número de cada chip = tamanho exato da lista que clicar nele produz. Sai da
   * MESMA base da tabela e do MESMO predicado do filtro, então não há como
   * voltar a divergir.
   *
   * Os cards de etapa continuam contando sobre o conjunto todo, de propósito:
   * eles são a navegação do funil e precisam mostrar o que existe fora do
   * recorte atual. Os chips são o oposto — refinam o que já está na tela.
   */

  // Entregues ordenados por entrega mais recente quando o card Entregues está ativo.
  const listaExibida = useMemo(() => {
    if (filters.etapa !== "ENTREGUE") return filtrados;
    return [...filtrados].sort((a, b) =>
      (b.expedicao?.dataEntrega ?? "").localeCompare(a.expedicao?.dataEntrega ?? "")
    );
  }, [filtrados, filters.etapa]);

  const empresaOptions = useMemo(
    () => Array.from(new Set(pedidos.map((p) => p.empresa))).filter(Boolean).sort(),
    [pedidos]
  );

  // Desmarcar um card volta ao ponto de partida da tela, não à lista inteira.
  // Clicar no card já ativo de "Pronto p/ expedir" vira no-op de propósito: ele
  // É o estado inicial, então não há para onde "desmarcar".
  /**
   * Cards INDEPENDENTES (01/09/2026): clicar no card ativo nao desfaz mais o
   * filtro. Antes o segundo clique devolvia a `ETAPA_INICIAL`, e com cinco cards
   * cobrindo o funil inteiro esse desfazer so confundia — o expedidor clicava
   * duas vezes e a tela pulava para outro recorte. Voltar ao inicial agora e o
   * proprio card "Expedicao do dia" ou o "Limpar filtros".
   */
  function selecionarEtapa(etapa: string) {
    setFilter("etapa", etapa);
  }

  async function copiarRastreio(codigo: string) {
    try {
      await navigator.clipboard.writeText(codigo);
      showToast({ type: "success", title: "Rastreio copiado", description: codigo });
    } catch {
      showToast({ type: "error", title: "Não foi possível copiar", description: codigo });
    }
  }

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title="Acesso Negado"
          description="Você não tem permissão para visualizar a Expedição."
          icon={AlertCircle}
        />
      </div>
    );
  }

  const chipBase =
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition " +
    // Chip vazio não vira clique morto: `pointer-events-none` mata inclusive o
    // hover, então ele nem parece clicável.
    "disabled:pointer-events-none disabled:opacity-40";


  return (
    <div className="space-y-6 font-sans">
      {/* Navegação cruzada com a Fila Geral — mantida da tela anterior */}
      <div className="flex items-center gap-2 rounded-xl border border-slate-200/50 bg-white p-2.5 text-xs shadow-sm dark:border-slate-800/40 dark:bg-slate-900">
        <Link
          href="/pedidos"
          className="rounded-xl px-3.5 py-2 font-bold text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Voltar para Fila Geral (OS)
        </Link>
        <div className="rounded-xl bg-[#0b2f4a] px-3.5 py-2 font-bold text-white">Expedição e Logística</div>
      </div>

      <PageHeader
        title="Expedição"
        subtitle="Do acabamento à entrega: prontos, retiradas, trânsito e alertas de urgência."
        context="Logística"
        action={
          <button
            type="button"
            onClick={() => setTransportadorasAberto(true)}
            className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            <Building2 className="h-4 w-4" /> Transportadoras
          </button>
        }
      />

      {/* Cards do funil (clicáveis = filtro de etapa) */}
      {isLoaded && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {/* O card que abre a tela: o que tem de sair hoje — atrasado ou
              prometido para hoje —, em qualquer etapa do funil. Nao recorta
              etapa de proposito: pedido atrasado ainda na fabrica conta. */}
          <SummaryCard
            title="Expedição do dia"
            value={porEtapa.dia.toString()}
            description="Atrasados e prometidos hoje"
            tone="warning"
            icon={Clock}
            onClick={() => selecionarEtapa(ETAPA_DIA)}
            ativo={filters.etapa === ETAPA_DIA}
          />
          <SummaryCard
            title="Pronto p/ expedir"
            value={porEtapa.pronto.toString()}
            // Dois estados desde a Etapa 7 (02/09/2026): o que ainda vai ser
            // despachado e o que já foi e espera o carro — os dois seguem em
            // `EXPEDICAO`, então os dois contam aqui. "Aguardando despacho"
            // descrevia só o primeiro. Mesma forma enumerada do card do dia
            // ("Atrasados e prometidos hoje"). Título, contagem e critério
            // intocados.
            description="A despachar e aguardando coleta"
            tone="neutral"
            icon={PackageCheck}
            onClick={() => selecionarEtapa("PRONTO")}
            ativo={filters.etapa === "PRONTO"}
          />
          <SummaryCard
            title="A retirar"
            value={porEtapa.aRetirar.toString()}
            description="Cliente busca no balcão"
            tone="special"
            icon={MapPin}
            onClick={() => selecionarEtapa("A_RETIRAR")}
            ativo={filters.etapa === "A_RETIRAR"}
          />
          <SummaryCard
            title="Em trânsito"
            value={porEtapa.emTransito.toString()}
            description="Com a transportadora"
            tone="info"
            icon={Truck}
            onClick={() => selecionarEtapa("EM_TRANSITO")}
            ativo={filters.etapa === "EM_TRANSITO"}
          />
          <SummaryCard
            title="Entregues"
            value={porEtapa.entregues.toString()}
            /* Acompanha `DIAS_ENTREGUE_VISIVEL`, no service: e a MESMA janela,
               e ela decide quem entra no painel, nao so o que este numero soma. */
            description="Últimos 7 dias"
            tone="success"
            icon={CheckCircle2}
            onClick={() => selecionarEtapa("ENTREGUE")}
            ativo={filters.etapa === "ENTREGUE"}
          />
        </section>
      )}

      {/* Barra de VISAO. Os chips de alerta sairam em 01/09/2026 — os dois
          que filtravam (Atrasados, Prometidos hoje) viraram o card
          "Expedicao do dia", e "Ver funil ativo" saiu junto. Sobrou o
          alternador de visao, que NAO e filtro: e o unico caminho para o
          Kanban por transportadora. */}
      {isLoaded && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Troca de VISÃO (não é filtro): colunas por transportadora ⇄ tabela.
              O rótulo diz PARA ONDE leva, não onde se está — desde 01/09/2026 a
              página abre no Kanban, e um botão fixo em "Por transportadora"
              pareceria um filtro já aplicado em vez de um caminho de volta. */}
          <button
            type="button"
            onClick={() => setFilter("visao", filters.visao === "transportadoras" ? "lista" : "transportadoras")}
            className={`${chipBase} ${
              filters.visao === "transportadoras"
                ? "border-[#0b2f4a] bg-[#0b2f4a] text-white"
                : "border-dashed border-slate-400 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            {filters.visao === "transportadoras" ? "Ver em lista" : "Ver por transportadora"}
          </button>

          {/* Legenda das cores, à direita do alternador. Vale nas DUAS visões
              desde 02/09/2026: no Kanban explica o fundo do card, na lista
              explica o ponto de estado da coluna Status. Um componente só.
              As cores vêm de `FASES_CARD_KANBAN`, a mesma fonte que pinta o
              card e o ponto — não há como divergir do que está na tela.

              Largura reduzida: o container já é `flex-wrap`, então a legenda
              desce inteira para a linha de baixo em vez de espremer o botão.
              Cada item é `whitespace-nowrap`, então nenhum rótulo se parte no
              meio. */}
          <LegendaCoresKanban />
        </div>
      )}

      {/* Busca e filtros */}
      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-3 xl:grid-cols-[1fr_220px_220px_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none dark:text-slate-100"
              // Anuncia o que a busca de fato cobre: "cadastro" entrou em
              // 02/09/2026, junto com o `id_cliente`, e "cliente" agora vale
              // tanto para a razão quanto para o nome fantasia.
              placeholder="Buscar por nº do pedido, cadastro, cliente, rastreio ou transportadora..."
            />
          </label>

          {/* O `value` e o RESOLVIDO, nao o cru da URL: assim um link antigo
              abre o select em "Todos os fretes" em vez de exibir a primeira
              opcao enquanto filtra por outra coisa. */}
          <select
            value={filtroCategoria.valor}
            onChange={(e) => setFilter("frete", e.target.value)}
            className={filterClass}
          >
            <option value={FILTRO_FRETE_TODOS}>Todos os fretes</option>
            {CATEGORIAS_FRETE.map((c) => (
              <option key={c} value={c}>
                {LABEL_CATEGORIA_FRETE[c]}
              </option>
            ))}
          </select>

          <select value={filters.emp} onChange={(e) => setFilter("emp", e.target.value)} className={filterClass}>
            <option value="TODOS">Todas Empresas</option>
            {empresaOptions.map((option) => (
              <option key={option} value={option.toLowerCase().replace(/\s/g, "")}>
                {option}
              </option>
            ))}
          </select>

          <button
            type="button"
            // Limpar devolve ao ESTADO INICIAL da tela, não à lista inteira: o
            // ponto de partida é "Pronto p/ expedir". Busca, frete e empresa
            // continuam zerando como antes.
            onClick={() => {
              setFilters({ q: "", etapa: ETAPA_INICIAL, frete: "TODOS", emp: "TODOS", visao: VISAO_INICIAL });
              setSearch("");
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          >
            Limpar filtros
          </button>
        </div>

        {/* O aviso do link antigo. Existe porque traduzir em silencio e quase
            tao ruim quanto nao casar: quem abriu um favorito precisa saber por
            que a lista mudou. Some assim que o filtro e tocado. */}
        {avisoFiltro && (
          <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {avisoFiltro}
          </p>
        )}
      </section>

      {filters.visao === "transportadoras" ? (
        <KanbanTransportadoras
          pedidos={listaExibida}
          acaoPrimaria={acaoPrimaria}
          itensMenu={itensMenu}
          formatarPeso={formatarPeso}
          etapaFiltro={filters.etapa}
        />
      ) : (
      <ResponsiveList<PedidoExpedicao>
        items={listaExibida}
        getKey={(p) => p.idInt.toString()}
        isLoading={!isLoaded}
        emptyTitle="Nenhum pedido no recorte"
        emptyDescription="Ajuste os filtros ou confira se há pedidos aprovados para produção."
        getRowHighlight={(p) =>
          p.atrasadoDias > 0 && p.etapa !== "ENTREGUE"
            ? { base: "rgba(239,68,68,0.08)", hover: "rgba(239,68,68,0.15)" }
            : p.prometidoHoje
              ? { base: "rgba(245,158,11,0.10)", hover: "rgba(245,158,11,0.17)" }
              : null
        }
        columns={[
          {
            header: "Pedido",
            cell: (p) => (
              <div className="flex flex-col">
                <span className="font-semibold text-slate-950 dark:text-slate-100">#{p.idInt}</span>
                <span className="text-[11px] text-slate-500">{p.empresa}</span>
              </div>
            )
          },
          {
            header: "Cliente",
            cell: (p) => (
              <div className="flex max-w-[190px] flex-col">
                {/* FANTASIA desde 02/09/2026, com a razao no `title` — mesmo
                    criterio do card. O numero do cadastro continua prefixado,
                    e a busca casa razao, fantasia e id_cliente. */}
                <span
                  className="truncate font-medium text-slate-900 dark:text-slate-100"
                  title={rotuloClienteComNumero(p.idCliente, p.cliente)}
                >
                  {rotuloClienteComNumero(p.idCliente, p.clienteExibicao)}
                </span>
                {/* Pagador: quem paga e recebe o documento fiscal, quando nao e
                    o cliente do pedido. Entra ENTRE o nome e a cidade, com
                    rotulo e cor propria — sem o rotulo, leria como um segundo
                    nome do cliente. Sem pagador distinto, a coluna fica
                    exatamente como estava. */}
                {/* Sem o prefixo "Pagador:" desde 02/09/2026: quem separa esta
                    linha do nome do cliente e da cidade e a COR, exclusiva dela
                    na coluna. O prefixo fica no `title`. */}
                {p.pagador && (
                  <span className="truncate text-[11px] font-medium text-indigo-700" title={`Pagador: ${p.pagador}`}>
                    {p.pagador}
                  </span>
                )}
                {/* CIDADE DO ENDERECO DE ENTREGA (03/09/2026), nao a do cadastro.
                    Mesma correcao que o card recebeu em 60d771a, pela mesma
                    fonte: `idEnderecoEntregaVigente`, ja resolvida no pipeline.
                    Vinha de `p.cidadeUf` (`clientes.cidade_uf`), e nos 18
                    pedidos do 8469 dizia "Santa Cruz do Sul" enquanto o volume
                    ia para Santarem/PA e outras doze cidades.

                    Sem fallback para o cadastro, pelo mesmo motivo do card:
                    cair nele reintroduz o erro. Medido em 03/09: ZERO pedidos
                    do painel ficam sem a linha. */}
                {p.enderecoEntrega?.cidadeUf && (
                  <span className="text-[11px] text-slate-500" title={p.enderecoEntrega.rotulo}>
                    {p.enderecoEntrega.cidadeUf}
                  </span>
                )}
              </div>
            )
          },
          {
            header: "Vendedor",
            cell: (p) =>
              p.vendedor ? (
                <span
                  className="block max-w-[140px] truncate text-sm text-slate-700 dark:text-slate-300"
                  title={p.vendedor}
                >
                  {p.vendedor}
                </span>
              ) : (
                <span className="text-xs italic text-slate-400">—</span>
              )
          },
          {
            header: "Status",
            // O PONTO diz o ESTADO do volume; o badge diz o status oficial; o
            // fundo da linha diz a URGENCIA. Tres eixos, tres lugares — nenhum
            // disputa o outro. O ponto le `faseDoCard`, a mesma fonte do card.
            cell: (p) => (
              <span className="inline-flex items-center gap-2">
                <PontoEstadoKanban pedido={p} />
                <StatusBadge status={p.statusInterno} />
              </span>
            )
          },
          {
            header: "Promessa",
            cell: (p) => {
              const ehAtrasado = p.atrasadoDias > 0 && p.etapa !== "ENTREGUE";
              return (
                <div className="flex flex-col gap-1">
                  <span
                    className={`text-sm font-semibold ${
                      ehAtrasado ? "text-red-600" : p.prometidoHoje ? "text-amber-600" : "text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    {formatarPromessa(p.dataPromessa)}
                  </span>
                  {ehAtrasado && (
                    <span className="inline-flex w-fit items-center rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-black text-white">
                      ATRASADO {p.atrasadoDias}d
                    </span>
                  )}
                  {p.prometidoHoje && (
                    <span className="inline-flex w-fit items-center rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-white">
                      HOJE
                    </span>
                  )}
                </div>
              );
            }
          },
          {
            header: "Frete",
            cell: (p) => {
              const Icone = ICONE_TIPO_FRETE[p.tipoFrete];
              return (
                <div className="flex flex-col gap-0.5 text-sm">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                    <Icone className="h-3.5 w-3.5 shrink-0" />
                    {p.rotuloTransporte}
                  </span>
                  {/* Valor ao lado de peso e volumes. `freteCobrado` e
                      `propostas.valor_frete`, o que a proposta COBRA — nulo e
                      zero nao viram "R$ 0,00", que leria como cobranca de zero
                      em vez de "nao se aplica". Mesma regra do card. */}
                  <span className="text-[11px] text-slate-500">
                    {formatarPeso(p)}
                    {p.volumes !== null ? ` · ${p.volumes} vol` : ""}
                    {p.freteCobrado !== null && p.freteCobrado > 0
                      ? ` · ${formatCurrency(p.freteCobrado)}`
                      : ""}
                  </span>
                </div>
              );
            }
          },
          {
            header: "NF",
            cell: (p) =>
              p.nfStatus === "AUTORIZADA" ? (
                <div className="flex flex-col gap-0.5">
                  <StatusBadge status="AUTORIZADA" />
                  {p.nfNumero && <span className="text-[10px] text-slate-500">NF {p.nfNumero}</span>}
                </div>
              ) : p.nfStatus === "PENDENTE" ? (
                <StatusBadge status="PENDENTE" />
              ) : ["PRONTO", "A_RETIRAR", "EM_TRANSITO"].includes(p.etapa) ? (
                <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
                  SEM NF
                </span>
              ) : (
                <span className="text-xs text-slate-400">—</span>
              )
          },
          {
            header: "Rastreio",
            cell: (p) =>
              p.codigoRastreamento ? (
                <button
                  type="button"
                  onClick={() => void copiarRastreio(p.codigoRastreamento)}
                  className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                  title="Copiar código"
                >
                  {p.codigoRastreamento}
                  <Copy className="h-3 w-3" />
                </button>
              ) : (
                <span className="text-xs italic text-slate-400">—</span>
              )
          },
          {
            header: "Ações",
            align: "right",
            cell: (p) => {
              const ocupado = salvandoAcao === p.idInt;
              const primario = acaoPrimaria(p);
              const acoesMenu = itensMenu(p);

              return (
                <div className="flex items-center justify-end gap-1.5">
                  {primario && (
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={primario.acao}
                      className="rounded-2xl bg-[#0b2f4a] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#123f61] disabled:opacity-50"
                    >
                      {primario.rotulo}
                    </button>
                  )}
                  <ActionsMenu items={acoesMenu} />
                </div>
              );
            }
          }
        ]}
        renderCard={(p) => {
          const ehAtrasado = p.atrasadoDias > 0 && p.etapa !== "ENTREGUE";
          const Icone = ICONE_TIPO_FRETE[p.tipoFrete];
          const ocupado = salvandoAcao === p.idInt;
          const primario = acaoPrimaria(p);
          const acoesMenu = itensMenu(p);
          return (
            <article
              key={p.idInt}
              className={`rounded-3xl border bg-white p-5 shadow-sm dark:bg-slate-900 ${
                ehAtrasado
                  ? "border-red-300 dark:border-red-900"
                  : p.prometidoHoje
                    ? "border-amber-300 dark:border-amber-900"
                    : "border-[#d7e5e8] dark:border-slate-800"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    #{p.idInt} · {p.empresa}
                  </p>
                  <h3 className="mt-1 font-semibold text-slate-950 dark:text-slate-100" title={p.cliente}>
                    {rotuloClienteComNumero(p.idCliente, p.clienteExibicao)}
                  </h3>
                  {/* Mesma leitura do desktop: pagador entre o nome e a cidade. */}
                  {p.pagador && (
                    <p className="text-xs font-medium text-indigo-700" title={`Pagador: ${p.pagador}`}>
                      {p.pagador}
                    </p>
                  )}
                  {/* Mesma fonte do desktop: a cidade de ENTREGA. */}
                  {p.enderecoEntrega?.cidadeUf && (
                    <p className="text-xs text-slate-500" title={p.enderecoEntrega.rotulo}>
                      {p.enderecoEntrega.cidadeUf}
                    </p>
                  )}
                  {p.vendedor && <p className="text-xs text-slate-500">Vendedor: {p.vendedor}</p>}
                </div>
                <StatusBadge status={p.statusInterno} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {ehAtrasado && (
                  <span className="rounded-full bg-red-600 px-2 py-0.5 font-black text-white">
                    ATRASADO {p.atrasadoDias}d
                  </span>
                )}
                {p.prometidoHoje && (
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 font-black text-white">HOJE</span>
                )}
                {["PRONTO", "A_RETIRAR", "EM_TRANSITO"].includes(p.etapa) && p.nfStatus !== "AUTORIZADA" && (
                  <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-bold text-red-700">
                    SEM NF
                  </span>
                )}
                {p.nfStatus === "AUTORIZADA" && p.nfNumero && (
                  <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 font-bold text-teal-700 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-300">
                    NF {p.nfNumero}
                  </span>
                )}
              </div>
              <div className="mt-3 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                <p className="inline-flex items-center gap-1.5">
                  <Icone className="h-3.5 w-3.5" />
                  {p.tipoFrete === "INDEFINIDO" && p.rotuloTransporte === "A definir" ? "Frete a definir" : p.rotuloTransporte}
                </p>
                <p>
                  Promessa: <strong>{formatarPromessa(p.dataPromessa)}</strong>
                </p>
                <p>
                  {formatarPeso(p)}
                  {p.volumes !== null ? ` · ${p.volumes} vol` : ""}
                </p>
                {p.codigoRastreamento && (
                  <button
                    type="button"
                    onClick={() => void copiarRastreio(p.codigoRastreamento)}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                  >
                    {p.codigoRastreamento}
                    <Copy className="h-3 w-3" />
                  </button>
                )}
              </div>
              <div className="mt-4 flex items-center justify-end gap-1.5">
                {primario && (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={primario.acao}
                    className="rounded-2xl bg-[#0b2f4a] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#123f61] disabled:opacity-50"
                  >
                    {primario.rotulo}
                  </button>
                )}
                <ActionsMenu items={acoesMenu} />
              </div>
            </article>
          );
        }}
      />
      )}

      {pedidoDespacho && (
        <DespacharModal
          pedido={pedidoDespacho.pedido}
          modoEdicao={pedidoDespacho.modo === "EDICAO"}
          ator={atorAtual()}
          onClose={() => setPedidoDespacho(null)}
          onDone={() => { setPedidoDespacho(null); void recarregar(); }}
        />
      )}
      {pedidoRetirada && (
        <RetiradaModal
          pedido={pedidoRetirada}
          ator={atorAtual()}
          onClose={() => setPedidoRetirada(null)}
          onDone={() => { setPedidoRetirada(null); void recarregar(); }}
        />
      )}
      {pedidoVoltar && (
        <VoltarStatusModal
          pedido={pedidoVoltar}
          ator={atorAtual()}
          onClose={() => setPedidoVoltar(null)}
          onDone={() => { setPedidoVoltar(null); void recarregar(); }}
        />
      )}
      {pedidoCorrigirFrete && (
        <CorrigirFreteModal
          /* A `key` carrega o que ESTÁ GRAVADO. Se o pedido for recarregado com
             outra modalidade enquanto o modal está aberto, ele remonta e os
             campos renascem do valor novo — em vez de o `useState` guardar a
             escolha antiga por baixo de um cabeçalho já atualizado. */
          key={`${pedidoCorrigirFrete.idInt}|${pedidoCorrigirFrete.modalidadeOrcamento ?? ""}|${pedidoCorrigirFrete.idTransportadoraOrcamento ?? ""}`}
          pedido={pedidoCorrigirFrete}
          onClose={() => setCorrigirFreteId(null)}
          onDone={(mensagem) => {
            const id = pedidoCorrigirFrete.idInt;
            setCorrigirFreteId(null);
            showToast({ type: "success", title: `Frete corrigido em #${id}`, description: mensagem });
            void recarregar();
          }}
          onCreditoAberto={(res) => abrirDestinoDoCredito(pedidoCorrigirFrete, res)}
        />
      )}
      {diferencaModal && (
        <DiferencaFinanceiraModal
          isOpen
          onConfirm={handleDiferencaConfirm}
          onClose={() => setDiferencaModal(null)}
          idInt={diferencaModal.idInt}
          idCliente={diferencaModal.idCliente}
          idPendencia={diferencaModal.idPendencia}
          nomeCliente={diferencaModal.nomeCliente}
          valorPagoConfirmado={diferencaModal.valorPagoConfirmado}
          novoTotal={diferencaModal.novoTotal}
          diferenca={diferencaModal.diferenca}
          canBonificar={canBonificarCredito}
          canDevolver={canDevolverCredito}
          canDebitoFuturo={canDebitoFuturo}
        />
      )}
      {pedidoRastreio && (
        <RastreioModal
          pedido={pedidoRastreio}
          permitirMarcarEntregue={canOperar}
          onClose={() => setPedidoRastreio(null)}
          /* Passa pela MESMA confirmacao do botao primario. Antes ia direto ao
             `handleMarcarEntregue`, e por ali o aviso nunca apareceria — dois
             caminhos para a mesma acao, um deles sem a informacao. */
          onMarcarEntregue={() => {
            const alvo = pedidoRastreio;
            setPedidoRastreio(null);
            pedirConfirmacaoDeEntrega(alvo, Date.now());
          }}
        />
      )}
      {confirmacao && (
        <ConfirmarAcaoModal
          titulo={
            confirmacao.tipo === "PRONTO"
              ? "Marcar como pronto"
              : confirmacao.tipo === "COLETA"
                ? "Confirmar coleta"
                : "Confirmar entrega"
          }
          descricao={
            confirmacao.tipo === "PRONTO"
              ? `O pedido #${confirmacao.pedido.idInt} (${confirmacao.pedido.cliente}) vai para a bancada da expedição, aguardando despacho.`
              : confirmacao.tipo === "COLETA"
                ? `A transportadora levou o volume do pedido #${confirmacao.pedido.idInt} (${confirmacao.pedido.cliente}). Ele passa a EM TRANSITO.`
                : `O pedido #${confirmacao.pedido.idInt} (${confirmacao.pedido.cliente}) será concluído como ENTREGUE.`
          }
          detalhe={
            confirmacao.tipo === "ENTREGUE" ? (
              <>
                {/* O aviso vem PRIMEIRO e destacado: e a informacao nova. A
                    frase de sempre continua abaixo, sem competir com ela. */}
                {confirmacao.aviso && (
                  <span className="mb-2 block rounded-xl border border-amber-300 bg-amber-50 p-3 font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    {confirmacao.aviso}
                  </span>
                )}
                Último passo do fluxo. Para desfazer depois é preciso usar Voltar status, com motivo.
              </>
            ) : undefined
          }
          rotuloConfirmar={
            confirmacao.tipo === "PRONTO"
              ? "Marcar pronto"
              : confirmacao.tipo === "COLETA"
                ? "Confirmar coleta"
                : "Confirmar entrega"
          }
          salvando={salvandoAcao === confirmacao.pedido.idInt}
          onClose={() => setConfirmacao(null)}
          onConfirmar={() => {
            const { pedido, tipo } = confirmacao;
            setConfirmacao(null);
            if (tipo === "PRONTO") void handleMarcarPronto(pedido);
            else if (tipo === "COLETA") void handleConfirmarColeta(pedido);
            else void handleMarcarEntregue(pedido);
          }}
        />
      )}
      {transportadorasAberto && <TransportadorasModal onClose={() => setTransportadorasAberto(false)} />}
    </div>
  );
}
