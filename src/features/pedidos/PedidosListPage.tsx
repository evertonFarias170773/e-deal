"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useGlobalChat } from "@/features/chat/context/GlobalChatContext";
import { StatusBadge } from "@/components/common/StatusBadge";
import { formatCurrency } from "@/lib/formatters/currency";
import { formatDateTime } from "@/lib/formatters/date";
import { Search, Plus, Edit, FileText, Clipboard, MessageSquare, AlertCircle, HardHat } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { SummaryCard } from "@/components/common/SummaryCard";
import { ActionsMenu } from "@/components/common/ActionsMenu";
import { EmptyState } from "@/components/common/EmptyState";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { useAppToast } from "@/components/common/AppToast";
import { codecs } from "@/lib/url-state";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebouncedInput } from "@/hooks/useDebouncedValue";
import { listarPedidosOperacionais } from "./services/pedidos-producao.service";
import { atualizarFaseSetor } from "./services/boletim-setores.service";
import { consolidarFases, type FaseSetor } from "./status-setor";
import { SetorFaseChip } from "./components/SetorFaseChip";
import { abrirPdfOs, type LayoutPdfOs } from "./services/imprimir-os.client";
import { encerrarTeste } from "./services/encerrar-teste.client";
import { getSupabaseClient } from "@/lib/supabase/client";
import { devolverPropostaParaRevisaoAtendente } from "@/features/orcamentos/services/orcamentos.service";
import { DevolverRevisaoModal } from "./components/DevolverRevisaoModal";
import { criarPedidoParaBoletim } from "./services/boletim-propostas.service";
import { dataLimitePorPrazosOuNulo } from "./prazo-producao";

import type { PropostaOperacionalListItem, SetorDoPedido } from "./types";
import { useRouter } from "next/navigation";

const filterClass = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none";

/**
 * Pedido que AINDA NAO ENTROU na fabrica: esperando o gerente revisar e liberar.
 *
 * E a fila que trava o fluxo desta tela, e por isso ganha o topo da lista e um
 * fundo proprio — o status sozinho, num badge no meio de dezenas de linhas
 * iguais, passava batido. Mesmo tratamento que "REVISAO ATENDENTE" recebe na
 * lista de Orcamentos.
 *
 * Compara normalizado porque `status_interno` chega da lista ja passado por
 * `composeStatusEmArte`. Na pratica esse status nunca ganha o sufixo " / EM
 * ARTE" (so NOVO, AGUARDANDO e LIBERADO ganham), mas comparar cru dependeria
 * disso continuar verdade.
 */
function ehRevisaoProducao(item: PropostaOperacionalListItem): boolean {
  return String(item.status_interno ?? "").trim().toUpperCase() === "REVISAO PRODUCAO";
}

/**
 * Amarelo de atencao da linha em revisao de producao. `amber-50` e `amber-100`,
 * o par de atencao ja usado no sistema (amber-50 e o tom mais frequente da base)
 * — nenhuma cor nova.
 *
 * Vai em `style` inline porque e o contrato do `getRowHighlight` do
 * ResponsiveList: o hover da linha tambem e inline e venceria qualquer classe,
 * apagando o destaque assim que o mouse saisse.
 *
 * Tom claro de proposito: o texto (`--foreground`) e os badges de setor, que tem
 * fundo proprio, seguem legiveis por cima sem precisar de ajuste.
 */
const DESTAQUE_REVISAO_PRODUCAO = { base: "#fffbeb", hover: "#fef3c7" };

