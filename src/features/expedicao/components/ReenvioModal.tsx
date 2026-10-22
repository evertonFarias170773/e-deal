"use client";

/**
 * REENVIO DE PEDIDO DEVOLVIDO, FASE 1 (22/10/2026).
 *
 * Pedido EM TRANSITO devolvido pela transportadora volta para a Expedicao com
 * endereco e/ou tipo de envio novos. O endereco e ESCOLHA EXPLICITA: depois do
 * despacho vale o gravado em `expedicoes`, e mudar na proposta nao surte efeito.
 * Quem decide e o banco (`exp_reenviar_pedido`): permissao, frete e quem paga.
 * Diferenca de frete e a fase 2 — a RPC recusa e o texto dela aparece aqui.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { avisosDoReenvio } from "../lib/reenvio";
import { listarEnderecosParaReenvio, reenviarPedido, type EnderecoParaReenvio } from "../services/reenvio.client";
import { TRANSPORTES_POR_MODALIDADE, type PedidoExpedicao, type TipoFreteNormalizado } from "../types";

const ROTULO_TIPO: Record<string, string> = {
  CORREIOS: "Correios",
  TRANSPORTADORA: "Transportadora",
  MOTOBOY: "Motoboy"
};

export function ReenvioModal({
  pedido,
  onClose,
  onDone
}: {
  pedido: PedidoExpedicao;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useAppToast();
  const exp = pedido.expedicao;
  const modalidade = exp?.modalidadeFrete ?? pedido.modalidadeOrcamento ?? null;
  const tipos: TipoFreteNormalizado[] = modalidade === "CIF" || modalidade === "FOB" ? TRANSPORTES_POR_MODALIDADE[modalidade] : [];
  const tipoAtual = (exp?.tipoFrete ?? pedido.tipoFrete) as TipoFreteNormalizado;
  const ciclo = (pedido.reenvio?.ciclos ?? 0) + 1;

  const [enderecos, setEnderecos] = useState<EnderecoParaReenvio[] | null>(null);
  const [idEndereco, setIdEndereco] = useState<string>(exp?.idEnderecoEntrega ?? pedido.enderecoEntrega?.id ?? "");
  const [tipoFrete, setTipoFrete] = useState<TipoFreteNormalizado>(tipos.includes(tipoAtual) ? tipoAtual : (tipos[0] ?? tipoAtual));
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void listarEnderecosParaReenvio([Number(pedido.idCliente), Number(pedido.idFaturado)]).then((lista) => {
      if (vivo) setEnderecos(lista);
    });
    return () => {
      vivo = false;
    };
  }, [pedido.idCliente, pedido.idFaturado]);

  const avisos = useMemo(
    () =>
      avisosDoReenvio({
        tipoFreteAtual: exp?.tipoFrete,
        correiosCodigoObjeto: exp?.correiosCodigoObjeto,
        prepostagemCanceladaEm: exp?.prepostagemCanceladaEm,
        azulAwb: exp?.azulAwb
      }),
    [exp?.tipoFrete, exp?.correiosCodigoObjeto, exp?.prepostagemCanceladaEm, exp?.azulAwb]
  );

  const semQuemPaga = tipos.length === 0;
  const pronto = !salvando && !semQuemPaga && Boolean(idEndereco) && motivo.trim().length >= 3;

  async function handleConfirmar() {
    if (!pronto) return;
    setSalvando(true);
    const res = await reenviarPedido({
      idInt: pedido.idInt,
      ciclo,
      idEnderecoEntrega: idEndereco,
      tipoFrete,
      motivo: motivo.trim(),
      modalidade
    });
    setSalvando(false);
    if (res.success) {
      showToast({
        type: "success",
        title: res.idempotente ? "Reenvio já registrado" : `Reenvio ${res.ciclo} registrado`,
        description: `#${pedido.idInt} voltou para a Expedição. Despache de novo pelo botão Despachar.`
      });
      onDone();
    } else {
      showToast({ type: "error", title: "Reenvio não registrado", description: res.error });
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 p-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-950 dark:text-slate-100">
            Reenviar #{pedido.idInt} {ciclo > 1 ? <span className="text-sm font-medium text-slate-500">(reenvio {ciclo})</span> : null}
          </h2>
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 overflow-y-auto p-6">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            O pedido volta de EM TRANSITO para a Expedição, sem passar por Arte nem Produção, e sai de novo pelo Despachar.
            O primeiro envio fica guardado no registro do reenvio.
          </p>

          {semQuemPaga ? (
            <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
              Este pedido está sem quem paga o frete (CIF ou FOB). O reenvio só vale em CIF ou FOB.
            </p>
          ) : null}

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Endereço de entrega do reenvio</label>
            {enderecos === null ? (
              <p className="text-sm text-slate-500">Carregando endereços...</p>
            ) : enderecos.length === 0 ? (
              <p className="text-sm text-rose-700 dark:text-rose-300">Nenhum endereço do cliente ou do pagador. Cadastre o endereço no cliente e abra de novo.</p>
            ) : (
              <select
                value={idEndereco}
                onChange={(e) => setIdEndereco(e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                {!enderecos.some((e) => e.id === idEndereco) ? <option value="">Escolha o endereço</option> : null}
                {enderecos.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.id === exp?.idEnderecoEntrega ? "(atual) " : ""}
                    {e.idCliente === pedido.idFaturado && pedido.idFaturado !== pedido.idCliente ? "[pagador] " : ""}
                    {e.rotulo}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Tipo de envio</label>
            <select
              value={tipoFrete}
              onChange={(e) => setTipoFrete(e.target.value as TipoFreteNormalizado)}
              disabled={semQuemPaga}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              {tipos.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO[t] ?? t}
                  {t === tipoAtual ? " (atual)" : ""}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Quem paga não muda ({modalidade ?? "sem quem paga"}). Se o endereço ou o tipo de envio mudar o valor do frete, ou exigir recotar,
              o reenvio é recusado: a diferença de frete fica para a fase 2.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Motivo (obrigatório — fica na trilha)</label>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Ex.: devolvido pelos Correios, destinatário ausente; endereço incompleto..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>

          {avisos.map((a) => (
            <p key={a} className="flex gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{a}</span>
            </p>
          ))}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-slate-100 bg-slate-50 p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <button type="button" onClick={onClose} disabled={salvando} className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            Cancelar
          </button>
          <button type="button" onClick={() => void handleConfirmar()} disabled={!pronto} className="rounded-2xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0d3a5c] disabled:opacity-50 dark:bg-sky-600 dark:hover:bg-sky-500">
            {salvando ? "Registrando..." : "Voltar para a Expedição"}
          </button>
        </div>
      </div>
    </div>
  );
}
