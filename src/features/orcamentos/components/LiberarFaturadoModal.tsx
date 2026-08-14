"use client";

/**
 * Confirmação para alterar uma proposta cuja cobrança é FATURADA A VENCER.
 *
 * Existe porque a alteração tem consequência fora da proposta: os títulos já
 * lançados no Contas a Receber deixam de valer e precisam sair, e boleto
 * registrado ainda é cancelado no banco — o que não tem volta. Nada disso pode
 * acontecer como efeito silencioso de um "Salvar alterações", então o
 * financeiro vê aqui, item por item, o que será feito antes de confirmar.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Landmark, Wallet, X } from "lucide-react";
import { formatCurrency } from "@/lib/formatters/currency";
import { useAppToast } from "@/components/common/AppToast";
import { rotuloTitulo, tituloExigeCancelamentoBancario, type TituloParaFaturado } from "../services/faturado-editavel";
import { excluirTitulosDoFaturado } from "../services/faturado-titulos.service";

interface LiberarFaturadoModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Títulos que sairão do Contas a Receber. Pode ser vazio: aí é só confirmação do valor. */
  titulos: TituloParaFaturado[];
  faturadoId: string;
  valorAtualFaturado: number;
  novoValorFaturado: number;
  valorOutrasCobrancas: number;
  /** Chamado depois que os títulos saíram — é aqui que a proposta é salva. */
  onLiberado: () => void | Promise<void>;
}

function formatarVencimento(vencimento: string | null | undefined): string {
  const texto = String(vencimento ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return "sem vencimento";
  const [ano, mes, dia] = texto.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function LiberarFaturadoModal({
  isOpen,
  onClose,
  titulos,
  faturadoId,
  valorAtualFaturado,
  novoValorFaturado,
  valorOutrasCobrancas,
  onLiberado
}: LiberarFaturadoModalProps) {
  const { showToast } = useAppToast();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflowAnterior;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const titulosNoBanco = titulos.filter(tituloExigeCancelamentoBancario);

  async function handleConfirmar() {
    setIsSubmitting(true);
    try {
      if (titulos.length > 0) {
        const resultado = await excluirTitulosDoFaturado({ titulos, faturadoId });

        if (!resultado.success) {
          const falha = resultado.falhas[0];
          showToast({
            type: "error",
            title: "Não foi possível liberar a proposta",
            description:
              `${falha?.rotulo ?? "Título"}: ${falha?.erro ?? "erro desconhecido"}` +
              (resultado.excluidos > 0
                ? `\n\n${resultado.excluidos} título(s) já foram excluídos e não voltam sozinhos. Confira o Contas a Receber antes de tentar de novo.`
                : "\n\nNenhuma alteração foi feita.")
          });
          setIsSubmitting(false);
          return;
        }
      }

      await onLiberado();
      onClose();
    } catch (erro) {
      showToast({
        type: "error",
        title: "Erro inesperado",
        description: erro instanceof Error ? erro.message : "Erro desconhecido."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[95] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col gap-5 overflow-hidden rounded-3xl bg-white p-6 shadow-2xl">

        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Alterar proposta faturada</h2>
            <p className="mt-1 text-sm text-slate-500">
              A cobrança está a vencer, então o valor pode ser ajustado.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 transition hover:bg-slate-200 disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Valor da cobrança faturada</p>
            <p className="mt-2 flex items-baseline gap-2 text-slate-900">
              <span className="text-sm text-slate-400 line-through">{formatCurrency(valorAtualFaturado)}</span>
              <span className="text-2xl font-bold">{formatCurrency(novoValorFaturado)}</span>
            </p>
            {valorOutrasCobrancas > 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                As outras cobranças desta proposta somam {formatCurrency(valorOutrasCobrancas)} e não serão alteradas.
              </p>
            ) : null}
            <p className="mt-2 text-xs text-slate-500">
              O faturamento do mês acompanha este valor automaticamente.
            </p>
          </div>

          {titulos.length > 0 ? (
            <>
              <div className="flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
                <div className="text-xs leading-relaxed">
                  <p className="font-semibold">
                    {titulos.length} título(s) sairão do Contas a Receber
                  </p>
                  <p className="mt-1">
                    {titulosNoBanco.length > 0
                      ? `${titulosNoBanco.length} deles estão registrados no banco e serão cancelados lá — isso não tem volta. `
                      : ""}
                    Depois disso a cobrança volta para Registros de Recebíveis, onde os títulos são gerados de novo com o valor novo.
                  </p>
                </div>
              </div>

              <ul className="space-y-2">
                {titulos.map((titulo) => {
                  const noBanco = tituloExigeCancelamentoBancario(titulo);
                  return (
                    <li
                      key={titulo.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                          {noBanco ? <Landmark className="h-4 w-4 text-slate-400" /> : <Wallet className="h-4 w-4 text-slate-400" />}
                          {rotuloTitulo(titulo)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Vence em {formatarVencimento(titulo.vencimento)}
                          {noBanco ? " · cancelamento no banco" : " · só baixa local"}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold text-slate-900">
                        {formatCurrency(Number(titulo.valor) || 0)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs leading-relaxed text-slate-600">
              Esta cobrança não tem título ativo no Contas a Receber. Só o valor da cobrança será ajustado, e ela
              voltará para Registros de Recebíveis.
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
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
            onClick={() => void handleConfirmar()}
            disabled={isSubmitting}
            className="rounded-2xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#123f61] disabled:opacity-60"
          >
            {isSubmitting
              ? "Processando..."
              : titulos.length > 0
                ? "Excluir títulos e salvar"
                : "Salvar alterações"}
          </button>
        </div>
      </div>
    </div>
  );
}
