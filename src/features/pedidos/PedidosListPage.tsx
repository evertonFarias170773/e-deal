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
import { listarPedidosOperacionais, atualizarFaseProducaoLista } from "./services/pedidos-producao.service";
import { abrirPdfOs } from "./services/imprimir-os.client";
import { getSupabaseClient } from "@/lib/supabase/client";
import { 
  devolverPropostaParaRevisaoAtendente,
  registrarMensagemSistemaProposta
} from "@/features/orcamentos/services/orcamentos.service";
import { DevolverRevisaoModal } from "./components/DevolverRevisaoModal";
import { liberarPedidoParaFiscal } from "./services/boletim-propostas.service";

import type { PropostaOperacionalListItem } from "./types";
import { useRouter } from "next/navigation";

const filterClass = "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none";

export function PedidosListPage() {
  const { openChat } = useGlobalChat();
  const { user } = useAuth();
  const { showToast } = useAppToast();
  const router = useRouter();
  
  const [pedidos, setPedidos] = useState<PropostaOperacionalListItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDevolverModalOpen, setIsDevolverModalOpen] = useState(false);
  const [isLiberando, setIsLiberando] = useState(false);
  const [selectedPropostaForDevolver, setSelectedPropostaForDevolver] = useState<PropostaOperacionalListItem | null>(null);
  const [isDevolverSubmitting, setIsDevolverSubmitting] = useState(false);

  // Autorização (V2.1 + Legado V1)
  const canView = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.view");
  const canPrintOS = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.print_os");

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
  async function handleImprimirOS(proposta: PropostaOperacionalListItem) {
    if (printingOsId !== null) return;
    setPrintingOsId(proposta.id_int);
    const result = await abrirPdfOs(proposta.id_int);
    setPrintingOsId(null);
    if (!result.success) {
      showToast({
        type: "error",
        title: "Erro ao gerar PDF da OS",
        description: result.errorMessage || "Erro desconhecido."
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
  });

  // Derived options for filters
  const statusOptions = Array.from(new Set(pedidos.map(p => p.status_interno || p.statusPedido || ""))).filter(Boolean).sort();
  const vendedorOptions = Array.from(new Set(pedidos.map(p => p.vendedor))).filter(Boolean).sort();
  const empresaOptions = Array.from(new Set(pedidos.map(p => p.empresa))).filter(Boolean).sort();

  // Modal Handlers
  const handleLiberarNF = async (proposta: PropostaOperacionalListItem) => {
    if (!window.confirm(`Deseja enviar o pedido #${proposta.id_int} (${proposta.clienteNome}) para a Fila de Faturamento Fiscal?`)) return;
    setIsLiberando(true);
    try {
      const res = await liberarPedidoParaFiscal(proposta.id_int);
      if (res.success) {
        showToast({ type: "success", title: "Sucesso", description: `Pedido #${proposta.id_int} liberado para Faturamento!` });
        // Update local state without full reload
        setPedidos((prev) =>
          prev.map((p) => (p.id_int === proposta.id_int ? { ...p, libera_nf: true } : p))
        );
      } else {
        showToast({ type: "error", title: "Erro ao liberar", description: res.error || "Erro desconhecido." });
      }
    } catch (err: any) {
      showToast({ type: "error", title: "Exception ao liberar", description: err.message || "Erro desconhecido ao liberar" });
    } finally {
      setIsLiberando(false);
    }
  };

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

  async function handleFaseChange(proposta: PropostaOperacionalListItem, newFase: string) {
    // Optimistic UI Update
    const oldStatus = proposta.status_interno || "Indefinido";
    if (oldStatus === newFase) return; // Se já é a mesma, não faz nada

    setPedidos(current => current.map(p => 
      p.id_int === proposta.id_int ? { ...p, status_interno: newFase } : p
    ));

    const res = await atualizarFaseProducaoLista(proposta.id_int, newFase, oldStatus);
    if (!res.success) {
      // Rollback
      showToast({ type: "error", title: "Erro", description: res.error || "Erro ao atualizar fase." });
      setPedidos(current => current.map(p => 
        p.id_int === proposta.id_int ? { ...p, status_interno: oldStatus } : p
      ));
    } else {
      showToast({ type: "success", title: "Sucesso", description: "Fase atualizada." });
      registrarMensagemSistemaProposta({
        idInt: proposta.id_int,
        mensagem: `Fase de produção alterada de ${oldStatus} para ${newFase}.`
      }).catch(err => {
        console.warn("[PedidosListPage] Erro silencioso ao logar no chat:", err);
      });
    }
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
          />
          <SummaryCard
            title="Em impressão"
            value={emImpressaoCount.toString()}
            description="Produção ativa"
            tone="warning"
            icon={Clipboard}
          />
          <SummaryCard
            title="Em revisão"
            value={emRevisaoCount.toString()}
            description="Aguardando conclusão do boletim"
            tone="info"
            icon={FileText}
          />
          <SummaryCard
            title="Em acabamento"
            value={emAcabamentoCount.toString()}
            description="Fase final"
            tone="success"
            icon={Clipboard}
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
        onRowClick={() => {
          // No action row click directly, user should use actions column.
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
              <div className="flex flex-col">
                <span className="font-medium text-slate-900 truncate max-w-[150px]" title={proposta.clienteNome}>{proposta.clienteNome}</span>
                <span className="text-[10px] uppercase font-bold text-slate-400">{proposta.empresa}</span>
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
              return (
                <div className="flex flex-col gap-1.5 items-start">
                  <StatusBadge status={st} tone={getStatusTone(st)} />
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
            header: "Fases",
            cell: (proposta) => {
              const fases = ["EM IMPRESSAO", "EM ACABAMENTO", "REVISAO"];
              const currentStatus = proposta.status_interno;
              const isLocked = currentStatus === "REVISAO PRODUCAO";
              
              return (
                <div className="flex items-center gap-3">
                  {fases.map(fase => (
                    <label key={fase} className={`flex items-center gap-1.5 text-xs font-medium ${isLocked ? 'cursor-not-allowed text-slate-400' : 'cursor-pointer text-slate-700'}`}>
                      <input 
                        type="radio" 
                        name={`fase-${proposta.id_int}`}
                        value={fase}
                        checked={currentStatus === fase}
                        disabled={isLocked}
                        onChange={() => handleFaseChange(proposta, fase)}
                        className={`w-3.5 h-3.5 text-blue-600 border-slate-300 focus:ring-blue-500 ${isLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                      />
                      {fase.replace("EM ", "")}
                    </label>
                  ))}
                </div>
              );
            }
          },
          {
            header: "Ações",
            cell: (proposta) => {
              const canLiberarNF = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.release_nf");
              const canVoltarRevisao = user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "pedidos.admin");

              const actions = [
                {
                  label: proposta.hasOS ? "Editar OS / Boletim" : "Criar OS / Boletim",
                  onClick: () => router.push(`/pedidos/boletim?id_int=${proposta.id_int}&modo=${proposta.hasOS ? "edicao" : "abertura"}`)
                },
                // Condição explícita: OS existente E proposta liberada para produção
                // (não depende só do filtro do service; o servidor revalida com 409).
                ...(canPrintOS && proposta.hasOS && proposta.is_prd_aprovado === true ? [{
                  label: printingOsId === proposta.id_int ? "Gerando PDF..." : "Imprimir OS (PDF)",
                  onClick: () => { void handleImprimirOS(proposta); }
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
                ...(canLiberarNF ? [
                  ...(proposta.libera_nf ? [] : [{
                    label: "Liberar para NF",
                    onClick: () => handleLiberarNF(proposta)
                  }])
                ] : []),
                ...(canVoltarRevisao ? [
                  {
                    label: "Voltar para Revisão Atendente",
                    destructive: true,
                    onClick: () => {
                      setSelectedPropostaForDevolver(proposta);
                      setIsDevolverModalOpen(true);
                    }
                  }
                ] : [])
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
          <article key={proposta.id_int} className="rounded-3xl border border-[#d7e5e8] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">N° {proposta.id_int}</p>
                <h3 className="mt-2 font-semibold text-slate-950">
                  {proposta.clienteNome}
                </h3>
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
