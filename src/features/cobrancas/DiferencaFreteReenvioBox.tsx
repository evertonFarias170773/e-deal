"use client";

/**
 * FRETE DO REENVIO, na aba Pagamentos (fase 2B e modo de cobranca, 18/11/2026).
 *
 * O reenvio de pedido devolvido grava no ciclo o MODO de cobrar o frete novo e
 * o VALOR A COBRAR que sai dele (`expedicao_reenvios.valor_cobrar`, coluna
 * gerada): DIFERENCA (frete novo - anterior), CHEIO (o frete novo inteiro) ou
 * SEM_COBRANCA (administrador, com motivo). O valor NAO entra no total da
 * proposta nem no pago: vira uma cobranca PIX propria, marcada com
 * `chave_reenvio` (uma viva por ciclo), ou um abono de administrador. O
 * Despachar do reenvio so libera com o valor pago ou abonado
 * (`exp_saldo_despacho`).
 *
 *   - "Gerar PIX": `exp_reenvio_cobrar_diferenca` cria a linha pelo valor a
 *     cobrar (so o banco marca a cobranca) e o QR sai por /api/cobrancas/gerar-pix,
 *     o mesmo caminho do "gerar de novo" das outras cobrancas.
 *   - "Abonar": `exp_reenvio_abonar_diferenca`, so administrador, com motivo;
 *     recusada se ja houver cobranca viva do ciclo.
 *   - "Trocar modo": `exp_reenvio_trocar_modo`, so administrador, com motivo;
 *     so o ultimo ciclo ainda nao redespachado, sem cobranca viva nem paga e
 *     sem abono (o banco confere).
 *
 * Sem ciclo com valor a cobrar (nem ciclo sem cobranca), o quadro nao aparece.
 */
