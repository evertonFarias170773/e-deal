"use client";

/**
 * /conta-corrente — Saldo de crédito/débito dos clientes.
 *
 * ORGANIZAÇÃO: uma linha por CLIENTE com o saldo atual; clicar abre o extrato
 * dele. A pergunta do dia a dia é "quem tem crédito e quanto", não "qual foi o
 * 40º lançamento" — o extrato corrido respondia a segunda e escondia a
 * primeira, com o mesmo cliente espalhado em linhas distantes.
 *
 * FONTE: `movimento_credito` é a razão COMPLETA — pendência grava seu
 * movimento de ABERTURA (cc_abrir_pendencia), ajuste manual e uso de crédito
 * entram na mesma tabela. Por isso o saldo sai daqui, e não da soma de
 * fontes separadas.
 *
 * Escrita continua só via RPC cc_encerrar_pendencia (/api/conta-corrente/encerrar).
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { useAppToast } from "@/components/common/AppToast";
import { PageHeader } from "@/components/common/PageHeader";
import { SummaryCard } from "@/components/common/SummaryCard";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useUrlFilters } from "@/hooks/useUrlFilters";
import { useDebouncedInput } from "@/hooks/useDebouncedValue";
import { codecs } from "@/lib/url-state";
import {
  listAllPendencias,
  listExtratoContaCorrente,
  ROTULO_TIPO_LANCAMENTO,
  type ContaCorrentePendencia,
  type ContaCorrentePendenciaStatus,
  type LancamentoContaCorrente,
  type TipoLancamentoConta,
} from "@/features/cobrancas/services/conta-corrente.service";
import { Wallet, TrendingUp, TrendingDown, Coins, Search, Loader2, X, ChevronRight, ChevronDown } from "lucide-react";
import Link from "next/link";

const STATUS_LABEL: Record<ContaCorrentePendenciaStatus, string> = {
  ABERTA: "Aberta",
  PARCIALMENTE_RESOLVIDA: "Parcialmente resolvida",
  RESOLVIDA: "Resolvida",
  CANCELADA: "Cancelada",
};

const MOTIVO_LABEL: Record<string, string> = {
  FRETE: "Frete",
  PRODUTO_INCLUIDO: "Produto incluído",
  PRODUTO_REMOVIDO: "Produto removido",
  PRODUTO_TROCADO: "Produto trocado",
  SERVICO_ALTERADO: "Serviço alterado",
  OUTRO: "Outro",
};

/** Cor do selo por categoria — mesma leitura em todo o extrato. */
const TOM_CATEGORIA: Record<TipoLancamentoConta, string> = {
  AJUSTE: "border-indigo-200 bg-indigo-50 text-indigo-700",
  USO: "border-rose-200 bg-rose-50 text-rose-700",
  PENDENCIA: "border-sky-200 bg-sky-50 text-sky-700",
  ESTORNO: "border-amber-200 bg-amber-50 text-amber-800",
  LEGADO: "border-slate-200 bg-slate-100 text-slate-600",
};

type ModoAcao = "DEVOLUCAO" | "BONIFICACAO" | "BAIXA" | "CANCELAMENTO" | "ESTORNO";

const TIPO_FILTRO = ["TODOS", "AJUSTE", "USO", "PENDENCIA", "ESTORNO", "LEGADO"] as const;
const SALDO_FILTRO = ["TODOS", "COM_CREDITO", "COM_DEBITO"] as const;

/** Linha da tabela principal: um cliente com o saldo já fechado. */
type LinhaCliente = {
  idCliente: number;
  nome: string;
  saldo: number;
  lancamentos: LancamentoContaCorrente[];
  pendenciasAbertas: ContaCorrentePendencia[];
  ultimoMovimento: string | null;
};

