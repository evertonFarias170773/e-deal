"use client";

/**
 * DIFERENÇA DE FRETE DA TROCA DE TRANSPORTADORA, na aba Pagamentos (26/11/2026).
 *
 * A troca cobrando (Despachar ou aba Fretes) muda a transportadora sem mudar o
 * frete da proposta nem o total, e cria a diferença como cobrança nova do
 * pedido, marcada com `pagamentos_v2.id_troca_frete`: fora do pago da proposta
 * e da venda, sem nota complementar. O despacho só libera com ela paga ou
 * abonada (`exp_saldo_despacho`, SALDO_TROCA_FRETE).
 *
 *   - "Gerar PIX / boleto / link do cartão": a cobrança já existe (o banco a
 *     criou); a emissão é a de sempre (`emitirCobrancaCriadaPeloBanco`).
 *   - "Cobrar de novo": a anterior foi cancelada; `exp_troca_frete_cobrar` cria
 *     a próxima pela forma escolhida.
 *   - "Abonar": `exp_troca_frete_abonar`, só administrador, com motivo, sem
 *     cobrança viva.
 *
 * Sem troca cobrando no pedido, o quadro não aparece.
 */
import { useCallback, useEffect, useState } from "react";
import { Truck } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { useAuth } from "@/features/auth/AuthProvider";
import { hasPermissao } from "@/features/auth/usuarios.service";
import { formatCurrency } from "@/lib/formatters/currency";
import { FORMAS_COBRANCA_TROCA, type FormaCobrancaTroca } from "@/features/expedicao/lib/abono-frete";
import { cobrancaDaTrocaPrecisaEmitir, type SituacaoTrocaFrete } from "@/features/expedicao/lib/troca-frete";
import {
  abonarDiferencaDaTroca,
  cobrarDeNovoATroca,
  lerSituacaoDasTrocasDeFrete
} from "@/features/expedicao/services/troca-frete.client";

export type EmitirCobrancaDaTroca = (cobrancaId: string) => Promise<{ success: boolean; errorMessage?: string }>;

const ROTULO_FORMA: Record<FormaCobrancaTroca, string> = { PIX: "PIX", BOLETO: "boleto", CARD_PARCELADO: "cartão" };

function rotuloDoBotaoEmitir(tipo: FormaCobrancaTroca | null): string {
  if (tipo === "BOLETO") return "Gerar o boleto";
  if (tipo === "CARD_PARCELADO") return "Gerar o link do cartão";
  return "Gerar o QR do PIX";
}