import { useCallback, useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { formatCurrency } from "@/lib/formatters/currency";
import { getSupabaseClient } from "@/lib/supabase/client";
import { montarUrlPublicaCobranca } from "@/features/cobrancas/cobrancas-utils";
import {
  MODOS_COBRANCA_REENVIO,
  ROTULO_MODO_COBRANCA,
  tituloDoFreteDoReenvio,
  type ModoCobrancaReenvio,
  type SituacaoCicloReenvio
} from "@/features/expedicao/lib/reenvio";
import {
  abonarDiferencaDoReenvio,
  cobrarDiferencaDoReenvio,
  lerSituacaoDosReenvios,
  trocarModoDeCobrancaDoReenvio
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

/** Ciclos que o quadro mostra: os que cobram algo e os registrados sem cobranca. */
function ciclosDoQuadro(lista: SituacaoCicloReenvio[]): SituacaoCicloReenvio[] {
  return lista.filter((c) => c.valorCobrar > 0 || c.modoCobranca === "SEM_COBRANCA");
}

function rotuloDoPix(c: SituacaoCicloReenvio): string {
  return c.modoCobranca === "CHEIO" ? "Gerar PIX do frete do reenvio" : "Gerar PIX da diferença";
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
  const ehAdministrador = Boolean(user?.isSuperAdmin || user?.isAdmin);

  const [ciclos, setCiclos] = useState<SituacaoCicloReenvio[]>([]);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [abonando, setAbonando] = useState<string | null>(null);
  const [motivoAbono, setMotivoAbono] = useState("");
  const [trocando, setTrocando] = useState<string | null>(null);
  const [modoNovo, setModoNovo] = useState<ModoCobrancaReenvio>("DIFERENCA");
  const [motivoTroca, setMotivoTroca] = useState("");

  const recarregar = useCallback(async () => {
    setCiclos(ciclosDoQuadro(await lerSituacaoDosReenvios(idInt)));
  }, [idInt]);

  useEffect(() => {
    let vivo = true;
    void lerSituacaoDosReenvios(idInt).then((lista) => {
      if (vivo) setCiclos(ciclosDoQuadro(lista));
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
        showToast({ type: "error", title: "PIX do frete do reenvio não criado", description: criada.error });
        return;
      }
      const ok = await gerarQr({ id: criada.id, idPagamento: criada.idPagamento, idEmpresa: criada.idEmpresa, valor: criada.valor });
      if (ok) {
        showToast({
          type: "success",
          title: "PIX do frete do reenvio gerado",
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
      if (ok) showToast({ type: "success", title: "PIX do frete do reenvio gerado" });
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
      showToast({ type: "success", title: "Frete do reenvio abonado", description: `Reenvio ${ciclo.ciclo}: ${formatCurrency(ciclo.valorCobrar)}.` });
      setAbonando(null);
      setMotivoAbono("");
    } finally {
      setOcupado(null);
      await recarregar();
      await onMudou();
    }
  }

  function abrirTroca(ciclo: SituacaoCicloReenvio) {
    if (trocando === ciclo.chave) {
      setTrocando(null);
      return;
    }
    setAbonando(null);
    setTrocando(ciclo.chave);
    setModoNovo(MODOS_COBRANCA_REENVIO.find((m) => m !== ciclo.modoCobranca) ?? "DIFERENCA");
    setMotivoTroca("");
  }

  async function handleTrocarModo(ciclo: SituacaoCicloReenvio) {
    const motivo = motivoTroca.trim();
    if (motivo.length < 5) {
      showToast({ type: "warning", title: "Informe o motivo", description: "A troca do modo pede um motivo (mínimo 5 caracteres)." });
      return;
    }
    setOcupado(ciclo.chave);
    try {
      const res = await trocarModoDeCobrancaDoReenvio(ciclo.chave, modoNovo, motivo);
      if (!res.success) {
        showToast({ type: "error", title: "Modo não trocado", description: res.error });
        return;
      }
      showToast({
        type: "success",
        title: "Modo de cobrança trocado",
        description: `Reenvio ${ciclo.ciclo}: ${ROTULO_MODO_COBRANCA[modoNovo]}, valor a cobrar ${formatCurrency(res.valorCobrar)}.`
      });
      setTrocando(null);
      setMotivoTroca("");
    } finally {
      setOcupado(null);
      await recarregar();
      await onMudou();
    }
  }

  if (ciclos.length === 0) return null;

  const modos = new Set(ciclos.map((c) => c.modoCobranca));
  const titulo = modos.size === 1 ? tituloDoFreteDoReenvio(ciclos[0].modoCobranca) : "Frete dos reenvios";

  return (
    <div className="space-y-3 rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100">
      <p className="flex items-center gap-2 font-semibold">
        <Truck className="h-4 w-4" /> {titulo}
      </p>
      {ciclos.map((c) => {
        const ocupadoAqui = ocupado === c.chave;
        const resolvida = c.pendente <= 0;
        const semCobranca = c.modoCobranca === "SEM_COBRANCA";
        // A troca de modo: sem cobranca viva nem paga e sem abono (o banco confere o resto).
        const podeTrocar = ehAdministrador && !c.cobrancaViva && c.pago <= 0 && c.abono === null;
        return (
          <div key={c.chave} className="space-y-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/60">
            <p>
              {modos.size > 1 ? <span className="font-semibold">{tituloDoFreteDoReenvio(c.modoCobranca)} · </span> : null}
              Reenvio {c.ciclo}: frete {formatCurrency(c.freteAnterior ?? 0)} → {formatCurrency(c.freteNovo ?? 0)}.{" "}
              {semCobranca ? (
                <>Sem cobrança de frete{c.modoDefinidoPor ? ` (${c.modoDefinidoPor})` : ""}.</>
              ) : c.modoCobranca === "CHEIO" ? (
                <>
                  Valor cheio <span className="font-semibold">{formatCurrency(c.valorCobrar)}</span>, sem desconto do frete anterior, fora do total do
                  pedido.
                </>
              ) : (
                <>
                  Diferença <span className="font-semibold">{formatCurrency(c.valorCobrar)}</span>, fora do total do pedido.
                </>
              )}
            </p>
            {semCobranca && c.modoMotivo ? <p className="text-xs">Motivo: {c.modoMotivo}</p> : null}
            {semCobranca ? null : c.abono !== null ? (
              <p className="text-emerald-700 dark:text-emerald-300">Abonado{c.abonadoPor ? ` por ${c.abonadoPor}` : ""}.</p>
            ) : resolvida ? (
              <p className="text-emerald-700 dark:text-emerald-300">Pago{c.cobrancaViva?.idPagamento ? ` (${c.cobrancaViva.idPagamento})` : ""}.</p>
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
                      {ocupadoAqui ? "Gerando..." : `${rotuloDoPix(c)} (${formatCurrency(c.pendente)})`}
                    </button>
                  ) : (
                    <span className="text-xs">Quem cria cobrança gera o PIX do frete do reenvio.</span>
                  )}
                  {ehAdministrador ? (
                    <button
                      type="button"
                      disabled={ocupadoAqui}
                      onClick={() => {
                        setTrocando(null);
                        setAbonando(abonando === c.chave ? null : c.chave);
                      }}
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
            {podeTrocar ? (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={ocupadoAqui}
                  onClick={() => abrirTroca(c)}
                  className="text-xs font-semibold text-violet-800 underline underline-offset-2 hover:text-violet-950 disabled:opacity-50 dark:text-violet-200"
                >
                  Trocar modo de cobrança
                </button>
                {trocando === c.chave ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-3">
                      {MODOS_COBRANCA_REENVIO.filter((m) => m !== c.modoCobranca).map((m) => (
                        <label key={m} className="flex cursor-pointer items-center gap-1.5 text-xs">
                          <input type="radio" name={`modo-${c.chave}`} checked={modoNovo === m} onChange={() => setModoNovo(m)} />
                          <span className="first-letter:uppercase">{ROTULO_MODO_COBRANCA[m]}</span>
                        </label>
                      ))}
                    </div>
                    <textarea
                      value={motivoTroca}
                      onChange={(e) => setMotivoTroca(e.target.value)}
                      rows={2}
                      maxLength={500}
                      placeholder="Motivo da troca (fica no ciclo e no chat do pedido)"
                      className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm outline-none dark:border-violet-800 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      disabled={ocupadoAqui}
                      onClick={() => void handleTrocarModo(c)}
                      className="rounded-xl bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                    >
                      {ocupadoAqui ? "Trocando..." : `Trocar para ${ROTULO_MODO_COBRANCA[modoNovo]}`}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
