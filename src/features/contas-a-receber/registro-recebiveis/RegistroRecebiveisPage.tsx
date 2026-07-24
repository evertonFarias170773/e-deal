"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, FileText, RefreshCw, Search, Wallet, X } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { ResponsiveList } from "@/components/common/ResponsiveList";
import { SummaryCard } from "@/components/common/SummaryCard";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { formatCurrency } from "@/lib/formatters/currency";
import { PrepararBoletosModal } from "@/features/cobrancas/PrepararBoletosModal";
import { getRecebiveisParaRegistro } from "./services/registro-recebiveis.service";
import type { RecebivelParaRegistro } from "./types";

const filterClass =
  "rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none w-full";

// Datas de vencimento chegam como "YYYY-MM-DD"; formatar sem new Date evita
// deslocamento de um dia pelo fuso America/Sao_Paulo.
function formatDateBrFromIso(dateStr: string): string {
  const [year, month, day] = dateStr.slice(0, 10).split("-");
  if (!year || !month || !day) return dateStr;
  return `${day}/${month}/${year}`;
}

type SituacaoRecebivel = "PRONTO" | "POSSUI_TITULOS" | "EMPRESA_INDEFINIDA";

const situacaoConfig: Record<SituacaoRecebivel, { label: string; className: string }> = {
  PRONTO: {
    label: "Pronto para registro",
    className:
      "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-900/30 dark:text-teal-300"
  },
  POSSUI_TITULOS: {
    label: "Já possui títulos",
    className:
      "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
  },
  EMPRESA_INDEFINIDA: {
    label: "Empresa a definir",
    className:
      "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
  }
};

function resolveSituacao(item: RecebivelParaRegistro): SituacaoRecebivel {
  if (item.possuiBoletos) {
    return "POSSUI_TITULOS";
  }
  if (item.empresaIndefinida) {
    return "EMPRESA_INDEFINIDA";
  }
  return "PRONTO";
}

