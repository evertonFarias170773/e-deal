"use client";

/**
 * /conta-corrente — Tela financeira de Conta Corrente (Pendências Financeiras)
 *
 * Permite ao Financeiro/Admin consultar e administrar pendências
 * (public.conta_corrente_pendencias) SEM depender de um novo pedido — o
 * requisito explícito do módulo. Pendência nunca bloqueia o cliente; esta
 * tela apenas resolve/baixa/cancela/estorna o que já existe.
 *
 * Toda escrita passa pelas RPCs cc_encerrar_pendencia (via /api/conta-corrente/encerrar).
 * Leitura é direta com RLS (sem RPC), reaproveitando conta-corrente.service.ts.
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
  listAjustesManuais,
  listUsosDeCredito,
  type ContaCorrentePendencia,
  type ContaCorrentePendenciaStatus,
  type AjusteManualConta,
  type UsoCreditoConta,
} from "@/features/cobrancas/services/conta-corrente.service";
import {
  getSaldoGlobalContaCorrente,
  type SaldoGlobalContaCorrente,
} from "@/features/cobrancas/services/movimento-credito.service";
import { Wallet, TrendingUp, TrendingDown, Coins, Search, Loader2, X } from "lucide-react";
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

type ModoAcao = "DEVOLUCAO" | "BONIFICACAO" | "BAIXA" | "CANCELAMENTO" | "ESTORNO";

/** Filtros da tela, na ordem em que aparecem no select. */
const STATUS_FILTRO = ["TODAS", "ABERTA", "PARCIALMENTE_RESOLVIDA", "RESOLVIDA", "CANCELADA"] as const;
const SENTIDO_FILTRO = ["TODAS", "FAVOR_CLIENTE", "FAVOR_EMPRESA"] as const;

/**
 * Linha unificada do extrato da Conta Corrente. Reúne, para exibição, dois
 * tipos de lançamento que hoje coexistem na mesma conta do cliente:
 *  - PENDENCIA: diferença pós-pagamento (public.conta_corrente_pendencias);
 *  - AJUSTE: lançamento manual avulso (movimento_credito origem=AJUSTE).
 * Não é uma nova estrutura de dados — apenas a junção de duas fontes já
 * existentes para leitura na tela.
 */
type LinhaExtrato =
  | { kind: "PENDENCIA"; created_at: string; direcao: "FAVOR_CLIENTE" | "FAVOR_EMPRESA"; pendencia: ContaCorrentePendencia }
  | { kind: "AJUSTE"; created_at: string; direcao: "FAVOR_CLIENTE" | "FAVOR_EMPRESA"; ajuste: AjusteManualConta }
  // USO: consumo do crédito avulso (movimento_credito USO_PEDIDO sem
  // pendência). Sempre saída da conta do cliente, por isso FAVOR_EMPRESA.
  | { kind: "USO"; created_at: string; direcao: "FAVOR_EMPRESA"; uso: UsoCreditoConta };

