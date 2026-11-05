"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Loader2 } from "lucide-react";
import { fetchComSessao } from "@/lib/supabase/sessao";
import { formatDateTime } from "@/lib/formatters/date";
import {
  competenciaDaData,
  conferirPercentual,
  percentualParaTela,
  rotuloDaCompetencia
} from "@/features/nfse/lib/percentual-simples";

/**
 * Configurações → Empresas (05/11/2026): o percentual do Simples Nacional que
 * a NFS-e leva na Lei 12.741 (tag pTotTribSN), por empresa e por mês. O
 * financeiro lança o mês que o contador mandar; o histórico fica embaixo.
 * Lançar um mês que já existe corrige o valor (o anterior fica na auditoria).
 */

type Empresa = { id: number; nome: string; habilitaNfse: boolean };
type Linha = {
  id: number;
  id_empresa: number;
  competencia: string;
  percentual: number;
  observacao: string | null;
  criado_por_nome: string | null;
  created_at: string;
  atualizado_por_nome: string | null;
  updated_at: string;
};

type Lido = { ok: true; empresas: Empresa[]; percentuais: Linha[] } | { ok: false; mensagem: string };

/** Só lê: nenhum estado de tela aqui. */
async function lerPercentuais(): Promise<Lido> {
  try {
    const r = await fetchComSessao("/api/configuracoes/percentual-simples", { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.success) return { ok: false, mensagem: j?.message || `Falha ao ler (${r.status}).` };
    return { ok: true, empresas: j.empresas as Empresa[], percentuais: j.percentuais as Linha[] };
  } catch (e) {
    return { ok: false, mensagem: e instanceof Error ? e.message : "Falha ao ler." };
  }
}

const CAMPO =
  "w-full rounded-xl border px-3 py-2 text-sm text-foreground bg-transparent focus:outline-none focus:ring-2 focus:ring-blue-500";

export function PercentualSimplesPage() {
  const mesAtual = competenciaDaData(new Date());
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [idEmpresa, setIdEmpresa] = useState<number | null>(null);
  const [mes, setMes] = useState(rotuloDaCompetencia(mesAtual));
  const [percentual, setPercentual] = useState("");
  const [observacao, setObservacao] = useState("");

  const aplicar = useCallback((lido: Lido) => {
    if (lido.ok) {
      const lidas = lido.empresas;
      setEmpresas(lidas);
      setLinhas(lido.percentuais);
      setIdEmpresa((atual) => atual ?? lidas.find((e) => e.habilitaNfse)?.id ?? lidas[0]?.id ?? null);
      setErro(null);
    } else {
      setErro(lido.mensagem);
    }
    setCarregando(false);
  }, []);

  const carregar = useCallback(async () => aplicar(await lerPercentuais()), [aplicar]);

  useEffect(() => {
    let vivo = true;
    lerPercentuais().then((lido) => {
      if (vivo) aplicar(lido);
    });
    return () => {
      vivo = false;
    };
  }, [aplicar]);

  const conferido = conferirPercentual(percentual);
  const doMesNaEmpresa = useMemo(
    () => linhas.find((l) => l.id_empresa === idEmpresa && rotuloDaCompetencia(l.competencia) === mes.trim()),
    [linhas, idEmpresa, mes]
  );

  async function salvar() {
    if (idEmpresa == null || !conferido.ok) return;
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const r = await fetchComSessao("/api/configuracoes/percentual-simples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_empresa: idEmpresa, competencia: mes, percentual, observacao })
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.success) throw new Error(j?.message || `Falha ao gravar (${r.status}).`);
      const nome = empresas.find((e) => e.id === idEmpresa)?.nome ?? `Empresa ${idEmpresa}`;
      setAviso(`${nome}, ${mes}: ${percentualParaTela(conferido.valor)} ${j.corrigido ? "corrigido" : "cadastrado"}.`);
      setPercentual("");
      setObservacao("");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gravar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 py-6 px-4">
      <div className="border-b pb-5" style={{ borderColor: "var(--border)" }}>
        <Link href="/configuracoes" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Configurações
        </Link>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 dark:bg-neutral-900 text-foreground">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Empresas: percentual do Simples</h1>
            <p className="text-sm mt-0.5 text-muted-foreground">
              Total aproximado dos tributos (Lei 12.741) que sai na NFS-e. Um percentual por empresa e por mês, informado pelo contador.
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-3xl border p-5 space-y-4" style={{ borderColor: "var(--border)", background: "var(--card, white)" }} data-form-percentual>
        <h2 className="text-base font-bold text-foreground">Lançar ou corrigir um mês</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="space-y-1 text-xs font-semibold text-muted-foreground sm:col-span-2">
            Empresa
            <select
              className={CAMPO}
              style={{ borderColor: "var(--border)" }}
              value={idEmpresa ?? ""}
              onChange={(e) => setIdEmpresa(Number(e.target.value) || null)}
              disabled={carregando || salvando}
              id="percentual-empresa"
            >
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-semibold text-muted-foreground">
            Mês (MM/AAAA)
            <input className={CAMPO} style={{ borderColor: "var(--border)" }} value={mes} onChange={(e) => setMes(e.target.value)} placeholder="11/2026" id="percentual-mes" disabled={salvando} />
          </label>
          <label className="space-y-1 text-xs font-semibold text-muted-foreground">
            Percentual (%)
            <input className={CAMPO} style={{ borderColor: "var(--border)" }} value={percentual} onChange={(e) => setPercentual(e.target.value)} placeholder="15,20" inputMode="decimal" id="percentual-valor" disabled={salvando} />
          </label>
          <label className="space-y-1 text-xs font-semibold text-muted-foreground sm:col-span-4">
            Observação (opcional)
            <input className={CAMPO} style={{ borderColor: "var(--border)" }} value={observacao} onChange={(e) => setObservacao(e.target.value)} placeholder="Ex.: número enviado pelo contador em 05/11" maxLength={500} disabled={salvando} />
          </label>
        </div>
        {percentual.trim() !== "" && !conferido.ok && <p className="text-xs font-semibold text-red-600">{conferido.mensagem}</p>}
        {doMesNaEmpresa && (
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400" data-aviso-corrige>
            Este mês já tem {percentualParaTela(doMesNaEmpresa.percentual)}. Gravar corrige o valor; o anterior fica registrado.
          </p>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void salvar()}
            disabled={salvando || carregando || idEmpresa == null || !conferido.ok}
            className="inline-flex items-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />}
            {doMesNaEmpresa ? "Corrigir percentual" : "Gravar percentual"}
          </button>
          <p className="text-xs text-muted-foreground">A NFS-e usa o percentual do mês da emissão. Sem o mês cadastrado, a nota não é emitida.</p>
        </div>
        {aviso && <p role="status" className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">{aviso}</p>}
        {erro && <p role="alert" className="text-sm font-semibold text-red-600">{erro}</p>}
      </section>

      {carregando ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
        </p>
      ) : (
        empresas.map((empresa) => {
          const daEmpresa = linhas.filter((l) => l.id_empresa === empresa.id);
          const temMesAtual = daEmpresa.some((l) => l.competencia.slice(0, 10) === mesAtual);
          return (
            <section key={empresa.id} className="rounded-3xl border p-5" style={{ borderColor: "var(--border)", background: "var(--card, white)" }} data-historico-empresa={empresa.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-bold text-foreground">{empresa.nome}</h2>
                <span className={`text-xs font-semibold ${temMesAtual ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}`}>
                  {temMesAtual ? `${rotuloDaCompetencia(mesAtual)} cadastrado` : `Sem percentual para ${rotuloDaCompetencia(mesAtual)}: a NFS-e não sai`}
                </span>
              </div>
              {daEmpresa.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Nenhum mês cadastrado.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-muted-foreground">
                        <th className="py-2 pr-3">Mês</th>
                        <th className="py-2 pr-3">Percentual</th>
                        <th className="py-2 pr-3">Observação</th>
                        <th className="py-2">Última alteração</th>
                      </tr>
                    </thead>
                    <tbody>
                      {daEmpresa.map((l) => (
                        <tr key={l.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                          <td className="py-2 pr-3 font-semibold text-foreground">{rotuloDaCompetencia(l.competencia)}</td>
                          <td className="py-2 pr-3 text-foreground">{percentualParaTela(l.percentual)}</td>
                          <td className="py-2 pr-3 text-muted-foreground">{l.observacao || "-"}</td>
                          <td className="py-2 text-muted-foreground">
                            {formatDateTime(l.updated_at)} · {l.atualizado_por_nome || l.criado_por_nome || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