export function DiferencaFreteTrocaBox({
  idInt,
  emitir,
  onMudou
}: {
  idInt: number;
  emitir: EmitirCobrancaDaTroca;
  onMudou: () => void | Promise<void>;
}) {
  const { showToast } = useAppToast();
  const { user } = useAuth();
  const podeCobrar = Boolean(user?.isSuperAdmin || user?.isAdmin || hasPermissao(user, "cobrancas.create"));
  const ehAdministrador = Boolean(user?.isSuperAdmin || user?.isAdmin);

  const [trocas, setTrocas] = useState<SituacaoTrocaFrete[]>([]);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [abonando, setAbonando] = useState<number | null>(null);
  const [motivoAbono, setMotivoAbono] = useState("");
  const [formaNova, setFormaNova] = useState<FormaCobrancaTroca>("PIX");

  const recarregar = useCallback(async () => {
    setTrocas(await lerSituacaoDasTrocasDeFrete(idInt));
  }, [idInt]);

  useEffect(() => {
    let vivo = true;
    void lerSituacaoDasTrocasDeFrete(idInt).then((lista) => {
      if (vivo) setTrocas(lista);
    });
    return () => {
      vivo = false;
    };
  }, [idInt]);

  async function terminar() {
    setOcupado(null);
    await recarregar();
    await onMudou();
  }

  async function handleEmitir(t: SituacaoTrocaFrete) {
    const viva = t.cobrancaViva;
    if (!viva) return;
    setOcupado(t.id);
    try {
      const res = await emitir(viva.id);
      if (!res.success) {
        showToast({ type: "error", title: "Cobrança não emitida", description: res.errorMessage || "Tente de novo." });
        return;
      }
      showToast({
        type: "success",
        title: `${ROTULO_FORMA[viva.tipo ?? "PIX"]} da diferença de frete pronto`,
        description: `${viva.idPagamento ?? "Cobrança"} de ${formatCurrency(viva.valor)}. O despacho libera quando o pagamento for confirmado.`
      });
    } finally {
      await terminar();
    }
  }

  async function handleCobrarDeNovo(t: SituacaoTrocaFrete) {
    setOcupado(t.id);
    try {
      const criada = await cobrarDeNovoATroca(t.id, formaNova);
      if (!criada.success) {
        showToast({ type: "error", title: "Cobrança não criada", description: criada.error });
        return;
      }
      const res = await emitir(criada.id);
      if (!res.success) {
        showToast({ type: "error", title: "Cobrança criada, não emitida", description: res.errorMessage || "Use o botão de gerar de novo." });
        return;
      }
      showToast({ type: "success", title: "Cobrança da diferença de frete criada" });
    } finally {
      await terminar();
    }
  }

  async function handleAbonar(t: SituacaoTrocaFrete) {
    const motivo = motivoAbono.trim();
    if (motivo.length < 5) {
      showToast({ type: "warning", title: "Informe o motivo", description: "O abono pede um motivo (mínimo 5 caracteres)." });
      return;
    }
    setOcupado(t.id);
    try {
      const res = await abonarDiferencaDaTroca(t.id, motivo);
      if (!res.success) {
        showToast({ type: "error", title: "Abono não registrado", description: res.error });
        return;
      }
      showToast({ type: "success", title: "Diferença de frete abonada", description: `${formatCurrency(t.valor)} da troca para ${t.transportadora}.` });
      setAbonando(null);
      setMotivoAbono("");
    } finally {
      await terminar();
    }
  }

  if (trocas.length === 0) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
      <p className="flex items-center gap-2 font-semibold">
        <Truck className="h-4 w-4" /> Diferença de frete da troca de transportadora
      </p>
      {trocas.map((t) => {
        const ocupadoAqui = ocupado === t.id;
        const viva = t.cobrancaViva;
        return (
          <div key={t.id} className="space-y-2 rounded-xl bg-white/70 px-3 py-2 dark:bg-slate-900/60">
            <p>
              Troca para <span className="font-semibold">{t.transportadora}</span> ({formatCurrency(t.valorOpcao)}). O frete da proposta
              continua {formatCurrency(t.freteCobrado)}; a diferença de <span className="font-semibold">{formatCurrency(t.valor)}</span> é
              cobrada à parte, fora do total do pedido e sem nota complementar.
            </p>
            {t.motivo ? (
              <p className="text-xs">
                Motivo: {t.motivo}
                {t.autor ? ` (${t.autor})` : ""}
              </p>
            ) : null}
            {t.abono !== null ? (
              <p className="text-emerald-700 dark:text-emerald-300">
                Abonado{t.abonadoPor ? ` por ${t.abonadoPor}` : ""}
                {t.abonoMotivo ? `: ${t.abonoMotivo}` : ""}.
              </p>
            ) : t.pendente <= 0 ? (
              <p className="text-emerald-700 dark:text-emerald-300">Pago{viva?.idPagamento ? ` (${viva.idPagamento})` : ""}.</p>
            ) : viva ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {ROTULO_FORMA[viva.tipo ?? "PIX"]} {viva.idPagamento ?? ""}{" "}
                  {cobrancaDaTrocaPrecisaEmitir(viva) ? "criado, ainda não emitido." : "emitido, aguardando pagamento."}
                </span>
                {cobrancaDaTrocaPrecisaEmitir(viva) && podeCobrar ? (
                  <button
                    type="button"
                    disabled={ocupadoAqui}
                    onClick={() => void handleEmitir(t)}
                    className="rounded-xl bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
                  >
                    {ocupadoAqui ? "Gerando..." : rotuloDoBotaoEmitir(viva.tipo)}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs">A cobrança anterior foi cancelada. Falta {formatCurrency(t.pendente)}.</p>
                <div className="flex flex-wrap items-center gap-2">
                  {podeCobrar ? (
                    <>
                      <select
                        value={formaNova}
                        onChange={(e) => setFormaNova(e.target.value as FormaCobrancaTroca)}
                        disabled={ocupadoAqui}
                        className="rounded-xl border border-sky-200 bg-white px-2 py-1 text-xs dark:border-sky-800 dark:bg-slate-900"
                      >
                        {FORMAS_COBRANCA_TROCA.map((f) => (
                          <option key={f.valor} value={f.valor}>
                            {f.rotulo}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={ocupadoAqui}
                        onClick={() => void handleCobrarDeNovo(t)}
                        className="rounded-xl bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
                      >
                        {ocupadoAqui ? "Gerando..." : `Cobrar ${formatCurrency(t.pendente)}`}
                      </button>
                    </>
                  ) : (
                    <span className="text-xs">Quem cria cobrança gera a cobrança da diferença.</span>
                  )}
                  {ehAdministrador ? (
                    <button
                      type="button"
                      disabled={ocupadoAqui}
                      onClick={() => setAbonando(abonando === t.id ? null : t.id)}
                      className="rounded-xl border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-50 dark:border-sky-700 dark:bg-slate-900 dark:text-sky-200"
                    >
                      Abonar
                    </button>
                  ) : null}
                </div>
                {abonando === t.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={motivoAbono}
                      onChange={(e) => setMotivoAbono(e.target.value)}
                      rows={2}
                      maxLength={500}
                      placeholder="Motivo do abono (fica no chat do pedido)"
                      className="w-full rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm outline-none dark:border-sky-800 dark:bg-slate-900 dark:text-slate-100"
                    />
                    <button
                      type="button"
                      disabled={ocupadoAqui}
                      onClick={() => void handleAbonar(t)}
                      className="rounded-xl bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-50"
                    >
                      {ocupadoAqui ? "Abonando..." : `Confirmar abono de ${formatCurrency(t.pendente)}`}
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
