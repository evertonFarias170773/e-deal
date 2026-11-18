"use client";

/**
 * DIFERENCA DE FRETE DO REENVIO, na aba Pagamentos (fase 2B, 18/11/2026).
 *
 * O reenvio de pedido devolvido grava no ciclo a diferenca de frete (frete novo
 * maior que o do envio anterior). Ela NAO entra no total da proposta nem no
 * pago: vira uma cobranca PIX propria, marcada com `chave_reenvio` (uma viva
 * por ciclo), ou um abono de administrador. O Despachar do reenvio so libera
 * com a diferenca paga ou abonada (`exp_saldo_despacho`).
 *
 *   - "Gerar PIX da diferenca": `exp_reenvio_cobrar_diferenca` cria a linha
 *     (so o banco marca a cobranca) e o QR sai por /api/cobrancas/gerar-pix,
 *     o mesmo caminho do "gerar de novo" das outras cobrancas.
 *   - "Abonar": `exp_reenvio_abonar_diferenca`, so administrador, com motivo;
 *     recusada se ja houver cobranca viva do ciclo.
 *
 * Sem ciclo com diferenca, o quadro nao aparece.
 */
import { useCallback, useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { formatCurrency } from "@/lib/formatters/currency";
import { getSupabaseClient } from "@/lib/supabase/client";
import { montarUrlPublicaCobranca } from "@/features/cobrancas/cobrancas-utils";
import type { SituacaoCicloReenvio } from "@/features/expedicao/lib/reenvio";
import {
  abonarDiferencaDoReenvio,
  cobrarDiferencaDoReenvio,
  lerSituacaoDosReenvios
} from "@/features/expedicao/services/reenvio.client";

export type GerarPixDaCobranca = (
  cobrancaId: string,
  idPagamento: string | null,
  idEmpresa: number,
  valor: number
) => Promise<{ success: boolean; error?: string }>;

/** O link publico, como o provider grava nas outras cobrancas (o token vem do gatilho). */
async function gravarLinkPublico(cobrancaId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  const { data } = await client
    .from("pagamentos_v2")
    .select("token_publico, url_cobranca, tipo_cobranca")
    .eq("id", cobrancaId)
    .maybeSingle<{ token_publico: string | null; url_cobranca: string | null; tipo_cobranca: string | null }>();
  if (!data || data.url_cobranca) return;
  const tokenPublico = data.token_publico || cobrancaId.split("-")[0];
  const url = montarUrlPublicaCobranca({ tipoCobranca: data.tipo_cobranca, tokenPublico });
  const { error } = await client
    .from("pagamentos_v2")
    .update({ token_publico: tokenPublico, url_cobranca: url })
    .eq("id", cobrancaId)
    .is("url_cobranca", null);
  if (error) console.warn("[reenvio] Falha ao gravar o link da cobranca:", error.message);
}

export function DiferencaFreteReenvioBox({
  idInt,
  gerarPix,
  onMudou
}: {
  idInt: number;
  gerarPix: GerarPixDaCobranca;
  onMudou: () => void | Promise<void>;
}) {
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const podeCobrar = Boolean(user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "cobrancas.create"));
  const podeAbonar = Boolean(user?.isSuperAdmin || user?.isAdmin);

  const [ciclos, setCiclos] = useState<SituacaoCicloReenvio[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [abonando, setAbonando] = useState<string | null>(null);
  const [motivoAbono, setMotivoAbono] = useState("");

  const recarregar = useCallback(async () => {
    setCiclos((await lerSituacaoDosReenvios(idInt)).filter((c) => c.diferenca > 0));
  }, [idInt]);

  useEffect(() => {
    let vivo = true;
    void lerSituacaoDosReenvios(idInt).then((lista) => {
      if (vivo) setCiclos(lista.filter((c) => c.diferenca > 0));
    });
    return () => {
      vivo = false;
    };
  }, [idInt]);

  async function gerarQr(c: { id: string; idPagamento: string | null; idEmpresa: number | null; valor: number }) {
    if (!c.idEmpresa) {
      showToast({ type: "error", title: "PIX não gerado", description: "A cobrança está sem empresa recebedora." });
      return false;
    }
    await gravarLinkPublico(c.id);
    const res = await gerarPix(c.id, c.idPagamento, c.idEmpresa, c.valor);
    if (!res.success) {
      showToast({ type: "error", title: "Cobrança criada, PIX não gerado", description: res.error || "Tente gerar o QR de novo." });
      return false;
    }
    return true;
  }

  async function handleCobrar(ciclo: SituacaoCicloReenvio) {
    setOcupado(ciclo.chave);
    try {
      const criada = await cobrarDiferencaDoReenvio(ciclo.chave);
      if (!criada.success) {
        showToast({ type: "error", title: "PIX da diferença não criado", description: criada.error });
        return;
      }
      const ok = await gerarQr({ id: criada.id, idPagamento: criada.idPagamento, idEmpresa: criada.idEmpresa, valor: criada.valor });
      if (ok) {
        showToast({
          type: "success",
          title: "PIX da diferença gerado",
          description: `${criada.idPagamento ?? "Cobrança"} de ${formatCurrency(criada.valor)}. O Despachar libera quando o pagamento for confirmado.`
        });
      }
    } finally {
      setOcupado(null);
      await recarregar();
      await onMudou();
    }
  }

  async function handleGerarQrDeNovo(ciclo: SituacaoCicloReenvio) {
    const viva = ciclo.cobrancaViva;
    if (!viva) return;
    setOcupado(ciclo.chave);
    try {
      const ok = await gerarQr({ id: viva.id, idPagamento: viva.idPagamento, idEmpresa: viva.idEmpresa, valor: viva.valor });
      if (ok) showToast({ type: "success", title: "PIX da diferença gerado" });
    } finally {
      setOcupado(null);
      await recarregar();
      await onMudou();
    }
  }

  async function handleAbonar(ciclo: SituacaoCicloReenvio) {
    const motivo = motivoAbono.trim();
    if (motivo.length < 5) {
      showToast({ type: "warning", title: "Informe o motivo", description: "O abono pede um motivo (mínimo 5 caracteres)." });
      return;
    }
    setOcupado(ciclo.chave);
    try {
      const res = await abonarDiferencaDoReenvio(ciclo.chave, motivo);
      if (!res.success) {
        showToast({ type: "error", title: "Abono não registrado", description: res.error });
        return;
      }
      showToast({ type: "success", title: "Diferença abonada", description: `Reenvio ${ciclo.ciclo}: ${formatCurrency(ciclo.diferenca)}.` });
      setAbonando(null);
      setMotivoAbono("");
    } finally {
      setOcupado(null);
      await recarregar();
      await onMudou();
    }
  }

  if (ciclos.length === 0) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100">
      <p className="flex items-center gap-2 font-semibold">
        <Truck className="h-4 w-4" /> Diferença de frete do reenvio
      </p>
      {ciclos.map((c) => {
        const ocupadoAqui = ocupado === c.chave;
        const resolvida = c.pendente <= 0;
        return (
          <div key={c.chave} className="space-y-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/60">
            <p>
              Reenvio {c.ciclo}: frete {formatCurrency(c.freteAnterior ?? 0)} → {formatCurrency(c.freteNovo ?? 0)}. Diferença{" "}
              <span className="font-semibold">{formatCurrency(c.diferenca)}</span>, fora do total do pedido.
            </p>
            {c.abono !== null ? (
              <p className="text-emerald-700 dark:text-emerald-300">Abonada{c.abonadoPor ? ` por ${c.abonadoPor}` : ""}.</p>
            ) : resolvida ? (
              <p className="text-emerald-700 dark:text-emerald-300">Paga{c.cobrancaViva?.idPagamento ? ` (${c.cobrancaViva.idPagamento})` : ""}.</p>
            ) : c.cobrancaViva ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  PIX {c.cobrancaViva.idPagamento ?? ""} {c.cobrancaViva.temPix ? "gerado, aguardando pagamento." : "criado, sem o QR."}
                </span>
                {!c.cobrancaViva.temPix && podeCobrar ? (
                  <button
                    type="button"
                    disabled={ocupadoAqui}
                    onClick={() => void handleGerarQrDeNovo(c)}
                    className="rounded-xl bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                  >
                    {ocupadoAqui ? "Gerando..." : "Gerar o QR do PIX"}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {podeCobrar ? (
                    <button
                      type="button"
                      disabled={ocupadoAqui}
                      onClick={() => void handleCobrar(c)}
                      className="rounded-xl bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                    >
                      {ocupadoAqui ? "Gerando..." : `Gerar PIX da diferença (${formatCurrency(c.pendente)})`}
                    </button>
                  ) : (
                    <span className="text-xs">Quem cria cobrança gera o PIX da diferença.</span>
                  )}
                  {podeAbonar ? (
                    <button
                      type="button"
                      disabled={ocupadoAqui}
                      onClick={() => setAbonando(abonando === c.chave ? null : c.chave)}
                      className="rounded-xl border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-100 disabled:opacity-50 dark:border-violet-700 dark:bg-slate-900 dark:text-violet-200"
                    >
                      Abonar
                    </button>
                  ) : null}
                </div>
                {abonando === c.chave ? (
                  <div className="space-y-2">
                    <textarea
                      value={motivoAbono}
                      onChange={(e) => setMotivoAbono(e.target.value)}
                      rows={2}
                      maxLength={500}
                      placeholder="Motivo do abono (fica no chat do pedido)"
                      className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm outline-none dark:border-violet-800 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      disabled={ocupadoAqui}
                      onClick={() => void handleAbonar(c)}
                      className="rounded-xl bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                    >
                      {ocupadoAqui ? "Abonando..." : `Confirmar abono de ${formatCurrency(c.pendente)}`}
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