function SituacaoBadge({ item }: { item: RecebivelParaRegistro }) {
  const config = situacaoConfig[resolveSituacao(item)];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function resolveCondicao(item: RecebivelParaRegistro): string {
  const forma = (item.cobranca.forma_fatu || "").trim();
  const plano = item.plano;
  const resumoPlano = plano
    ? `${plano.qtdParcelas}x · início ${plano.diasPraInicio}d${plano.qtdParcelas > 1 ? ` · intervalo ${plano.intervalo}d` : ""}`
    : "";

  if (forma && resumoPlano) {
    return `${forma} · ${resumoPlano}`;
  }
  return forma || resumoPlano || "Não informada";
}

function resolveBloqueio(item: RecebivelParaRegistro, podeGerar: boolean): string | null {
  if (item.possuiBoletos) {
    return "Já existem títulos não cancelados para esta OS no Contas a Receber.";
  }
  if (item.empresaIndefinida) {
    return "Empresa recebedora indefinida. Regularize a empresa da cobrança antes de gerar os títulos.";
  }
  if (!podeGerar) {
    return "Você não possui a permissão cobrancas.emitir_boleto.";
  }
  return null;
}

export function RegistroRecebiveisPage() {
  const { user } = useAuth();
  const [itens, setItens] = useState<RecebivelParaRegistro[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [empresaFilter, setEmpresaFilter] = useState("TODAS");
  const [selecionado, setSelecionado] = useState<RecebivelParaRegistro | null>(null);

  const podeGerar = Boolean(
    user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "cobrancas.emitir_boleto")
  );

  const [reloadKey, setReloadKey] = useState(0);

  const recarregar = useCallback(() => {
    setIsLoading(true);
    setReloadKey((prev) => prev + 1);
  }, []);

  useEffect(() => {
    let active = true;

    void getRecebiveisParaRegistro().then((result) => {
      if (!active) {
        return;
      }
      setItens(result.itens);
      setErrorMessage(result.errorMessage);
      setIsLoading(false);
    });

    return () => {
      active = false;
    };
  }, [reloadKey]);

  const empresas = useMemo(() => {
    const set = new Set(itens.map((item) => item.cobranca.empresa).filter(Boolean));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [itens]);

  const filtrados = useMemo(() => {
    const termo = searchTerm.trim().toLowerCase();
    const termoDigits = termo.replace(/\D/g, "");

    return itens.filter((item) => {
      const { cobranca } = item;

      if (empresaFilter !== "TODAS" && cobranca.empresa !== empresaFilter) {
        return false;
      }

      if (!termo) {
        return true;
      }

      const matchCliente = cobranca.cliente.toLowerCase().includes(termo);
      const matchOs =
        String(cobranca.os_ideal || "").includes(termo) ||
        String(cobranca.id_int || "").includes(termo);
      const matchDocumento = Boolean(termoDigits) && cobranca.documento.includes(termoDigits);

      return matchCliente || matchOs || matchDocumento;
    });
  }, [itens, searchTerm, empresaFilter]);

  const totalValor = useMemo(
    () => itens.reduce((acc, item) => acc + (Number(item.cobranca.valor) || 0), 0),
    [itens]
  );
  const totalBloqueados = useMemo(
    () => itens.filter((item) => item.possuiBoletos || item.empresaIndefinida).length,
    [itens]
  );

  const hasFiltros = searchTerm.trim() !== "" || empresaFilter !== "TODAS";

  const handleLimparFiltros = () => {
    setSearchTerm("");
    setEmpresaFilter("TODAS");
  };

  const handleAbrirModal = (item: RecebivelParaRegistro) => {
    if (resolveBloqueio(item, podeGerar)) {
      return;
    }
    setSelecionado(item);
  };

  const handleFecharModal = () => {
    setSelecionado(null);
    recarregar();
  };

  const renderAcao = (item: RecebivelParaRegistro) => {
    const bloqueio = resolveBloqueio(item, podeGerar);

    return (
      <button
        type="button"
        onClick={() => handleAbrirModal(item)}
        disabled={Boolean(bloqueio)}
        title={bloqueio ?? "Gerar títulos no Contas a Receber"}
        className="inline-flex items-center gap-2 rounded-2xl bg-teal-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
      >
        <FileText className="h-4 w-4" />
        Gerar títulos
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        context="Contas a Receber"
        title="Registro de recebíveis"
        subtitle="Cobranças E-Faturado aprovadas pelo financeiro que ainda não possuem títulos no Contas a Receber. Gere os boletos ou registre como depósito em conta."
        action={
          <button
            type="button"
            onClick={recarregar}
            className="inline-flex items-center gap-2 rounded-2xl bg-white/15 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/25"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          title="Valor total a registrar"
          value={formatCurrency(totalValor)}
          description="Soma das cobranças pendentes de lançamento."
          tone="info"
          icon={Wallet}
        />
        <SummaryCard
          title="Registros pendentes"
          value={String(itens.length)}
          description="Cobranças E-Faturado aguardando geração de títulos."
          tone="warning"
          icon={FileText}
        />
        <SummaryCard
          title="Bloqueados"
          value={String(totalBloqueados)}
          description="Com títulos existentes ou empresa a definir."
          tone={totalBloqueados > 0 ? "danger" : "neutral"}
          icon={AlertTriangle}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-[2fr_1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Buscar por cliente, OS ou CPF/CNPJ"
            className={`${filterClass} pl-11`}
          />
        </div>
        <select
          value={empresaFilter}
          onChange={(event) => setEmpresaFilter(event.target.value)}
          className={filterClass}
        >
          <option value="TODAS">Todas as empresas</option>
          {empresas.map((empresa) => (
            <option key={empresa} value={empresa}>
              {empresa}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleLimparFiltros}
          disabled={!hasFiltros}
          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <X className="h-4 w-4" />
          Limpar filtros
        </button>
      </div>

      {errorMessage ? (
        <div className="flex flex-col items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={recarregar}
            className="rounded-2xl bg-red-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-700"
          >
            Tentar novamente
          </button>
        </div>
      ) : (
        <ResponsiveList
          items={filtrados}
          isLoading={isLoading}
          getKey={(item) => item.cobranca.id}
          emptyTitle={
            hasFiltros
              ? "Nenhum resultado com os filtros atuais."
              : "Nenhum recebível pendente de registro."
          }
          emptyDescription={
            hasFiltros
              ? "Tente limpar os filtros ou alterar a busca."
              : "Todas as cobranças E-Faturado aprovadas já possuem títulos no Contas a Receber."
          }
          columns={[
            {
              header: "OS / Ref",
              cell: (item) => (
                <div className="flex flex-col">
                  <span className="font-semibold">
                    {item.cobranca.os_ideal || item.cobranca.id_int || "-"}
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    Proposta {item.cobranca.id_int || "-"}
                  </span>
                </div>
              )
            },
            {
              header: "Cliente",
              cell: (item) => (
                <div className="flex flex-col">
                  <span className="font-medium">{item.cobranca.cliente}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {item.cobranca.documento !== "-" ? item.cobranca.documento : "Documento não informado"}
                  </span>
                </div>
              )
            },
            {
              header: "Empresa",
              cell: (item) =>
                item.empresaIndefinida ? (
                  <span className="inline-flex items-center rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-700 dark:border-orange-800 dark:bg-orange-900/30 dark:text-orange-300">
                    A definir
                  </span>
                ) : (
                  <span>{item.cobranca.empresa}</span>
                )
            },
            {
              header: "Condição",
              cell: (item) => <span className="text-xs">{resolveCondicao(item)}</span>
            },
            {
              header: "Valor",
              align: "right",
              cell: (item) => (
                <span className="font-semibold">{formatCurrency(item.cobranca.valor)}</span>
              )
            },
            {
              header: "Vencimento previsto",
              align: "center",
              cell: (item) =>
                item.cobranca.vencimento ? (
                  <span>{formatDateBrFromIso(item.cobranca.vencimento)}</span>
                ) : (
                  <span style={{ color: "var(--muted)" }}>A definir</span>
                )
            },
            {
              header: "Situação",
              align: "center",
              cell: (item) => <SituacaoBadge item={item} />
            },
            {
              header: "Ações",
              align: "right",
              cell: (item) => renderAcao(item)
            }
          ]}
          renderCard={(item) => (
            <article
              key={item.cobranca.id}
              className="flex flex-col gap-3 rounded-2xl p-5 shadow-sm"
              style={{ background: "var(--card)", border: "1px solid var(--border)" }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col">
                  <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                    OS {item.cobranca.os_ideal || item.cobranca.id_int || "-"}
                  </span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    Proposta {item.cobranca.id_int || "-"}
                  </span>
                </div>
                <SituacaoBadge item={item} />
              </div>
              <div className="flex flex-col gap-1 text-sm" style={{ color: "var(--foreground)" }}>
                <span className="font-medium">{item.cobranca.cliente}</span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {item.empresaIndefinida ? "Empresa a definir" : item.cobranca.empresa}
                </span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {resolveCondicao(item)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold" style={{ color: "var(--foreground)" }}>
                  {formatCurrency(item.cobranca.valor)}
                </span>
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {item.cobranca.vencimento
                    ? `Vence em ${formatDateBrFromIso(item.cobranca.vencimento)}`
                    : "Vencimento a definir"}
                </span>
              </div>
              <div className="flex justify-end">{renderAcao(item)}</div>
            </article>
          )}
        />
      )}

      {selecionado ? (
        <PrepararBoletosModal
          key={selecionado.cobranca.id}
          isOpen
          onClose={handleFecharModal}
          cobranca={selecionado.cobranca}
          onSuccess={() => undefined}
          defaultQtdParcelas={selecionado.plano?.qtdParcelas}
          defaultDiasPraInicio={selecionado.plano?.diasPraInicio}
          defaultIntervalo={selecionado.plano?.intervalo}
        />
      ) : null}
    </div>
  );
}