function formatCurrency(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

export default function ContaCorrenteRoute() {
  return (
    // A tela lê os filtros da URL (useSearchParams), que exige limite de Suspense.
    <Suspense fallback={null}>
      <ContaCorrentePage />
    </Suspense>
  );
}

function ContaCorrentePage() {
  const { user } = useAuth();
  const { showToast } = useAppToast();

  const [pendencias, setPendencias] = useState<ContaCorrentePendencia[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoContaCorrente[]>([]);
  const [nomesCliente, setNomesCliente] = useState<Record<number, string>>({});
  const [nomesAutor, setNomesAutor] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [expandidos, setExpandidos] = useState<Set<number>>(new Set());

  // Filtros na URL: sobrevivem ao F5, ao histórico e a um link copiado.
  const filtrosSchema = useMemo(
    () => ({
      q: { codec: codecs.texto(), default: "" },
      tipo: { codec: codecs.enumOf(TIPO_FILTRO), default: "TODOS" as const },
      saldo: { codec: codecs.enumOf(SALDO_FILTRO), default: "TODOS" as const },
      de: { codec: codecs.texto(), default: "" },
      ate: { codec: codecs.texto(), default: "" },
    }),
    []
  );
  const { filters, setFilter } = useUrlFilters(filtrosSchema);

  const tipoFiltro = filters.tipo;
  const saldoFiltro = filters.saldo;
  const dataDe = filters.de;
  const dataAte = filters.ate;
  // O campo responde a cada tecla; a URL só é gravada depois da pausa.
  const [searchTerm, setSearchTerm] = useDebouncedInput(filters.q, (valor) => setFilter("q", valor));

  const [modal, setModal] = useState<{ pendencia: ContaCorrentePendencia; modo: ModoAcao } | null>(null);
  const [modalValor, setModalValor] = useState("");
  const [modalMotivo, setModalMotivo] = useState("");

  const canDevolver = hasPermissao(user, "financeiro.devolver");
  const canBonificar = hasPermissao(user, "financeiro.bonificar");
  const canResolver = hasPermissao(user, "financeiro.resolver_credito");
  const canEstornar = Boolean(user?.isAdmin || user?.isSuperAdmin);
  const podeVisualizar = canDevolver || canBonificar || canResolver || canEstornar || hasPermissao(user, "credito.usar");

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: pends }, extrato] = await Promise.all([
        listAllPendencias({ limit: 500 }),
        listExtratoContaCorrente(),
      ]);
      setPendencias(pends);
      setLancamentos(extrato);

      const client = getSupabaseClient();
      const idsCliente = Array.from(
        new Set([...pends.map((p) => p.id_cliente), ...extrato.map((l) => l.id_cliente)].filter(Boolean))
      );
      const uidsAutor = Array.from(new Set(extrato.map((l) => l.created_by).filter(Boolean))) as string[];

      if (client && idsCliente.length > 0) {
        const { data: cli } = await client.from("clientes").select("id_cliente, nome").in("id_cliente", idsCliente);
        const mapCli: Record<number, string> = {};
        (cli || []).forEach((c: { id_cliente: number; nome: string | null }) => {
          mapCli[Number(c.id_cliente)] = c.nome ?? `Cliente #${c.id_cliente}`;
        });
        setNomesCliente(mapCli);
      } else {
        setNomesCliente({});
      }

      if (client && uidsAutor.length > 0) {
        const { data: us } = await client.from("usuarios").select("user_id, nome_usuario, email").in("user_id", uidsAutor);
        const mapAutor: Record<string, string> = {};
        (us || []).forEach((u: { user_id: string; nome_usuario: string | null; email: string | null }) => {
          mapAutor[u.user_id] = u.nome_usuario || u.email || "Usuário";
        });
        setNomesAutor(mapAutor);
      } else {
        setNomesAutor({});
      }
    } catch (err) {
      console.error("[ContaCorrentePage] Erro ao carregar a Conta Corrente:", err);
      showToast({ type: "error", title: "Erro ao carregar a Conta Corrente." });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void carregar(); }, [carregar]);

  // ── Totais dos cards ──────────────────────────────────────────────────────
  // Saldo é ESTOQUE: fecha cliente a cliente sobre a razão inteira e ignora o
  // filtro de período de propósito — saldo "de agosto" não existe. Só o card
  // de uso é FLUXO e segue o período.
  const totais = useMemo(() => {
    const saldoPorCliente = new Map<number, number>();
    for (const l of lancamentos) {
      saldoPorCliente.set(l.id_cliente, (saldoPorCliente.get(l.id_cliente) ?? 0) + l.valorComSinal);
    }

    let totalCredito = 0;
    let totalDebito = 0;
    let clientesComCredito = 0;
    let clientesComDebito = 0;
    for (const saldo of saldoPorCliente.values()) {
      const v = Math.round(saldo * 100) / 100;
      if (v > 0) { totalCredito += v; clientesComCredito += 1; }
      else if (v < 0) { totalDebito += -v; clientesComDebito += 1; }
    }

    const abertas = pendencias.filter((p) => p.status === "ABERTA" || p.status === "PARCIALMENTE_RESOLVIDA");
    const pendCredito = abertas.filter((p) => p.direcao === "FAVOR_CLIENTE").reduce((s, p) => s + p.valor_saldo, 0);
    const pendDebito = abertas.filter((p) => p.direcao === "FAVOR_EMPRESA").reduce((s, p) => s + p.valor_saldo, 0);
    const reservado = abertas.reduce((s, p) => s + p.valor_reservado, 0);

    const usosNoPeriodo = lancamentos.filter(
      (l) => l.categoria === "USO" && dentroDoPeriodo(l.created_at, dataDe, dataAte)
    );

    return {
      totalCredito: Math.round(totalCredito * 100) / 100,
      totalDebito: Math.round(totalDebito * 100) / 100,
      clientesComCredito,
      clientesComDebito,
      pendCredito,
      pendDebito,
      reservado,
      qtdAbertas: abertas.length,
      usoTotal: Math.round(usosNoPeriodo.reduce((s, l) => s + l.valor, 0) * 100) / 100,
      usoQtd: usosNoPeriodo.length,
      saldoPorCliente,
    };
  }, [lancamentos, pendencias, dataDe, dataAte]);

  const temPeriodo = Boolean(dataDe || dataAte);

  // ── Linhas por cliente, já filtradas ──────────────────────────────────────
  const linhas = useMemo<LinhaCliente[]>(() => {
    const termo = searchTerm.trim().toLowerCase();

    const porCliente = new Map<number, LancamentoContaCorrente[]>();
    for (const l of lancamentos) {
      // Período e tipo filtram o EXTRATO. O saldo do cliente continua vindo do
      // total (totais.saldoPorCliente) — filtrar a lista não muda o que ele tem.
      if (!dentroDoPeriodo(l.created_at, dataDe, dataAte)) continue;
      if (tipoFiltro !== "TODOS" && l.categoria !== tipoFiltro) continue;
      const atual = porCliente.get(l.id_cliente);
      if (atual) atual.push(l);
      else porCliente.set(l.id_cliente, [l]);
    }

    const resultado: LinhaCliente[] = [];
    for (const [idCliente, lista] of porCliente) {
      const nome = nomesCliente[idCliente] ?? `Cliente #${idCliente}`;
      if (termo && !`${nome} ${idCliente} ${lista.map((l) => l.observacao ?? "").join(" ")}`.toLowerCase().includes(termo)) {
        continue;
      }
      const saldo = Math.round((totais.saldoPorCliente.get(idCliente) ?? 0) * 100) / 100;
      if (saldoFiltro === "COM_CREDITO" && saldo <= 0) continue;
      if (saldoFiltro === "COM_DEBITO" && saldo >= 0) continue;

      resultado.push({
        idCliente,
        nome,
        saldo,
        lancamentos: lista,
        pendenciasAbertas: pendencias.filter(
          (p) => p.id_cliente === idCliente && (p.status === "ABERTA" || p.status === "PARCIALMENTE_RESOLVIDA")
        ),
        ultimoMovimento: lista[0]?.created_at ?? null,
      });
    }

    // Maior saldo primeiro: quem tem dinheiro parado é quem exige ação.
    // Empate (zerados) volta a ordenar por movimento mais recente.
    return resultado.sort((a, b) => {
      if (b.saldo !== a.saldo) return b.saldo - a.saldo;
      return new Date(b.ultimoMovimento ?? 0).getTime() - new Date(a.ultimoMovimento ?? 0).getTime();
    });
  }, [lancamentos, pendencias, nomesCliente, searchTerm, tipoFiltro, saldoFiltro, dataDe, dataAte, totais.saldoPorCliente]);

  const totalLancamentosExibidos = linhas.reduce((s, l) => s + l.lancamentos.length, 0);
  const filtroAtivo = Boolean(searchTerm.trim()) || tipoFiltro !== "TODOS" || saldoFiltro !== "TODOS" || temPeriodo;

  function alternarExpandido(idCliente: number) {
    setExpandidos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(idCliente)) proximo.delete(idCliente);
      else proximo.add(idCliente);
      return proximo;
    });
  }

  function limparFiltros() {
    setSearchTerm("");
    setFilter("tipo", "TODOS");
    setFilter("saldo", "TODOS");
    setFilter("de", "");
    setFilter("ate", "");
  }

  function abrirModal(pendencia: ContaCorrentePendencia, modo: ModoAcao) {
    setModal({ pendencia, modo });
    setModalValor(pendencia.valor_saldo.toFixed(2).replace(".", ","));
    setModalMotivo("");
  }

  async function executarAcao() {
    if (!modal) return;
    const { pendencia, modo } = modal;
    setBusy(pendencia.id);
    try {
      const client = getSupabaseClient();
      const session = (await client?.auth.getSession())?.data.session;
      const token = session?.access_token;
      if (!token) throw new Error("Sessão expirada.");

      const body: Record<string, unknown> = { idPendencia: pendencia.id, modo, observacao: modalMotivo || undefined };

      if (modo === "DEVOLUCAO" || modo === "BONIFICACAO" || modo === "BAIXA") {
        const v = parseFloat(modalValor.replace(",", "."));
        if (isNaN(v) || v <= 0 || v > pendencia.valor_saldo + 0.01) {
          throw new Error(`Informe um valor entre R$ 0,01 e ${formatCurrency(pendencia.valor_saldo)}.`);
        }
        body.valor = Math.round(v * 100) / 100;
        body.motivo = modo;
      } else if (modo === "CANCELAMENTO") {
        if (!modalMotivo.trim()) throw new Error("Informe o motivo do cancelamento.");
        body.motivo = modalMotivo.trim();
      } else if (modo === "ESTORNO") {
        // Estorna o último movimento de resolução ainda não estornado desta pendência.
        const { data: mov } = await client!
          .from("movimento_credito")
          .select("id, tipo_evento")
          .eq("id_pendencia", pendencia.id)
          .in("tipo_evento", ["USO_PEDIDO", "DEVOLUCAO", "BONIFICACAO", "BAIXA"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!mov) throw new Error("Nenhum evento de resolução encontrado para estornar nesta pendência.");
        body.idMovimentoRef = mov.id;
        body.motivo = modalMotivo.trim() || "Estorno solicitado pelo Financeiro/Admin.";
      }

      const res = await fetch("/api/conta-corrente/encerrar", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || "Falha ao executar ação.");

      showToast({ type: "success", title: "Ação registrada com sucesso." });
      setModal(null);
      await carregar();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast({ type: "error", title: "Falha na operação", description: msg });
    } finally {
      setBusy(null);
    }
  }

  if (!podeVisualizar) {
    return (
      <div className="p-8">
        <PageHeader title="Conta Corrente" subtitle="Saldo de crédito e débito dos clientes" />
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
          <p className="text-sm font-semibold text-slate-600">Sem acesso a este módulo.</p>
          <p className="mt-1 text-xs text-slate-400">Requer permissão financeira (financeiro.* ou credito.usar).</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Conta Corrente"
        subtitle="Saldo do cliente: pendências pós-pagamento, ajustes manuais e usos do crédito. Não é Contas a Receber; nunca bloqueia novos pedidos."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Crédito a favor dos clientes"
          value={formatCurrency(totais.totalCredito)}
          description={`${totais.clientesComCredito} cliente(s) com saldo positivo — já descontados os usos`}
          icon={TrendingUp}
          tone="success"
        />
        <SummaryCard
          title="Débito a favor da empresa"
          value={formatCurrency(totais.totalDebito)}
          description={`${totais.clientesComDebito} cliente(s) com saldo negativo`}
          icon={TrendingDown}
          tone="warning"
        />
        <SummaryCard
          title="Pendências em aberto"
          value={formatCurrency(totais.pendCredito + totais.pendDebito)}
          description={
            `${totais.qtdAbertas} pendência(s) — ${formatCurrency(totais.pendCredito)} ao cliente, ${formatCurrency(totais.pendDebito)} à empresa` +
            (totais.reservado > 0 ? ` · ${formatCurrency(totais.reservado)} reservado` : "")
          }
          icon={Wallet}
          tone="info"
        />
        <SummaryCard
          // Único card de FLUXO: segue o período filtrado. Sem período era um
          // acumulado desde sempre ao lado de três cards de saldo — só crescia
          // e não respondia a pergunta nenhuma.
          title={temPeriodo ? "Crédito aplicado no período" : "Crédito aplicado (total)"}
          value={formatCurrency(totais.usoTotal)}
          description={
            temPeriodo
              ? `${totais.usoQtd} uso(s) entre ${dataDe ? formatDate(dataDe) : "o início"} e ${dataAte ? formatDate(dataAte) : "hoje"}`
              : `${totais.usoQtd} uso(s) desde o início — filtre por período para fechar um mês`
          }
          icon={Coins}
          tone="special"
        />
      </div>

      {/* ── Filtros ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente</label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Nome, ID do cliente ou observação..."
                className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">De</label>
            <input
              type="date"
              value={dataDe}
              onChange={(e) => setFilter("de", e.target.value)}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Até</label>
            <input
              type="date"
              value={dataAte}
              onChange={(e) => setFilter("ate", e.target.value)}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tipo</label>
            <select
              value={tipoFiltro}
              onChange={(e) => setFilter("tipo", e.target.value as (typeof TIPO_FILTRO)[number])}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            >
              <option value="TODOS">Todos os tipos</option>
              {(["AJUSTE", "USO", "PENDENCIA", "ESTORNO", "LEGADO"] as TipoLancamentoConta[]).map((t) => (
                <option key={t} value={t}>{ROTULO_TIPO_LANCAMENTO[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Saldo</label>
            <select
              value={saldoFiltro}
              onChange={(e) => setFilter("saldo", e.target.value as (typeof SALDO_FILTRO)[number])}
              className="mt-1 block rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
            >
              <option value="TODOS">Qualquer saldo</option>
              <option value="COM_CREDITO">Só com crédito</option>
              <option value="COM_DEBITO">Só devedores</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
          <span>
            {linhas.length} cliente(s) · {totalLancamentosExibidos} lançamento(s)
            {filtroAtivo ? " no filtro atual" : ""}
          </span>
          {filtroAtivo && (
            <button type="button" onClick={limparFiltros} className="font-semibold text-sky-700 hover:underline">
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* ── Lista por cliente ───────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 p-16 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Carregando lançamentos...
        </div>
      ) : linhas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-16 text-center">
          <p className="text-sm font-semibold text-slate-600">Nenhum cliente encontrado.</p>
          {filtroAtivo && <p className="mt-1 text-xs text-slate-400">Tente limpar os filtros.</p>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-slate-100 bg-slate-50/60 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">
            <span>Cliente</span>
            <span className="text-right">Saldo atual</span>
            <span className="hidden text-right sm:block">Lançamentos</span>
            <span className="hidden text-right sm:block">Último mov.</span>
          </div>

          <div className="divide-y divide-slate-100">
            {linhas.map((linha) => {
              const aberto = expandidos.has(linha.idCliente);
              return (
                <div key={linha.idCliente}>
                  <button
                    type="button"
                    onClick={() => alternarExpandido(linha.idCliente)}
                    className="grid w-full grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-4 py-3 text-left transition hover:bg-slate-50"
                    aria-expanded={aberto}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {aberto ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-slate-800">{linha.nome}</span>
                        <span className="block text-[10px] text-slate-400">
                          Cliente #{linha.idCliente}
                          {linha.pendenciasAbertas.length > 0 && (
                            <span className="ml-2 rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 font-bold text-sky-700">
                              {linha.pendenciasAbertas.length} pendência(s)
                            </span>
                          )}
                        </span>
                      </span>
                    </span>
                    <span className={`text-right font-bold ${linha.saldo > 0 ? "text-teal-700" : linha.saldo < 0 ? "text-rose-700" : "text-slate-400"}`}>
                      {formatCurrency(linha.saldo)}
                    </span>
                    <span className="hidden text-right text-sm text-slate-500 sm:block">{linha.lancamentos.length}</span>
                    <span className="hidden whitespace-nowrap text-right text-xs text-slate-400 sm:block">{formatDate(linha.ultimoMovimento)}</span>
                  </button>

                  {aberto && (
                    <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3 space-y-3">
                      {/* Pendências abertas primeiro: são as que pedem ação. */}
                      {linha.pendenciasAbertas.map((p) => (
                        <div key={`pend-${p.id}`} className="rounded-xl border border-sky-200 bg-white p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-800">
                                Pendência {STATUS_LABEL[p.status]} ·{" "}
                                <Link href={`/orcamentos/${p.id_int}?chat=open`} className="text-sky-700 hover:underline">
                                  #{p.id_int}
                                </Link>
                              </p>
                              <p className="text-xs text-slate-500">
                                {MOTIVO_LABEL[p.motivo] ?? p.motivo} · {p.direcao === "FAVOR_CLIENTE" ? "a favor do cliente" : "a favor da empresa"}
                                {p.valor_reservado > 0 ? ` · ${formatCurrency(p.valor_reservado)} reservado` : ""}
                              </p>
                              {p.observacao && <p className="mt-1 text-xs text-slate-500">{p.observacao}</p>}
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="mr-1 font-bold text-slate-800">{formatCurrency(p.valor_saldo)}</span>
                              {p.direcao === "FAVOR_CLIENTE" && canDevolver && (
                                <button disabled={busy === p.id} onClick={() => abrirModal(p, "DEVOLUCAO")} className="rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700 hover:bg-blue-100">Devolver</button>
                              )}
                              {p.direcao === "FAVOR_EMPRESA" && canBonificar && (
                                <button disabled={busy === p.id} onClick={() => abrirModal(p, "BONIFICACAO")} className="rounded-lg border border-purple-200 bg-purple-50 px-2 py-1 text-xs font-bold text-purple-700 hover:bg-purple-100">Bonificar</button>
                              )}
                              {p.direcao === "FAVOR_EMPRESA" && canResolver && (
                                <button disabled={busy === p.id} onClick={() => abrirModal(p, "BAIXA")} className="rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-bold text-sky-700 hover:bg-sky-100">Baixar</button>
                              )}
                              {p.valor_reservado === 0 && canResolver && (
                                <button disabled={busy === p.id} onClick={() => abrirModal(p, "CANCELAMENTO")} className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-200">Cancelar</button>
                              )}
                              {canEstornar && p.status === "PARCIALMENTE_RESOLVIDA" && (
                                <button disabled={busy === p.id} onClick={() => abrirModal(p, "ESTORNO")} className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-100">Estornar</button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}

                      {/* Extrato do cliente */}
                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                        {linha.lancamentos.map((l) => (
                          <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 last:border-b-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="whitespace-nowrap text-xs text-slate-400">{formatDate(l.created_at)}</span>
                              <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-bold ${TOM_CATEGORIA[l.categoria]}`}>
                                {ROTULO_TIPO_LANCAMENTO[l.categoria]}
                              </span>
                              <span className="min-w-0 truncate text-sm text-slate-600" title={l.observacao ?? ""}>
                                {l.id_int_destino ? (
                                  <>
                                    Aplicado na proposta{" "}
                                    <Link href={`/orcamentos/${l.id_int_destino}?chat=open`} className="font-semibold text-sky-700 hover:underline">
                                      #{l.id_int_destino}
                                    </Link>
                                  </>
                                ) : (
                                  l.observacao || "—"
                                )}
                              </span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className={`whitespace-nowrap font-semibold ${l.tipo === "CREDITO" ? "text-teal-700" : "text-rose-700"}`}>
                                {l.tipo === "CREDITO" ? "+" : "−"} {formatCurrency(l.valor)}
                              </span>
                              <span className="hidden whitespace-nowrap text-[10px] text-slate-400 md:block">
                                {l.created_by ? (nomesAutor[l.created_by] ?? "Usuário") : "Sistema"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {modal ? (
        <div className="fixed inset-0 z-[85] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <h3 className="text-lg font-semibold text-slate-950">
                {modal.modo === "DEVOLUCAO" && "Devolver ao cliente"}
                {modal.modo === "BONIFICACAO" && "Bonificar (absorver comercialmente)"}
                {modal.modo === "BAIXA" && "Baixar débito"}
                {modal.modo === "CANCELAMENTO" && "Cancelar pendência"}
                {modal.modo === "ESTORNO" && "Estornar último evento"}
              </h3>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <p className="text-sm text-slate-600">
              Proposta #{modal.pendencia.id_int} · Saldo atual: <strong>{formatCurrency(modal.pendencia.valor_saldo)}</strong>
            </p>

            {(modal.modo === "DEVOLUCAO" || modal.modo === "BONIFICACAO" || modal.modo === "BAIXA") && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-500">Valor (R$)</label>
                <input
                  type="text" inputMode="decimal" value={modalValor}
                  onChange={(e) => setModalValor(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm"
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-500">
                {modal.modo === "CANCELAMENTO" ? "Motivo (obrigatório)" : "Observação"}
              </label>
              <textarea
                value={modalMotivo} onChange={(e) => setModalMotivo(e.target.value)}
                rows={2} className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm resize-none"
                placeholder="Registrado na timeline da proposta..."
              />
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
              <button
                disabled={busy === modal.pendencia.id}
                onClick={() => void executarAcao()}
                className="rounded-xl bg-[#0b2f4a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#123f61] disabled:opacity-50"
              >
                {busy === modal.pendencia.id ? "Processando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Compara só a parte da data (YYYY-MM-DD). O input date entrega data local sem
 * fuso; converter o timestamp para Date e comparar traria o lançamento do dia
 * anterior perto da meia-noite.
 */
function dentroDoPeriodo(iso: string, de: string, ate: string): boolean {
  if (!de && !ate) return true;
  const dia = iso.slice(0, 10);
  if (de && dia < de) return false;
  if (ate && dia > ate) return false;
  return true;
}
