"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, PackageCheck } from "lucide-react";
import { fetchComSessao } from "@/lib/supabase/sessao";
import { formatCurrency } from "@/lib/formatters/currency";
import { hojeSP } from "@/lib/period";

type Grupo = { grupo: "AVULSA" | "NAO_AVULSA"; qtd: number; soma: number };
type Item = {
  id_int: number;
  grupo: "AVULSA" | "NAO_AVULSA";
  cliente: string | null;
  id_cliente: number | null;
  ultimo_paid_at: string;
  valor_total: number | null;
};
type Previa = { data_corte: string; total: number; soma: number; grupos: Grupo[]; itens: Item[] };
type Resultado = { lote?: string; total: number; alterados: number[] };

const NOME_GRUPO: Record<Grupo["grupo"], string> = {
  AVULSA: "Pedidos avulsos",
  NAO_AVULSA: "Pedidos que não entraram na produção"
};

const LIMITE_LISTA = 300;

function dataHora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function dataCurta(iso: string) {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

async function chamar(corpo: Record<string, unknown>) {
  const resposta = await fetchComSessao("/api/admin/encerrar-pedidos-pagos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo)
  });
  const json = await resposta.json().catch(() => null);
  if (!resposta.ok || !json?.success) {
    throw new Error(json?.error || `Falha (${resposta.status}).`);
  }
  return json.data;
}

/**
 * Encerrar pedidos pagos (transição). Três passos: data de corte → prévia →
 * confirmação. Nada é gravado antes da confirmação, e a confirmação só vale
 * para a quantidade mostrada na prévia (o servidor recusa se a lista mudou).
 */
