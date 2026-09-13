"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, AlertCircle, Link as LinkIcon } from "lucide-react";
import { useAppToast } from "@/components/common/AppToast";
import { criarPedidoComplementar } from "@/features/orcamentos/services/orcamentos.service";

interface CriarComplementoModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** `id_int` da proposta ORIGINAL — a que recebe o complemento. */
  idInt: number;
  onSuccess?: (novoIdInt: number) => void;
}

/**
 * Titulo de cada recusa da funcao `criar_pedido_complementar`. O texto do
 * banco (com os numeros, quando ha) vai logo abaixo, sem o codigo na frente.
 */
const TITULO_POR_CODIGO: Record<string, string> = {
  PERM: "Sem permissão para criar pedido complementar",
  COMPL_ORIGEM: "Proposta não encontrada",
  COMPL_AVULSA: "Proposta avulsa não aceita complemento",
  COMPL_ENCADEADO: "Esta proposta já é um complemento",
  COMPL_NAO_PAGA: "A proposta não está paga integralmente",
  COMPL_STATUS: "O status da proposta não aceita complemento",
  COMPL_EXPEDIDA: "A proposta já foi despachada",
  COMPL_JA_EXISTE: "Já existe um complemento aberto"
};

/**
 * Confirmacao do PEDIDO COMPLEMENTAR (regra: docs/business/PEDIDO-COMPLEMENTAR.md).
 *
 * O modal nao decide nada: todas as condicoes (pago integralmente, nao
 * expedido, sem complemento aberto, permissao) sao conferidas pela funcao do
 * banco no clique. Recusa aparece aqui dentro, com o motivo; sucesso leva
 * direto ao complemento, na aba de produtos, porque ele nasce sem itens.
 */
export function CriarComplementoModal({ isOpen, onClose, idInt, onSuccess }: CriarComplementoModalProps) {
  const { showToast } = useAppToast();
  const router = useRouter();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recusa, setRecusa] = useState<{ titulo: string; detalhe: string } | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen) {
      setRecusa(null);
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

  async function handleConfirm() {
    setIsSubmitting(true);
    setRecusa(null);
    try {
      const result = await criarPedidoComplementar(idInt);
      if (result.success && result.novoIdInt) {
        showToast({
          type: "success",
          title: `Pedido complementar #${result.novoIdInt} criado`,
          description: "Inclua os produtos do complemento."
        });
        onSuccess?.(result.novoIdInt);
        onClose();
        router.push(`/orcamentos/${result.novoIdInt}/editar?tab=produtos`);
        return;
      }
      setRecusa({
        titulo: (result.codigo && TITULO_POR_CODIGO[result.codigo]) || "Não foi possível criar o pedido complementar",
        detalhe: result.errorMessage || "Erro desconhecido."
      });
    } catch (err) {
      setRecusa({
        titulo: "Erro inesperado",
        detalhe: err instanceof Error ? err.message : "Erro desconhecido."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-6 flex flex-col max-h-[90vh] overflow-y-auto">

        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Criar pedido complementar</h2>
            <p className="text-sm text-slate-500 mt-1">A partir da proposta #{idInt}, mesmo evento.</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSubmitting} className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition disabled:opacity-50">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sky-900 flex gap-3 items-start">
            <LinkIcon className="h-5 w-5 mt-0.5 shrink-0" />
            <div className="text-xs">
              <p className="font-semibold">Uma proposta nova, vinculada à #{idInt}</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed">
                <li>Nasce <strong>sem itens</strong>: você inclui os produtos em seguida.</li>
                <li>Herda cliente, endereço, contato, pagador, modalidade e transportadora da #{idInt}.</li>
                <li>O frete cobra só a diferença do peso somado dos dois pedidos.</li>
                <li>Os dois saem juntos na Expedição.</li>
              </ul>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-900">Quando é aceito</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600">
              A proposta precisa estar paga integralmente, não avulsa, ainda não despachada e sem outro
              complemento aberto. O sistema confere tudo isso no momento da criação.
            </p>
          </div>

          {recusa ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 flex gap-3 items-start">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
              <div className="text-xs">
                <p className="font-semibold">{recusa.titulo}</p>
                <p className="mt-1 leading-relaxed">{recusa.detalhe}</p>
              </div>
            </div>
          ) : null}
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
            onClick={() => void handleConfirm()}
            disabled={isSubmitting}
            className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {isSubmitting ? "Criando..." : "Criar pedido complementar"}
          </button>
        </div>
      </div>
    </div>
  );
}