function formatCurrency(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
  const [ajustes, setAjustes] = useState<AjusteManualConta[]>([]);
  const [usos, setUsos] = useState<UsoCreditoConta[]>([]);
  const [saldoGlobal, setSaldoGlobal] = useState<SaldoGlobalContaCorrente | null>(null);
  const [nomesCliente, setNomesCliente] = useState<Record<number, string>>({});
  const [nomesAutor, setNomesAutor] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);

  // Filtros na URL: sobrevivem ao F5, ao histórico do navegador e a um link copiado.
  const filtrosSchema = useMemo(
    () => ({
      q: { codec: codecs.texto(), default: "" },
      status: { codec: codecs.enumOf(STATUS_FILTRO), default: "TODAS" as const },
      sentido: { codec: codecs.enumOf(SENTIDO_FILTRO), default: "TODAS" as const }
    }),
    []
  );
  const { filters, setFilter } = useUrlFilters(filtrosSchema);

  const statusFiltro = filters.status;
  const direcaoFiltro = filters.sentido;
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
      const [{ data: pends }, ajustesManuais, usosCredito, saldo] = await Promise.all([
        listAllPendencias({ limit: 500 }),
        listAjustesManuais({ limit: 500 }),
        listUsosDeCredito({ limit: 500 }),
        getSaldoGlobalContaCorrente(),
      ]);
      setPendencias(pends);
      setAjustes(ajustesManuais);
      setUsos(usosCredito);
      setSaldoGlobal(saldo);

      // Resolve nomes de cliente e autor (ajustes + usos) em lote.
      const client = getSupabaseClient();
      const idsCliente = Array.from(
        new Set(
          [
            ...pends.map((p) => p.id_cliente),
            ...ajustesManuais.map((a) => a.id_cliente),
            ...usosCredito.map((u) => u.id_cliente),
          ].filter(Boolean)
        )
      );
      const uidsAutor = Array.from(
        new Set([...ajustesManuais.map((a) => a.created_by), ...usosCredito.map((u) => u.created_by)].filter(Boolean))
      ) as string[];

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
      console.error("[ContaCorrentePage] Erro ao carregar Conta Corrente:", err);
      showToast({ type: "error", title: "Erro ao carregar a Conta Corrente." });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void carregar(); }, [carregar]);

  const filtradas = useMemo<LinhaExtrato[]>(() => {
    const linhas: LinhaExtrato[] = [
      ...pendencias.map((p): LinhaExtrato => ({ kind: "PENDENCIA", created_at: p.created_at, direcao: p.direcao, pendencia: p })),
      ...ajustes.map((a): LinhaExtrato => ({
        kind: "AJUSTE",
        created_at: a.created_at,
        direcao: a.tipo === "CREDITO" ? "FAVOR_CLIENTE" : "FAVOR_EMPRESA",
        ajuste: a,
      })),
      ...usos.map((u): LinhaExtrato => ({
        kind: "USO",
        created_at: u.created_at,
        direcao: "FAVOR_EMPRESA",
        uso: u,
      })),
    ];

    return linhas
      .filter((linha) => {
        // Filtro de status: ajustes manuais não têm status de pendência.
        // Só aparecem quando o filtro é "TODAS" (não há sentido em filtrá-los
        // por ABERTA/RESOLVIDA etc.).
        if (statusFiltro !== "TODAS") {
          if (linha.kind !== "PENDENCIA" || linha.pendencia.status !== statusFiltro) return false;
        }
        if (direcaoFiltro !== "TODAS" && linha.direcao !== direcaoFiltro) return false;
        if (searchTerm.trim()) {
          const t = searchTerm.trim().toLowerCase();
          const idCliente =
            linha.kind === "PENDENCIA" ? linha.pendencia.id_cliente
            : linha.kind === "AJUSTE" ? linha.ajuste.id_cliente
            : linha.uso.id_cliente;
          const nomeCliente = nomesCliente[idCliente] ?? "";
          const alvo =
            linha.kind === "PENDENCIA"
              ? `${linha.pendencia.id_int} ${linha.pendencia.id_cliente} ${nomeCliente} ${linha.pendencia.motivo} ${linha.pendencia.observacao ?? ""}`
              : linha.kind === "AJUSTE"
                ? `ajuste manual ${linha.ajuste.id_cliente} ${nomeCliente} ${linha.ajuste.observacao ?? ""}`
                : `uso de credito ${linha.uso.id_int_destino ?? ""} ${linha.uso.id_cliente} ${nomeCliente} ${linha.uso.observacao ?? ""}`;
          if (!alvo.toLowerCase().includes(t)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [pendencias, ajustes, usos, nomesCliente, statusFiltro, direcaoFiltro, searchTerm]);

  const totais = useMemo(() => {
    const abertas = pendencias.filter(p => p.status === "ABERTA" || p.status === "PARCIALMENTE_RESOLVIDA");
    const totalCredito = abertas.filter(p => p.direcao === "FAVOR_CLIENTE").reduce((s, p) => s + p.valor_saldo, 0);
    const totalDebito = abertas.filter(p => p.direcao === "FAVOR_EMPRESA").reduce((s, p) => s + p.valor_saldo, 0);
    const reservado = abertas.reduce((s, p) => s + p.valor_reservado, 0);
    return { totalCredito, totalDebito, reservado, qtdAbertas: abertas.length };
  }, [pendencias]);

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
        <PageHeader title="Conta Corrente" subtitle="Pendências financeiras" />
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

      {/*
        Os dois primeiros cards saem de movimento_credito, a razão COMPLETA da
        conta corrente (pendências gravam ABERTURA lá; ajustes e usos também).
        Antes eles somavam só conta_corrente_pendencias e por isso ignoravam
        ajuste manual e uso de crédito — anunciavam crédito que já tinha sido
        gasto. O saldo é fechado cliente a cliente antes de somar: crédito de
        um cliente não abate débito de outro.

        O terceiro card deixou de ser "Reservado" (era R$ 0,00 desde sempre —
        reserva é mecanismo raro) e passou a ser a fila de pendências, com o
        reservado descrito na linha de baixo quando existir.
      */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          title="Crédito a favor dos clientes"
          value={formatCurrency(saldoGlobal?.totalCredito ?? 0)}
          description={
            saldoGlobal
              ? `${saldoGlobal.clientesComCredito} cliente(s) com saldo positivo — já descontados os usos${saldoGlobal.truncado ? " · parcial" : ""}`
              : "Calculando..."
          }
          icon={TrendingUp}
          tone="success"
        />
        <SummaryCard
          title="Débito a favor da empresa"
          value={formatCurrency(saldoGlobal?.totalDebito ?? 0)}
          description={saldoGlobal ? `${saldoGlobal.clientesComDebito} cliente(s) com saldo negativo` : "Calculando..."}
          icon={TrendingDown}
          tone="warning"
        />
        <SummaryCard
          title="Pendências em aberto"
          value={formatCurrency(totais.totalCredito + totais.totalDebito)}
          description={
            `${totais.qtdAbertas} pendência(s) — ${formatCurrency(totais.totalCredito)} ao cliente, ${formatCurrency(totais.totalDebito)} à empresa` +
            (totais.reservado > 0 ? ` · ${formatCurrency(totais.reservado)} reservado` : "")
          }
          icon={Wallet}
          tone="info"
        />
        <SummaryCard
          title="Crédito aplicado em pagamentos"
          value={formatCurrency(saldoGlobal?.totalUsos ?? 0)}
          description={saldoGlobal ? `${saldoGlobal.qtdUsos} uso(s) já abatido(s) em propostas` : "Calculando..."}
          icon={Coins}
          tone="special"
        />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por proposta, cliente, motivo ou observação..."
            className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm"
          />
        </div>
        <select value={statusFiltro} onChange={(e) => setFilter("status", e.target.value as (typeof STATUS_FILTRO)[number])} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
          <option value="TODAS">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={direcaoFiltro} onChange={(e) => setFilter("sentido", e.target.value as (typeof SENTIDO_FILTRO)[number])} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm">
          <option value="TODAS">Crédito e débito</option>
          <option value="FAVOR_CLIENTE">Só crédito (favor cliente)</option>
          <option value="FAVOR_EMPRESA">Só débito (favor empresa)</option>
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 p-16 text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Carregando lançamentos...
        </div>
      ) : filtradas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-16 text-center">
          <p className="text-sm font-semibold text-slate-600">Nenhum lançamento encontrado.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-xs font-bold uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3">Proposta</th>
                <th className="px-4 py-3">Direção</th>
                <th className="px-4 py-3">Motivo</th>
                <th className="px-4 py-3">Saldo</th>
                <th className="px-4 py-3">Reservado</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Criada em</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtradas.map((linha) => {
                // ── Uso do crédito (USO_PEDIDO sem pendência) ─────────────────
                // Contrapartida do ajuste: mostra onde o crédito foi gasto.
                if (linha.kind === "USO") {
                  const u = linha.uso;
                  const nomeCliente = nomesCliente[u.id_cliente] ?? `Cliente #${u.id_cliente}`;
                  const autor = u.created_by ? (nomesAutor[u.created_by] ?? "Usuário") : "—";
                  return (
                    <tr key={`uso-${u.id}`} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700">
                          Uso de crédito
                        </span>
                        <p className="mt-1 font-semibold text-slate-700">{nomeCliente}</p>
                        <p className="text-[10px] text-slate-400">Cliente #{u.id_cliente}</p>
                        {u.observacao ? (
                          <p className="mt-1 max-w-[260px] truncate text-[11px] text-slate-500" title={u.observacao}>{u.observacao}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">
                          Saiu da conta do cliente
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {u.id_int_destino ? (
                          <>
                            Aplicado na proposta{" "}
                            <Link href={`/orcamentos/${u.id_int_destino}?chat=open`} className="font-semibold text-sky-700 hover:underline">
                              #{u.id_int_destino}
                            </Link>
                          </>
                        ) : (
                          "Aplicado em pagamento"
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold text-rose-700">- {formatCurrency(u.valor)}</td>
                      <td className="px-4 py-3 text-slate-500">—</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">Aplicado</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {new Date(u.created_at).toLocaleDateString("pt-BR")}
                        <span className="block text-[10px] text-slate-400">por {autor}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-[10px] text-slate-400">Automático</td>
                    </tr>
                  );
                }

                // ── Lançamento manual avulso (origem=AJUSTE) ──────────────────
                if (linha.kind === "AJUSTE") {
                  const a = linha.ajuste;
                  const nomeCliente = nomesCliente[a.id_cliente] ?? `Cliente #${a.id_cliente}`;
                  const autor = a.created_by ? (nomesAutor[a.created_by] ?? "Usuário") : "—";
                  return (
                    <tr key={`ajuste-${a.id}`} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700">
                          Ajuste manual
                        </span>
                        <p className="mt-1 font-semibold text-slate-700">{nomeCliente}</p>
                        <p className="text-[10px] text-slate-400">Cliente #{a.id_cliente}</p>
                        {a.observacao ? (
                          <p className="mt-1 max-w-[260px] truncate text-[11px] text-slate-500" title={a.observacao}>{a.observacao}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-bold ${a.tipo === "CREDITO" ? "bg-teal-50 text-teal-700 border border-teal-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                          {a.tipo === "CREDITO" ? "Crédito ao cliente" : "Débito à empresa"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">Ajuste manual</td>
                      <td className="px-4 py-3 font-semibold">{formatCurrency(a.valor)}</td>
                      <td className="px-4 py-3 text-slate-500">—</td>
                      <td className="px-4 py-3">
                        {/* "Lançado", não "Ativo": esta linha é o MOVIMENTO de
                            entrada, com o valor original — não o saldo que
                            restou. "Ativo" (verde) se lia como "disponível" e
                            continuava verde depois do crédito ter sido gasto.
                            O saldo que sobrou está no card "Saldo real". */}
                        <span className="inline-flex rounded-lg border border-slate-200 bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">Lançado</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {new Date(a.created_at).toLocaleDateString("pt-BR")}
                        <span className="block text-[10px] text-slate-400">por {autor}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-[10px] text-slate-400">Gerido no cadastro</td>
                    </tr>
                  );
                }

                // ── Pendência financeira (conta_corrente_pendencias) ──────────
                const p = linha.pendencia;
                const utilizavel = p.status === "ABERTA" || p.status === "PARCIALMENTE_RESOLVIDA";
                const nomeCliente = nomesCliente[p.id_cliente];
                return (
                  <tr key={`pend-${p.id}`} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <Link href={`/orcamentos/${p.id_int}?chat=open`} className="font-semibold text-sky-700 hover:underline">
                        #{p.id_int}
                      </Link>
                      {nomeCliente ? <p className="text-[11px] text-slate-600">{nomeCliente}</p> : null}
                      <p className="text-[10px] text-slate-400">Cliente #{p.id_cliente}</p>
                      {p.observacao ? (
                        <p className="mt-1 max-w-[260px] truncate text-[11px] text-slate-500" title={p.observacao}>{p.observacao}</p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-lg px-2 py-1 text-xs font-bold ${p.direcao === "FAVOR_CLIENTE" ? "bg-teal-50 text-teal-700 border border-teal-200" : "bg-amber-50 text-amber-700 border border-amber-200"}`}>
                        {p.direcao === "FAVOR_CLIENTE" ? "Crédito ao cliente" : "Débito à empresa"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{MOTIVO_LABEL[p.motivo] ?? p.motivo}</td>
                    <td className="px-4 py-3 font-semibold">{formatCurrency(p.valor_saldo)}</td>
                    <td className="px-4 py-3 text-slate-500">{p.valor_reservado > 0 ? formatCurrency(p.valor_reservado) : "—"}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">
                        {STATUS_LABEL[p.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {new Date(p.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5 flex-wrap">
                        {utilizavel && p.direcao === "FAVOR_CLIENTE" && canDevolver && (
                          <button disabled={busy === p.id} onClick={() => abrirModal(p, "DEVOLUCAO")} className="rounded-lg bg-blue-50 border border-blue-200 text-blue-700 px-2 py-1 text-xs font-bold hover:bg-blue-100">Devolver</button>
                        )}
                        {utilizavel && p.direcao === "FAVOR_EMPRESA" && canBonificar && (
                          <button disabled={busy === p.id} onClick={() => abrirModal(p, "BONIFICACAO")} className="rounded-lg bg-purple-50 border border-purple-200 text-purple-700 px-2 py-1 text-xs font-bold hover:bg-purple-100">Bonificar</button>
                        )}
                        {utilizavel && p.direcao === "FAVOR_EMPRESA" && canResolver && (
                          <button disabled={busy === p.id} onClick={() => abrirModal(p, "BAIXA")} className="rounded-lg bg-sky-50 border border-sky-200 text-sky-700 px-2 py-1 text-xs font-bold hover:bg-sky-100">Baixar</button>
                        )}
                        {utilizavel && p.valor_reservado === 0 && canResolver && (
                          <button disabled={busy === p.id} onClick={() => abrirModal(p, "CANCELAMENTO")} className="rounded-lg bg-slate-100 border border-slate-200 text-slate-700 px-2 py-1 text-xs font-bold hover:bg-slate-200">Cancelar</button>
                        )}
                        {canEstornar && (p.status === "RESOLVIDA" || p.status === "PARCIALMENTE_RESOLVIDA") && (
                          <button disabled={busy === p.id} onClick={() => abrirModal(p, "ESTORNO")} className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-2 py-1 text-xs font-bold hover:bg-red-100">Estornar</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
                className="btn-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50"
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