export function EncerrarPedidosPagosPage() {
  const hoje = hojeSP();
  const [dataCorte, setDataCorte] = useState(hoje);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function gerarPrevia() {
    setCarregando(true);
    setErro(null);
    setResultado(null);
    setConfirmando(false);
    try {
      setPrevia((await chamar({ dataCorte })) as Previa);
    } catch (e) {
      setPrevia(null);
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  async function aplicar() {
    if (!previa) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = (await chamar({ dataCorte: previa.data_corte, aplicar: true, qtdEsperada: previa.total })) as Resultado;
      setResultado(r);
      setPrevia(null);
      setConfirmando(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setConfirmando(false);
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 py-6 px-4">
      <div className="border-b pb-5" style={{ borderColor: "var(--border)" }}>
        <Link
          href="/configuracoes"
          className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400"
        >
          <ArrowLeft className="h-3 w-3" /> Configurações
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-900 text-foreground">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Encerrar pedidos pagos (transição)</h1>
            <p className="text-sm mt-0.5 text-muted-foreground">
              Passa para ENTREGUE os pedidos já pagos que continuam em LIBERADO. A data de status de cada
              pedido é mantida, e uma cópia de antes fica guardada para permitir a volta.
            </p>
          </div>
        </div>
      </div>

      <section
        className="rounded-3xl border p-5 space-y-3"
        style={{ borderColor: "var(--border)", background: "var(--card)" }}
      >
        <p className="text-sm font-semibold text-foreground">1. Data de corte</p>
        <p className="text-xs text-muted-foreground">
          Entram os pedidos cujo último pagamento foi antes da meia-noite desta data (horário de Brasília):
          pedidos avulsos, e pedidos que nunca entraram na produção nem na expedição. O cliente de teste e
          os pedidos sem pagamento ficam sempre de fora.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="date"
            value={dataCorte}
            max={hoje}
            onChange={(e) => {
              setDataCorte(e.target.value);
              setPrevia(null);
              setConfirmando(false);
            }}
            className="rounded-xl border px-3 py-2 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--background)", color: "var(--foreground)" }}
          />
          <button
            type="button"
            onClick={() => void gerarPrevia()}
            disabled={carregando || !dataCorte}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {carregando && !previa ? "Calculando…" : "Ver prévia"}
          </button>
        </div>
      </section>

      {erro ? (
        <div className="rounded-2xl p-4 text-sm ring-1 bg-rose-50 text-rose-800 ring-rose-200 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-800">
          {erro}
        </div>
      ) : null}

      {resultado ? (
        <div className="rounded-2xl p-4 text-sm ring-1 bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:ring-emerald-800">
          {resultado.total === 0
            ? "Nenhum pedido para encerrar."
            : `${resultado.total} pedido(s) encerrado(s). Lote ${resultado.lote} — a cópia de antes está guardada com este número.`}
        </div>
      ) : null}

      {previa ? (
        <section
          className="rounded-3xl border p-5 space-y-4"
          style={{ borderColor: "var(--border)", background: "var(--card)" }}
        >
          <p className="text-sm font-semibold text-foreground">
            2. Prévia — pagos antes de {dataCurta(previa.data_corte)}
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            {(["AVULSA", "NAO_AVULSA"] as const).map((g) => {
              const grupo = previa.grupos.find((x) => x.grupo === g);
              return (
                <div key={g} className="rounded-2xl border p-4" style={{ borderColor: "var(--border)" }}>
                  <p className="text-xs text-muted-foreground">{NOME_GRUPO[g]}</p>
                  <p className="text-2xl font-bold text-foreground">{grupo?.qtd ?? 0}</p>
                  <p className="text-sm text-muted-foreground">{formatCurrency(Number(grupo?.soma ?? 0))}</p>
                </div>
              );
            })}
            <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)" }}>
              <p className="text-xs text-muted-foreground">Total</p>
              <p className="text-2xl font-bold text-foreground">{previa.total}</p>
              <p className="text-sm text-muted-foreground">{formatCurrency(Number(previa.soma))}</p>
            </div>
          </div>

          {previa.total > 0 ? (
            <div className="max-h-96 overflow-auto rounded-2xl border" style={{ borderColor: "var(--border)" }}>
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2">Pedido</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">Último pagamento</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {previa.itens.slice(0, LIMITE_LISTA).map((i) => (
                    <tr key={i.id_int} className="border-t text-foreground" style={{ borderColor: "var(--border)" }}>
                      <td className="px-3 py-1.5 font-semibold">#{i.id_int}</td>
                      <td className="px-3 py-1.5">{i.grupo === "AVULSA" ? "Avulso" : "Sem produção"}</td>
                      <td className="px-3 py-1.5">{i.cliente || "—"}</td>
                      <td className="px-3 py-1.5">{dataHora(i.ultimo_paid_at)}</td>
                      <td className="px-3 py-1.5 text-right">{formatCurrency(Number(i.valor_total ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {previa.itens.length > LIMITE_LISTA ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Mostrando {LIMITE_LISTA} de {previa.itens.length}. Todos entram no encerramento.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nenhum pedido pago antes dessa data está em LIBERADO.</p>
          )}

          {previa.total > 0 ? (
            <div className="space-y-3 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <p className="text-sm font-semibold text-foreground">3. Confirmar</p>
              {!confirmando ? (
                <button
                  type="button"
                  onClick={() => setConfirmando(true)}
                  disabled={carregando}
                  className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Encerrar {previa.total} pedido(s)
                </button>
              ) : (
                <div className="space-y-3 rounded-2xl p-4 ring-1 bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-100 dark:ring-amber-800">
                  <p className="text-sm">
                    {previa.total} pedido(s), somando {formatCurrency(Number(previa.soma))}, vão para ENTREGUE e
                    saem da lista padrão de Pedidos. Confirma?
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void aplicar()}
                      disabled={carregando}
                      className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {carregando ? "Encerrando…" : "Sim, encerrar"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmando(false)}
                      disabled={carregando}
                      className="rounded-xl border px-4 py-2 text-sm font-semibold"
                      style={{ borderColor: "var(--border)" }}
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