export function PedidosListPage() {
  const { openChat } = useGlobalChat();
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const router = useRouter();
  
  const [pedidos, setPedidos] = useState<PropostaOperacionalListItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDevolverModalOpen, setIsDevolverModalOpen] = useState(false);
  const [selectedPropostaForDevolver, setSelectedPropostaForDevolver] = useState<PropostaOperacionalListItem | null>(null);
  const [isDevolverSubmitting, setIsDevolverSubmitting] = useState(false);
  /** Chave `id_int:SETOR` do chip que está gravando — trava só aquele chip. */
  const [salvandoSetor, setSalvandoSetor] = useState<string | null>(null);

  // Autorização (V2.1 + Legado V1)
  const canView = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.view");
  const canPrintOS = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.print_os");

  /**
   * Encerrar pedido de teste. Mesma permissão de "Retirar da Produção"
   * (`propostas.release_producao`) — mesma natureza: tirar pedido das listas
   * operacionais. Aqui só existe o "Encerrar": o pedido marcado sai desta lista
   * na hora, então "Reabrir" mora em Orçamentos, onde ele continua visível com
   * badge. Esconder o item não protege nada (a RLS de propostas é aberta): quem
   * tranca é POST /api/pedidos/encerrar-teste.
   */
  const canEncerrarTeste = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "propostas.release_producao");
  const [encerrandoTesteId, setEncerrandoTesteId] = useState<number | null>(null);
  async function handleEncerrarTeste(proposta: PropostaOperacionalListItem) {
    if (encerrandoTesteId !== null) return;
    const ok = window.confirm(
      `Encerrar o pedido #${proposta.id_int} como TESTE?\n\n` +
        `Ele sai do painel de Produção, do Kanban, da fila de impressão e da Expedição.\n` +
        `Continua acessível por busca e por URL, e segue contando no faturamento.\n\n` +
        `Para reabrir, use o menu Ações em Orçamentos.`
    );
    if (!ok) return;
    setEncerrandoTesteId(proposta.id_int);
    try {
      const res = await encerrarTeste(proposta.id_int);
      if (res.success) {
        showToast({
          type: "success",
          title: res.idempotente ? "Pedido já estava encerrado" : "Teste encerrado",
          description: `#${proposta.id_int} saiu das listas operacionais. Reabra em Orçamentos, se precisar.`
        });
        await load();
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

  // Rotação do QR público da OS (permissão específica; invalida o QR impresso anterior)
  const canRotateQr = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.qr_rotacionar");
  const [rotacionandoQrId, setRotacionandoQrId] = useState<number | null>(null);
  async function handleRotacionarQr(proposta: PropostaOperacionalListItem) {
    if (rotacionandoQrId !== null) return;
    setRotacionandoQrId(proposta.id_int);
    try {
      const client = getSupabaseClient();
      const session = client ? (await client.auth.getSession()).data.session : null;
      const accessToken = session?.access_token;
      if (!accessToken) {
        showToast({ type: "error", title: "Sessão expirada", description: "Faça login novamente." });
        return;
      }
      const res = await fetch("/api/pedidos/os-qr/rotacionar", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ id_int: proposta.id_int })
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success) {
        showToast({ type: "success", title: "Novo QR gerado", description: data.message });
      } else {
        showToast({ type: "error", title: "Erro ao gerar novo QR", description: data?.message || `Falha (HTTP ${res.status}).` });
      }
    } catch (err: any) {
      showToast({ type: "error", title: "Erro ao gerar novo QR", description: err?.message || "Erro desconhecido." });
    } finally {
      setRotacionandoQrId(null);
    }
  }

  // Impressão da OS em PDF (uma por vez; erros via toast)
  const [printingOsId, setPrintingOsId] = useState<number | null>(null);
  /**
   * `layout` decide qual PDF sai; TODO o resto do caminho e o mesmo — inclusive
   * a criacao da OS que falta e a revalidacao do servidor. E o que mantem o
   * reduzido se comportando igual ao padrao neste ponto.
   */
  async function handleImprimirOS(proposta: PropostaOperacionalListItem, layout: LayoutPdfOs = "completo") {
    if (printingOsId !== null) return;
    setPrintingOsId(proposta.id_int);

    /**
     * Sem o pedido pai em `propostas_os` a rota do PDF responde 404, e até hoje
     * a única saída era abrir o boletim e salvar só para destravar a impressão.
     * Aqui ele nasce no mesmo clique, com o que dá para derivar da proposta.
     *
     * `criarPedidoParaBoletim` é idempotente (OS existente volta como sucesso),
     * mas continua atrás do `hasPedidoOs`: ela revalida `status_interno` contra
     * BOLETIM_ELIGIBLE_STATUSES, e chamar sempre quebraria a impressão de
     * pedido já entregue/faturado — que hoje funciona.
     *
     * O PRAZO PASSOU A SER DERIVÁVEL (30/08/2026). Ele saía nulo aqui, e a OS
     * nascia sem promessa: a coluna DATA ENTREGA ficava vazia até alguém abrir o
     * boletim. Agora vem da MESMA regra que o boletim usa — `prazo-producao.ts`,
     * extraído de `BoletimFormPage` justamente para os dois compartilharem uma
     * conta só, sem duplicar o regex nem a regra de dias úteis. Os textos de
     * `produtos.prazo` chegam na própria linha da lista, do SELECT em lote que
     * já existia: nenhuma consulta a mais por clique.
     *
     * `dataLimitePorPrazosOuNulo`, e não `dataLimitePorPrazos`: sem prazo legível
     * em nenhum item, grava NULL. O `hoje + 7` da irmã é o default do formulário,
     * que o operador vê e corrige antes de salvar — aqui não há ninguém para
     * conferir, e ele viraria promessa inventada.
     *
     * Segue sem preencher o que continua não sendo derivável: o boletim de setor
     * (`propostas_os_setores`) e as orientações (`obs`). O PDF sai sem filtro de
     * setor e com os blocos de orientação vazios — isso o boletim preenche depois.
     */
    if (!proposta.hasPedidoOs) {
      const criacao = await criarPedidoParaBoletim({
        id_int: proposta.id_int,
        descricao: `${proposta.clienteNome} - Boletim de entrada`,
        obs: null,
        data_termino: dataLimitePorPrazosOuNulo(proposta.prazosDosProdutos) ?? undefined
      });
      if (!criacao.success) {
        setPrintingOsId(null);
        showToast({
          type: "error",
          title: "Não foi possível abrir a OS para impressão",
          description: criacao.error || "Erro desconhecido ao criar o pedido."
        });
        return;
      }
      // A linha da lista ainda diz "sem OS": recarrega para o rótulo do menu e o
      // `hasPedidoOs` refletirem o pedido recém-criado.
      void load();
    }

    const result = await abrirPdfOs(proposta.id_int, null, null, layout);
    setPrintingOsId(null);
    if (!result.success) {
      showToast({
        type: "error",
        title: "Erro ao gerar PDF da OS",
        description: result.errorMessage || "Erro desconhecido."
      });
    } else {
      // Mesmo aviso do boletim, mesma razão: `abrirPdfOs` volta assim que a aba
      // abre e o PDF ainda está sendo montado do outro lado. Sem isto o
      // `printingOsId` pisca por milissegundos e a aba nova fica em branco, sem
      // nada dizendo que há trabalho em curso.
      showToast({
        type: "info",
        title: "Gerando o PDF na nova aba",
        description: "A OS abre assim que ficar pronta. Na primeira impressão do dia costuma demorar mais."
      });
    }
  }

  async function load() {
    setIsLoaded(false);
    const data = await listarPedidosOperacionais();
    setPedidos(data);
    setIsLoaded(true);
  }

  useEffect(() => {
    void load();
  }, []);

  // Filtros da tela na URL: sobrevivem a atualizar a página, sair e voltar, ao
  // histórico do navegador e a um link copiado. A filtragem é em memória sobre a
  // lista já carregada — nada aqui muda a consulta.
  // Padrão oficial: docs/technical/PADRAO-FILTROS-URL-NAVEGACAO.md
  const filtrosSchema = useMemo(
    () => ({
      q: { codec: codecs.texto(), default: "" },
      status: { codec: codecs.texto(), default: "TODOS" },
      vend: { codec: codecs.texto(), default: "TODOS" },
      emp: { codec: codecs.texto(), default: "TODOS" }
    }),
    []
  );

  // Sem pageKey: esta tela não tem paginação.
  const { filters, setFilter, setFilters } = useUrlFilters(filtrosSchema);

  // Nomes locais preservados: o restante da tela continua lendo estas variáveis.
  const filterStatus = filters.status;
  const filterVendedor = filters.vend;
  const filterEmpresa = filters.emp;

  // A filtragem é em memória, então continua respondendo a cada tecla; o que
  // espera a pausa é apenas a gravação na URL.
  const [search, setSearch] = useDebouncedInput(filters.q, (valor) => setFilter("q", valor));

  const getStatusTone = (status: string) => {
    if (status === "BOLETIM_FINALIZADO") return "info";
    if (status === "APROVADO") return "success";
    if (status === "PENDENTE") return "warning";
    if (status === "BLOQUEADO") return "danger";
    if (status === "NOVO") return "info";
    if (status === "ARTE_EM_ANDAMENTO") return "info";
    if (status === "AGUARDANDO_APROVACAO_CLIENTE" || status === "AGUARDANDO_APROVACAO_ATENDENTE") return "warning";
    if (status === "AGUARDANDO_OS") return "special";
    if (status === "EM IMPRESSAO / PENDENTE" || status === "EM ACABAMENTO / PENDENTE") return "warning";
    if (status === "EM PRODUCAO" || status === "EM IMPRESSAO" || status === "EM ACABAMENTO" || status === "REVISAO") return "info";
    if (status === "PRONTO_EXPEDICAO" || status === "EXPEDIDO" || status === "A RETIRAR" || status === "ENTREGUE") return "success";
    return "neutral";
  };

  const isPedidoBloqueado = (p: PropostaOperacionalListItem) => {
    return p.financialBlock || Boolean(p.blockReason) || p.status_producao === "BLOQUEADO" || p.status_expedicao === "BLOQUEADO";
  };

  // Filter calculations
  const totalCount = pedidos.length;
  const atrasadosCount = 0; // Removido nesta fase pois dataPrevistaEntrega (data_termino) era do propostas_os. Fica para a próxima fase.
  const emImpressaoCount = pedidos.filter(p => p.status_interno === "EM IMPRESSAO").length;
  const emRevisaoCount = pedidos.filter(p => p.status_interno === "REVISAO PRODUCAO").length;
  const emAcabamentoCount = pedidos.filter(p => p.status_interno === "EM ACABAMENTO").length;

  // Os cards de fase são atalhos para o filtro de Status que já existe: card e
  // select compartilham o mesmo estado, então clicar num deles reflete no outro.
  // "Total de OS" é o estado sem recorte de fase — por isso volta o status para
  // "TODOS" e fica ativo enquanto nenhuma das três fases estiver selecionada.
  const STATUS_DOS_CARDS: string[] = ["EM IMPRESSAO", "REVISAO PRODUCAO", "EM ACABAMENTO"];
  const nenhumaFaseSelecionada = !STATUS_DOS_CARDS.includes(filterStatus);

  // Filter logic
  const filteredPedidos = pedidos.filter((p) => {
    const matchesSearch =
      search === "" ||
      p.clienteNome.toLowerCase().includes(search.toLowerCase()) ||
      String(p.id_int).includes(search) ||
      p.vendedor.toLowerCase().includes(search.toLowerCase()) ||
      p.empresa.toLowerCase().includes(search.toLowerCase());

    const matchesStatus = filterStatus === "TODOS" || (p.status_interno || p.statusPedido || "") === filterStatus;
    const matchesVendedor = filterVendedor === "TODOS" || p.vendedor === filterVendedor;
    const matchesEmpresa = filterEmpresa === "TODOS" || p.empresa.toLowerCase().replace(" ", "") === filterEmpresa.toLowerCase().replace(" ", "");

    return matchesSearch && matchesStatus && matchesVendedor && matchesEmpresa;
  })
    /**
     * REVISAO PRODUCAO sobe para o topo. O criterio de desempate e a ORDEM QUE JA
     * ESTAVA: `Array.prototype.sort` e estavel, entao ordenar apenas pelo grupo
     * preserva, dentro de cada um, o `id_int desc` que o servidor entregou.
     * Nenhum segundo criterio foi inventado aqui.
     *
     * Nao ha ordenacao por coluna nesta tela (o ResponsiveList nao oferece), e a
     * consulta nao pagina — traz o funil inteiro —, entao o agrupamento vale
     * sobre a lista toda, e nao so sobre uma pagina.
     */
    .sort((a, b) => Number(ehRevisaoProducao(b)) - Number(ehRevisaoProducao(a)));

  // Derived options for filters
  const statusOptions = Array.from(new Set(pedidos.map(p => p.status_interno || p.statusPedido || ""))).filter(Boolean).sort();
  const vendedorOptions = Array.from(new Set(pedidos.map(p => p.vendedor))).filter(Boolean).sort();
  const empresaOptions = Array.from(new Set(pedidos.map(p => p.empresa))).filter(Boolean).sort();

  /**
   * A ação "Liberar para NF" saiu daqui em 20/08/2026. A entrada na Fila de
   * Faturamento passou a acontecer junto da liberação para produção, na revisão
   * do atendente (`liberarPropostaParaProducao`), que é onde a decisão de fato
   * é tomada. O selo "Liberado para NF" continua nesta tela — agora só mostra o
   * que a liberação já resolveu.
   */

  async function confirmDevolverRevisao() {
    if (!selectedPropostaForDevolver) return;

    setIsDevolverSubmitting(true);
    showToast({
      type: "info",
      title: "Devolvendo proposta...",
      description: "Aguarde a atualização."
    });

    try {
      const res = await devolverPropostaParaRevisaoAtendente(selectedPropostaForDevolver.id_int);
      if (res.success) {
        showToast({
          type: "success",
          title: "Proposta devolvida",
          description: "A proposta voltou para Revisão Atendente."
        });
        setIsDevolverModalOpen(false);
        setSelectedPropostaForDevolver(null);
        void load();
      } else {
        throw new Error(res.errorMessage || "Erro desconhecido.");
      }
    } catch (err) {
      console.error("[PedidosListPage] Error returning to revision:", err);
      showToast({
        type: "error",
        title: "Erro",
        description: err instanceof Error ? err.message : "Não foi possível devolver a proposta."
      });
    } finally {
      setIsDevolverSubmitting(false);
    }
  }

  /**
   * Move a fase de UM setor. O status do pedido é consequência: o service
   * espelha nele a fase do setor menos adiantado e devolve o valor gravado.
   */
  async function handleFaseSetorChange(
    proposta: PropostaOperacionalListItem,
    setor: SetorDoPedido,
    novaFase: FaseSetor
  ) {
    if (!setor.boletimId || setor.fase === novaFase) return;

    const chave = `${proposta.id_int}:${setor.setor}`;
    const faseAnterior = setor.fase;
    const statusAnterior = proposta.status_interno;

    setSalvandoSetor(chave);
    setPedidos((current) =>
      current.map((p) =>
        p.id_int === proposta.id_int
          ? { ...p, setores: (p.setores ?? []).map((s) => (s.setor === setor.setor ? { ...s, fase: novaFase } : s)) }
          : p
      )
    );

    const res = await atualizarFaseSetor(
      proposta.id_int,
      setor.boletimId,
      setor.setor,
      novaFase,
      faseAnterior
    );
    setSalvandoSetor(null);

    if (!res.success) {
      showToast({ type: "error", title: "Erro", description: res.error || "Erro ao atualizar a fase do setor." });
      setPedidos((current) =>
        current.map((p) =>
          p.id_int === proposta.id_int
            ? {
                ...p,
                status_interno: statusAnterior,
                setores: (p.setores ?? []).map((s) => (s.setor === setor.setor ? { ...s, fase: faseAnterior } : s))
              }
            : p
        )
      );
      return;
    }

    if (res.statusInterno) {
      setPedidos((current) =>
        current.map((p) => (p.id_int === proposta.id_int ? { ...p, status_interno: res.statusInterno as string } : p))
      );
    }
    showToast({
      type: "success",
      title: `${setor.setor} atualizado`,
      description: `Fase alterada para ${novaFase}.`
    });
  }

  if (!canView) {
    return (
      <div className="p-6">
        <EmptyState
          title="Acesso Negado"
          description="Você não tem permissão para visualizar os pedidos de produção."
          icon={AlertCircle}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 font-sans">
      <PageHeader
        title="Ordens de Serviço (Produção)"
        subtitle="Acompanhe propostas em fila de produção, pendências operacionais e andamento fabril."
        context="Produção"
        action={null}
      />

      {isLoaded && (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard
            title="Atrasados"
            value={atrasadosCount.toString()}
            description="OS com prazo excedido"
            tone="danger"
            icon={AlertCircle}
          />
          <SummaryCard
            title="Total de OS"
            value={totalCount.toString()}
            description="Fila geral"
            tone="info"
            icon={FileText}
            onClick={() => setFilter("status", "TODOS")}
            ativo={nenhumaFaseSelecionada}
          />
          <SummaryCard
            title="Em impressão"
            value={emImpressaoCount.toString()}
            description="Produção ativa"
            tone="warning"
            icon={Clipboard}
            onClick={() => setFilter("status", "EM IMPRESSAO")}
            ativo={filterStatus === "EM IMPRESSAO"}
          />
          <SummaryCard
            title="Em revisão"
            value={emRevisaoCount.toString()}
            description="Aguardando conclusão do boletim"
            tone="info"
            icon={FileText}
            onClick={() => setFilter("status", "REVISAO PRODUCAO")}
            ativo={filterStatus === "REVISAO PRODUCAO"}
          />
          <SummaryCard
            title="Em acabamento"
            value={emAcabamentoCount.toString()}
            description="Fase final"
            tone="success"
            icon={Clipboard}
            onClick={() => setFilter("status", "EM ACABAMENTO")}
            ativo={filterStatus === "EM ACABAMENTO"}
          />
        </section>
      )}

      {/* Caixa de Busca e Filtros Avançados */}
      <section className="rounded-3xl border border-[#d7e5e8] bg-white p-4 shadow-sm">
        <div className="grid gap-3 xl:grid-cols-[1fr_200px_200px_200px_auto]">
          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <Search className="h-4 w-4 text-[#0f9f9a]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="w-full bg-transparent text-sm text-slate-900 outline-none"
              placeholder="Buscar por ID, cliente, vendedor ou OS..."
            />
          </label>

          <select value={filterStatus} onChange={(event) => setFilter("status", event.target.value)} className={filterClass}>
            <option value="TODOS">Todos Status</option>
            {statusOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select value={filterVendedor} onChange={(event) => setFilter("vend", event.target.value)} className={filterClass}>
            <option value="TODOS">Todos Vendedores</option>
            {vendedorOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>

          <select value={filterEmpresa} onChange={(event) => setFilter("emp", event.target.value)} className={filterClass}>
            <option value="TODOS">Todas Empresas</option>
            {empresaOptions.map((option) => (
              <option key={option} value={option.toLowerCase().replace(" ", "")}>
                {option}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              // Volta todos os filtros ao padrão, o que os remove da URL.
              setFilters({ q: "", status: "TODOS", vend: "TODOS", emp: "TODOS" });
              setSearch("");
            }}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Limpar filtros
          </button>
        </div>
      </section>

      <ResponsiveList<PropostaOperacionalListItem>
        items={filteredPedidos}
        getKey={(proposta) => proposta.id_int.toString()}
        isLoading={!isLoaded}
        getRowHighlight={(proposta) => (ehRevisaoProducao(proposta) ? DESTAQUE_REVISAO_PRODUCAO : null)}
        onRowClick={(proposta) => {
          // Segundo caminho para o boletim, além do menu de ações. Clique em
          // controle (chip de setor, menu, botão) não conta como clique na
          // linha — a ResponsiveList já filtra isso.
          router.push(`/pedidos/boletim?id_int=${proposta.id_int}&modo=${proposta.hasOS ? "edicao" : "abertura"}`);
        }}
        emptyTitle="Nenhuma OS em andamento"
        emptyDescription="Ajuste os filtros ou verifique se a proposta foi aprovada."
        columns={[
          {
            header: "OS",
            cell: (proposta) => <span className="font-semibold text-slate-950">{proposta.id_int}</span>
          },
          {
            header: "Cliente",
            cell: (proposta) => (
              <div className="flex max-w-[170px] flex-col">
                <span className="block truncate font-medium text-slate-900" title={proposta.clienteNome}>
                  {proposta.clienteNome}
                </span>
                {/* Pagador: quem paga e recebe o documento fiscal, quando nao e
                    o cliente do pedido. Rotulo e cor propria para nao ler como
                    um segundo nome do cliente. Esta coluna nao mostra cidade/UF
                    — diferente da Expedicao —, entao o pagador fica logo abaixo
                    do nome. Sem pagador distinto, nada e renderizado e a celula
                    fica exatamente como estava. */}
                {proposta.pagadorNome && (
                  <span
                    className="block truncate text-[11px] font-medium text-indigo-700"
                    title={`Pagador: ${proposta.pagadorNome}`}
                  >
                    Pagador: {proposta.pagadorNome}
                  </span>
                )}
              </div>
            )
          },
          {
            header: "Título do evento",
            cell: (proposta) => (
              <div className="flex flex-col">
                <span className="text-sm font-medium text-slate-800 truncate max-w-[150px]" title={proposta.produto_principal || "Evento não informado"}>
                  {proposta.produto_principal || "Evento não informado"}
                </span>
              </div>
            )
          },
          {
            header: "Atendente",
            cell: (proposta) => <span className="text-sm text-slate-700 truncate max-w-[120px] block" title={proposta.vendedor}>{proposta.vendedor}</span>
          },
          {
            /**
             * Ha quanto tempo o pedido esta na fila da fabrica. Fica ao lado de
             * "Data entrega" de proposito: as duas datas do pedido lado a lado
             * respondem juntas se o prazo esta apertado.
             *
             * Nao e ordenavel nesta etapa — a lista segue fixa em id_int desc.
             */
            header: "Liberado em",
            cell: (proposta) => {
              const carimbo = proposta.liberadoProducaoEm;
              if (!carimbo) return <span className="text-xs font-medium text-slate-400">-</span>;
              const quando = new Date(carimbo);
              if (Number.isNaN(quando.getTime())) return <span className="text-xs font-medium text-slate-400">-</span>;
              // Data acima e hora menor abaixo, mesmo padrao que a coluna Cliente
              // usa para o pagador. Fuso local: o carimbo e um instante real, e
              // nao uma data solta como o prazo de entrega — por isso aqui NAO
              // entra o timeZone: "UTC" que "Data entrega" usa.
              return (
                <div className="flex flex-col">
                  <span className="text-xs font-medium text-slate-700">
                    {quando.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              );
            }
          },
          {
            header: "Data entrega",
            cell: (proposta) => {
              const dateStr = proposta.dataPrevistaEntrega;
              const formatted = dateStr && dateStr.trim() !== "" 
                ? new Date(dateStr).toLocaleDateString("pt-BR", { timeZone: "UTC" })
                : "-";
              return (
                <div className="flex flex-col text-xs font-medium text-slate-700 gap-1">
                   <span>{formatted}</span>
                </div>
              );
            }
          },
          {
            header: "Status",
            cell: (proposta) => {
              const st = (proposta.status_interno || "");
              // Consolidado do pedido: o detalhe de cada setor está na coluna
              // Setores, aqui vale quanto do pedido já terminou a produção.
              const consolidado = consolidarFases((proposta.setores ?? []).map((s) => s.fase));
              return (
                <div className="flex flex-col gap-1.5 items-start">
                  <StatusBadge status={st} tone={getStatusTone(st)} />
                  {consolidado && (
                    <span
                      className={`text-[10px] font-semibold whitespace-nowrap ${
                        consolidado.tudoPronto ? "text-emerald-600" : "text-slate-500"
                      }`}
                    >
                      {consolidado.prontos}/{consolidado.total}{" "}
                      {consolidado.total === 1 ? "setor pronto" : "setores prontos"}
                    </span>
                  )}
                  {proposta.libera_nf && (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 whitespace-nowrap">
                      Liberado para NF
                    </span>
                  )}
                </div>
              );
            }
          },
          {
            header: "Setores",
            cell: (proposta) => {
              const setores = proposta.setores ?? [];
              if (setores.length === 0) {
                return <span className="text-xs text-slate-400">Sem setor definido</span>;
              }
              return (
                <div className="flex flex-wrap items-center gap-1.5">
                  {setores.map((setor) => (
                    <SetorFaseChip
                      key={setor.setor}
                      setor={setor.setor}
                      fase={setor.fase}
                      temBoletim={Boolean(setor.boletimId)}
                      salvando={salvandoSetor === `${proposta.id_int}:${setor.setor}`}
                      onSelecionar={(fase) => { void handleFaseSetorChange(proposta, setor, fase); }}
                    />
                  ))}
                </div>
              );
            }
          },
          {
            header: "Ações",
            cell: (proposta) => {
              const canVoltarRevisao = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.admin");

              const actions = [
                {
                  label: proposta.hasOS ? "Editar OS / Boletim" : "Criar OS / Boletim",
                  onClick: () => router.push(`/pedidos/boletim?id_int=${proposta.id_int}&modo=${proposta.hasOS ? "edicao" : "abertura"}`)
                },
                // Basta a proposta estar liberada para produção: a OS que faltar
                // é criada no próprio clique (o servidor ainda revalida com 409).
                // Exigir `hasOS` aqui escondia o botão justamente de quem ainda
                // não tinha lote — o caso em que imprimir era impossível.
                ...(canPrintOS && proposta.is_prd_aprovado === true ? [{
                  label: printingOsId === proposta.id_int ? "Gerando PDF..." : "Imprimir OS (PDF)",
                  onClick: () => { void handleImprimirOS(proposta, "completo"); }
                }] : []),
                // Mesma acao, layout reduzido. Sem setor, como o item de cima:
                // a lista imprime a proposta, e a rota resolve o boletim mais
                // recente — o caminho legado, que continua valendo.
                ...(canPrintOS && proposta.is_prd_aprovado === true ? [{
                  label: printingOsId === proposta.id_int ? "Gerando PDF..." : "Imprimir OS reduzida (PDF)",
                  onClick: () => { void handleImprimirOS(proposta, "resumido"); }
                }] : []),
                ...(canRotateQr && proposta.hasOS && proposta.is_prd_aprovado === true ? [{
                  label: rotacionandoQrId === proposta.id_int ? "Gerando novo QR..." : "Gerar novo QR (invalida o anterior)",
                  destructive: true,
                  onClick: () => { void handleRotacionarQr(proposta); }
                }] : []),
                {
                  label: "Ver chat interno",
                  onClick: () => openChat(proposta.id_int, { clienteNome: proposta.clienteNome, idCliente: proposta.idCliente })
                },
                {
                  label: "Detalhes da proposta",
                  onClick: () => router.push(`/orcamentos/${proposta.id_int}`)
                },
                ...(canVoltarRevisao ? [
                  {
                    label: "Voltar para Revisão Atendente",
                    destructive: true,
                    onClick: () => {
                      setSelectedPropostaForDevolver(proposta);
                      setIsDevolverModalOpen(true);
                    }
                  }
                ] : []),
                ...(canEncerrarTeste ? [{
                  label: encerrandoTesteId === proposta.id_int ? "Encerrando teste..." : "Encerrar teste",
                  destructive: true,
                  onClick: () => { void handleEncerrarTeste(proposta); }
                }] : [])
              ];
              return (
                <div className="flex items-center justify-end gap-1.5">
                  <ActionsMenu items={actions} />
                </div>
              );
            }
          }
        ]}
        renderCard={(proposta) => (
          // O card do mobile nao passa pelo `getRowHighlight` (ele so vale para a
          // tabela), entao o destaque e aplicado aqui, com o mesmo par de cores.
          <article
            key={proposta.id_int}
            className={`rounded-3xl border p-5 shadow-sm ${
              ehRevisaoProducao(proposta)
                ? "border-amber-200 bg-amber-50"
                : "border-[#d7e5e8] bg-white"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">N° {proposta.id_int}</p>
                <h3 className="mt-2 font-semibold text-slate-950">
                  {proposta.clienteNome}
                </h3>
                {/* Mesma leitura do desktop: pagador logo abaixo do cliente. */}
                {proposta.pagadorNome && (
                  <p className="mt-0.5 text-xs font-medium text-indigo-700">Pagador: {proposta.pagadorNome}</p>
                )}
                <p className="mt-1 text-sm text-slate-500">{proposta.vendedor}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusBadge status={(proposta.status_interno || proposta.statusPedido || "")} tone={getStatusTone((proposta.status_interno || proposta.statusPedido || ""))} />
                {proposta.libera_nf && (
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 whitespace-nowrap">
                    Liberado para NF
                  </span>
                )}
              </div>
            </div>
            {(proposta.setores ?? []).length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {(proposta.setores ?? []).map((setor) => (
                  <SetorFaseChip
                    key={setor.setor}
                    setor={setor.setor}
                    fase={setor.fase}
                    temBoletim={Boolean(setor.boletimId)}
                    salvando={salvandoSetor === `${proposta.id_int}:${setor.setor}`}
                    onSelecionar={(fase) => { void handleFaseSetorChange(proposta, setor, fase); }}
                  />
                ))}
              </div>
            )}
            <div className="mt-4 space-y-2 text-sm text-slate-600">
              <p>OS: {proposta.hasOS ? "Criada" : "Sem OS"}</p>
              <p>Data: {proposta.dataProposta ? formatDateTime(proposta.dataProposta) : "-"}</p>
              <p className="font-semibold text-slate-900">Valor total: {formatCurrency(proposta.valorTotal)}</p>
            </div>
            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => router.push(`/pedidos/boletim?id_int=${proposta.id_int}&modo=${proposta.hasOS ? "edicao" : "abertura"}`)}
                className="rounded-2xl bg-[#0b2f4a] text-white px-4 py-2 text-sm font-semibold hover:bg-[#123f61] transition"
              >
                {proposta.hasOS ? "Editar OS" : "Criar OS"}
              </button>
              <button
                type="button"
                onClick={() => router.push(`/orcamentos/${proposta.id_int}`)}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 transition"
              >
                Detalhes
              </button>
              {(user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.admin")) && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPropostaForDevolver(proposta);
                    setIsDevolverModalOpen(true);
                  }}
                  className="rounded-2xl bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600 border border-rose-200 hover:bg-rose-100 transition"
                >
                  Voltar p/ Revisão
                </button>
              )}
            </div>
          </article>
        )}
      />

      
      
      {selectedPropostaForDevolver && (
        <DevolverRevisaoModal
          propostaId={selectedPropostaForDevolver.id_int}
          isOpen={isDevolverModalOpen}
          isSubmitting={isDevolverSubmitting}
          onClose={() => setIsDevolverModalOpen(false)}
          onConfirm={() => void confirmDevolverRevisao()}
        />
      )}
    </div>
  );
}
