"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, AlertCircle, ReceiptText } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { cancelarProposta } from "@/features/orcamentos/services/orcamentos.service";
import { useCobrancas } from "@/features/cobrancas/CobrancasProvider";
import { CancelCobrancaModal } from "@/features/cobrancas/CancelCobrancaModal";
import {
  isCobrancaPagaParaCancelamento,
  isConfirmacaoDeMesAnterior,
  referenciaConfirmacaoParaMesFechado
} from "@/features/cobrancas/cancelamento-pago";
import { formatMesAnoPtBr, getTipoCobrancaLabel } from "@/features/cobrancas/cobrancas-utils";
import { formatCurrency } from "@/lib/formatters/currency";

interface CancelPropostaModalProps {
  isOpen: boolean;
  onClose: () => void;
  idInt: number;
  onSuccess?: () => void;
}

/** Status de `pagamentos_v2` que já representam cobrança inativa. */
const STATUS_INATIVOS = ["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"];

export function CancelPropostaModal({ isOpen, onClose, idInt, onSuccess }: CancelPropostaModalProps) {
  const { showToast } = useAppToast();
  const router = useRouter();
  const { getCobrancasByProposta, statusCarga, existingBoletoIdInts } = useCobrancas();

  const [motivo, setMotivo] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cobrancaParaCancelar, setCobrancaParaCancelar] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen) {
      setMotivo("");
      setCobrancaParaCancelar(null);
    }
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const cobrancasAtivas = getCobrancasByProposta(idInt).filter(
    (item) => !STATUS_INATIVOS.includes(String(item.status || "").trim().toUpperCase())
  );

  /**
   * A lista de cobranças só pode ser afirmada quando a carga concluiu COM
   * dados. Mesma regra da aba Pagamentos: conjunto vazio por carga vazia ou
   * falha não autoriza dizer "não há nada a cancelar junto".
   */
  const listaConfiavel = statusCarga === "OK";
  const temTituloAtivo = existingBoletoIdInts.has(Number(idInt));

  const cobrancaUnica = cobrancasAtivas.length === 1 ? cobrancasAtivas[0] : null;

  /**
   * Atalho para quem abriu o modal errado. O texto acima já avisa; o botão
   * evita que a pessoa tenha de sair, achar a aba e recomeçar — que era o
   * caminho que fazia o financeiro cancelar a proposta inteira só para
   * refazer uma cobrança.
   */
  function handleCancelarSoACobranca() {
    if (cobrancaUnica) {
      setCobrancaParaCancelar(cobrancaUnica.id);
      return;
    }
    // Mais de uma ativa: não dá para escolher por ela. A aba Pagamentos lista
    // todas, com o cancelamento individual em cada linha.
    onClose();
    router.push(`/orcamentos/${idInt}/editar?tab=pagamentos`);
  }

  async function handleConfirm() {
    if (!motivo.trim()) {
      showToast({ type: "error", title: "Motivo obrigatório", description: "Informe o motivo do cancelamento." });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await cancelarProposta(idInt, motivo.trim());
      if (result.success) {
        showToast({
          type: "success",
          title: result.alreadyCancelled ? "Proposta já estava cancelada." : "Proposta cancelada com sucesso."
        });
        onSuccess?.();
        onClose();
      } else {
        showToast({
          type: "error",
          title: "Não foi possível cancelar a proposta",
          description: result.errorMessage || "Erro desconhecido."
        });
      }
    } catch (err) {
      showToast({
        type: "error",
        title: "Erro inesperado",
        description: err instanceof Error ? err.message : "Erro desconhecido."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  // Fluxo desviado: o usuário escolheu cancelar só a cobrança. Este modal sai
  // de cena e o de cobrança assume, com o veredito do servidor.
  if (cobrancaParaCancelar) {
    return (
      <CancelCobrancaModal
        isOpen
        cobrancaId={cobrancaParaCancelar}
        isCobrancaPaga={cobrancaUnica ? isCobrancaPagaParaCancelamento(cobrancaUnica) : false}
        mesFechadoLabel={
          cobrancaUnica && isCobrancaPagaParaCancelamento(cobrancaUnica)
            ? (isConfirmacaoDeMesAnterior(referenciaConfirmacaoParaMesFechado(cobrancaUnica))
                ? formatMesAnoPtBr(referenciaConfirmacaoParaMesFechado(cobrancaUnica))
                : null)
            : null
        }
        onClose={() => {
          setCobrancaParaCancelar(null);
          onClose();
        }}
        onSuccess={() => {
          setCobrancaParaCancelar(null);
          onSuccess?.();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-6 flex flex-col max-h-[90vh] overflow-y-auto">

        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Cancelar Proposta</h2>
            <p className="text-sm text-slate-500 mt-1">Essa ação é irreversível.</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 flex gap-3 items-start">
            <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-semibold">Cancelar a proposta encerra o pedido</p>
              <p className="mt-1 leading-relaxed">
                As cobranças pendentes vinculadas são canceladas junto. É necessário preencher um
                motivo para auditoria.
              </p>
            </div>
          </div>

          {/*
            O texto anterior prometia "cobranças locais pendentes vinculadas também serão
            canceladas" e parava aí — e era exatamente isso que atraía quem só queria refazer
            a cobrança, levando a cancelar o pedido inteiro. Agora a alternativa fica explícita,
            com o caminho a um clique.
          */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-900">Só quer refazer a cobrança?</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              Então não cancele a proposta. Cancele apenas a cobrança — o pedido continua de pé e o
              saldo reabre para uma nova.
            </p>
            {!listaConfiavel ? (
              <p className="mt-2 text-xs text-amber-700">
                A lista de cobranças não foi carregada, então não dá para abrir o cancelamento da
                cobrança daqui. Abra a aba Pagamentos da proposta.
              </p>
            ) : cobrancasAtivas.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">Esta proposta não tem cobrança ativa.</p>
            ) : (
              <button
                type="button"
                onClick={handleCancelarSoACobranca}
                disabled={isSubmitting}
                className="mt-3 inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-100 disabled:opacity-50"
              >
                <ReceiptText className="h-4 w-4" />
                {cobrancaUnica ? "Cancelar só a cobrança" : "Ver cobranças na aba Pagamentos"}
              </button>
            )}
          </div>

          {/* O que vai junto — antes o usuário confirmava às cegas. */}
          {listaConfiavel && (cobrancasAtivas.length > 0 || temTituloAtivo) ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold text-slate-900">Será cancelado junto</p>
              <ul className="mt-2 space-y-1.5">
                {cobrancasAtivas.map((cobranca) => (
                  <li
                    key={cobranca.id}
                    className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700"
                  >
                    <span className="font-medium">{getTipoCobrancaLabel(cobranca.tipo_cobranca || "")}</span>
                    <span className="tabular-nums">{formatCurrency(Number(cobranca.valor) || 0)}</span>
                  </li>
                ))}
                {temTituloAtivo ? (
                  <li className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
                    Títulos em aberto no Contas a Receber desta proposta.
                  </li>
                ) : null}
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                Cobrança já paga ou título liquidado bloqueiam o cancelamento — nesse caso a
                proposta não é cancelada e o motivo aparece na mensagem de erro.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="motivo_cancelamento_proposta" className="text-xs font-semibold text-slate-700">
              Motivo do Cancelamento <span className="text-red-500">*</span>
            </label>
            <textarea
              id="motivo_cancelamento_proposta"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              disabled={isSubmitting}
              placeholder="Digite o motivo detalhado..."
              className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-red-500 focus:ring-4 focus:ring-red-100 disabled:opacity-50"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || !motivo.trim()}
            className="rounded-2xl bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
          >
            {isSubmitting ? "Cancelando..." : "Confirmar Cancelamento"}
          </button>
        </div>
      </div>
    </div>
  );
}
