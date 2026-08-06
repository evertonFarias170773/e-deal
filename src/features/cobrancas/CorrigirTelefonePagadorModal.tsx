"use client";

import { useMemo, useState } from "react";
import { X, PhoneOff, AlertCircle, Check } from "lucide-react";
import { updateCadastroCamposOperacionaisReadOnly } from "@/features/cadastros/services/cadastros.service";
import {
  diagnosticarTelefone,
  formatarTelefoneBR,
  normalizarTelefoneBR,
  soDigitos
} from "@/lib/telefone/telefone-br";

/**
 * Corrige o telefone do PAGADOR antes de a cobrança existir.
 *
 * Por que bloqueia em vez de avisar: no checkout do C6 os dados do pagador
 * ficam travados na tela. Telefone errado não é inconveniência — é cliente sem
 * conseguir pagar, com o vendedor descobrindo só quando ele reclama.
 *
 * A gravação vai para o cadastro (`clientes.whatsapp_1`), não para a cobrança:
 * o número errado também alimenta NF, WhatsApp e as próximas vendas. Corrigir
 * só na cobrança deixaria o defeito de pé.
 */

type Fontes = {
  whatsapp1?: string | null;
  whatsapp2?: string | null;
  telefoneFixo?: string | null;
};

interface CorrigirTelefonePagadorModalProps {
  isOpen: boolean;
  onClose: () => void;
  pagador: { idCliente: number; nome: string } | null;
  fontes: Fontes;
  /** Rótulo da modalidade que disparou o bloqueio ("Cartão de crédito", "Boleto"...). */
  modalidade: string;
  /** Cartão: o campo do checkout do provedor é "Celular" e recusa fixo na tela. */
  somenteCelular?: boolean;
  /** Recebe o novo número já normalizado, para o painel revalidar sem reler o banco. */
  onSalvo: (whatsapp1Normalizado: string) => void;
}

export function CorrigirTelefonePagadorModal({
  isOpen,
  onClose,
  pagador,
  fontes,
  modalidade,
  somenteCelular = false,
  onSalvo
}: CorrigirTelefonePagadorModalProps) {
  // Começa sempre vazio de propósito: preencher com o número errado convida a
  // "consertar" no chute. O número certo vem do cliente, não do palpite.
  // O pai monta este componente só quando abre (padrão do CancelCobrancaModal),
  // então cada abertura é uma montagem nova e o estado nasce limpo.
  const [valor, setValor] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const opcoes = useMemo(() => ({ somenteCelular }), [somenteCelular]);
  const digitos = soDigitos(valor);
  const normalizado = normalizarTelefoneBR(valor, opcoes);
  const podeSalvar = Boolean(normalizado) && !isSaving && Boolean(pagador);
  const criticaDigitacao = useMemo(() => {
    if (!digitos) return null;
    if (normalizado) return null;
    return diagnosticarTelefone(digitos, opcoes);
  }, [digitos, normalizado, opcoes]);

  const linhasCadastro = useMemo(
    () =>
      [
        { rotulo: "WhatsApp 1", valor: fontes.whatsapp1 },
        { rotulo: "WhatsApp 2", valor: fontes.whatsapp2 },
        { rotulo: "Telefone fixo", valor: fontes.telefoneFixo }
      ].map((linha) => ({ ...linha, problema: diagnosticarTelefone(linha.valor, opcoes) })),
    [fontes, opcoes]
  );

  async function handleSalvar() {
    if (!pagador || !normalizado) return;

    setIsSaving(true);
    setErro(null);
    try {
      const resultado = await updateCadastroCamposOperacionaisReadOnly(pagador.idCliente, {
        whatsapp_1: normalizado
      });

      if (!resultado.success) {
        setErro(resultado.errorMessage || "Não foi possível gravar o telefone no cadastro.");
        return;
      }

      onSalvo(normalizado);
      onClose();
    } catch (e: unknown) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setIsSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] bg-slate-950/60 p-4 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl space-y-5 flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div className="flex gap-3">
            <span className="rounded-2xl bg-amber-100 p-2 text-amber-700 h-fit">
              <PhoneOff className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Telefone do cliente impede a cobrança</h2>
              <p className="text-sm text-slate-500 mt-1">
                {modalidade} exige um telefone válido, e ele fica bloqueado para o cliente no checkout do banco.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-slate-100 p-2 text-slate-700 hover:bg-slate-200 transition"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Cadastro de {pagador?.nome ?? "cliente"}
            </p>
            {linhasCadastro.map((linha) => (
              <div key={linha.rotulo} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-slate-600">{linha.rotulo}</span>
                <span className="text-right">
                  <span className="font-medium text-slate-900">
                    {linha.valor ? formatarTelefoneBR(linha.valor) : "—"}
                  </span>
                  {linha.problema ? <span className="block text-xs text-red-600">{linha.problema}</span> : null}
                </span>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <label htmlFor="telefone-pagador" className="text-sm font-semibold text-slate-800">
              {somenteCelular ? "Celular correto (com DDD)" : "Telefone correto (com DDD)"}
            </label>
            <input
              id="telefone-pagador"
              value={valor}
              onChange={(event) => setValor(event.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder="51 99999 9999"
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-slate-900 outline-none focus:border-[#0b2f4a]"
            />
            {criticaDigitacao ? (
              <p className="text-xs text-red-600">O número digitado {criticaDigitacao}.</p>
            ) : normalizado ? (
              <p className="text-xs text-emerald-700 flex items-center gap-1">
                <Check className="h-3.5 w-3.5" /> Será gravado como {formatarTelefoneBR(normalizado)}
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                {somenteCelular
                  ? "Celular com 11 dígitos (DDD + 9 + número). O checkout do cartão recusa telefone fixo na tela, e o cliente não consegue corrigir por lá."
                  : "Celular com 11 dígitos (DDD + 9 + número) ou fixo com 10."}{" "}
                Confirme o número com o cliente — o sistema não completa dígito que falta.
              </p>
            )}
          </div>

          <p className="text-xs text-slate-500 leading-relaxed">
            Ao salvar, o número vai para o <strong>cadastro do cliente</strong> (WhatsApp 1) e passa a valer para as
            próximas cobranças, nota fiscal e envios de WhatsApp.
          </p>

          {erro ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800 flex gap-3 items-start">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
              <p className="text-sm leading-relaxed">{erro}</p>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSalvar}
            disabled={!podeSalvar}
            className="rounded-2xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0d3a5c] disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {isSaving ? "Salvando..." : "Salvar e continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}
