"use client";

/**
 * DiferencaFinanceiraModal.tsx
 *
 * Modal obrigatório exibido quando uma proposta paga é alterada gerando
 * diferença financeira. O usuário deve escolher uma ação antes de prosseguir.
 *
 * REVISÃO 2026-07-16 (v2):
 * - Remoção de `force` do client — o save ocorre via /api/orcamentos/editar-paga
 * - Idempotência: botão desabilitado após 1º clique
 * - Ação "DEBITO_PENDENTE_COBRANCA" (renomeada de COBRANCA_NORMAL) com texto claro
 * - Devolução exibe aviso de dois estágios (solicitação → confirmação Financeiro)
 * - Sub-modal de abatimento: lista débitos, suporta valor parcial, valida saldo
 *
 * Crédito (diferença < 0):
 *   - Manter crédito para uso futuro   → CREDITO
 *   - Devolver ao cliente (solicitação) → DEVOLUCAO (2 estágios)
 *   - Abater débito existente           → CONSUMO (com seleção do débito alvo)
 *
 * Débito (diferença > 0):
 *   - Registrar débito e gerar cobrança depois → DEBITO_PENDENTE_COBRANCA
 *   - Bonificar comercialmente                  → BONIFICACAO
 *   - Registrar débito futuro                   → DEBITO
 */

import React, { useState, useEffect } from "react";
import { formatCurrency } from "@/lib/formatters/currency";
import type { AcaoFinanceiraDiferenca } from "@/features/cobrancas/types";
import type { MovimentoCredito } from "@/features/cobrancas/types";
import { getMovimentosByCliente } from "@/features/cobrancas/services/movimento-credito.service";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type DiferencaFinanceiraModalProps = {
  isOpen: boolean;
  /** Chamado após executar a ação financeira com sucesso — fecha o modal */
  onConfirm: (acao: AcaoFinanceiraDiferenca) => Promise<void>;
  onClose: () => void;
  idInt: number;
  idCliente: number;
  idPendencia: number | null;
  nomeCliente: string;
  valorPagoConfirmado: number;
  novoTotal: number;
  /** negativo = crédito ao cliente | positivo = débito */
  diferenca: number;
  canBonificar: boolean;
  canDevolver: boolean;
  canDebitoFuturo: boolean;
};

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

import { X } from "lucide-react";

export function DiferencaFinanceiraModal({
  isOpen,
  onConfirm,
  onClose,
  idInt,
  idCliente,
  idPendencia,
  nomeCliente,
  valorPagoConfirmado,
  novoTotal,
  diferenca,
  canBonificar,
  canDevolver,
  canDebitoFuturo,
}: DiferencaFinanceiraModalProps) {
  const isCredito = diferenca < 0;
  const absDiff = Math.abs(diferenca);

  // Ação selecionada
  type AcaoId =
    | "MANTER_CREDITO" | "DEVOLVER" | "ABATER_DEBITO"
    | "DEBITO_PENDENTE_COBRANCA" | "BONIFICAR" | "DEBITO_FUTURO";

  const [selectedAcao, setSelectedAcao] = useState<AcaoId | null>(null);
  const [obs, setObs] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sub-modal de abatimento
  const [debitos, setDebitos] = useState<MovimentoCredito[]>([]);
  const [loadingDebitos, setLoadingDebitos] = useState(false);
  const [debitoAlvo, setDebitoAlvo] = useState<MovimentoCredito | null>(null);
  const [valorAbatimento, setValorAbatimento] = useState<string>("");

  // Carregar débitos ao selecionar ABATER_DEBITO
  useEffect(() => {
    if (selectedAcao === "ABATER_DEBITO" && idCliente) {
      setLoadingDebitos(true);
      getMovimentosByCliente(idCliente)
        .then((movs) => {
          const debts = movs.filter((m) => m.tipo === "DEBITO");
          setDebitos(debts);
          if (debts.length === 0) {
            setError("Este cliente não possui débitos registrados. Escolha outra opção.");
          } else {
            setError(null);
          }
        })
        .catch(() => setError("Erro ao carregar débitos do cliente."))
        .finally(() => setLoadingDebitos(false));
    } else {
      setDebitos([]);
      setDebitoAlvo(null);
      setValorAbatimento("");
    }
  }, [selectedAcao, idCliente]);

  // Quando selecionar débito alvo, definir valor padrão
  useEffect(() => {
    if (debitoAlvo) {
      const defaultVal = Math.min(absDiff, debitoAlvo.valor);
      setValorAbatimento(defaultVal.toFixed(2));
    }
  }, [debitoAlvo, absDiff]);

  if (!isOpen) return null;

  // ── Validação de abatimento ──────────────────────────────────────────────
  function validarAbatimento(): string | null {
    if (!debitoAlvo) return "Selecione um débito alvo.";
    const v = parseFloat(valorAbatimento.replace(",", "."));
    if (isNaN(v) || v <= 0) return "Informe um valor válido para abatimento.";
    if (v > absDiff) return `Valor de abatimento (${formatCurrency(v)}) maior que o crédito disponível (${formatCurrency(absDiff)}).`;
    if (v > debitoAlvo.valor) return `Valor de abatimento (${formatCurrency(v)}) maior que o débito alvo (${formatCurrency(debitoAlvo.valor)}).`;
    return null;
  }

  // ── Confirmar ────────────────────────────────────────────────────────────
  async function handleConfirm() {
    if (!selectedAcao) {
      setError("Selecione uma ação antes de continuar.");
      return;
    }

    if (!idPendencia || !idInt || !idCliente || absDiff <= 0) {
      setError(`Erro de sistema: Dados obrigatórios ausentes (idPendencia=${idPendencia}, idInt=${idInt}, idCliente=${idCliente}, valor=${absDiff}). Por favor, recarregue a página.`);
      return;
    }

    if (selectedAcao === "ABATER_DEBITO") {
      const validErr = validarAbatimento();
      if (validErr) { setError(validErr); return; }
    }

    setError(null);
    setIsSubmitting(true);

    try {
      let acao: AcaoFinanceiraDiferenca;

      if (selectedAcao === "ABATER_DEBITO") {
        const v = parseFloat(valorAbatimento.replace(",", "."));
        const saldoRestante = debitoAlvo!.valor - v;
        acao = {
          tipo: "ABATER_DEBITO",
          obs: [obs.trim(), `Débito ID ${debitoAlvo!.id} | Valor: ${formatCurrency(debitoAlvo!.valor)} | Abatido: ${formatCurrency(v)} | Saldo restante: ${formatCurrency(saldoRestante)}`]
            .filter(Boolean).join(" — "),
          idDebitoAlvo: debitoAlvo!.id,
          valorAbatimento: v,
        };
      } else {
        acao = { tipo: selectedAcao as any, obs: obs.trim() || undefined };
      }

      await onConfirm(acao);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao executar ação financeira.";
      setError(msg);
      setIsSubmitting(false);
    }
    // Não faz setIsSubmitting(false) em caso de sucesso — o modal é fechado externamente
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Overlay — sem onClick (modal obrigatório) */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div className="relative z-10 w-full max-w-lg bg-[#1a1d2e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div
          className={`px-6 py-5 flex items-start gap-3 flex-shrink-0 ${
            isCredito
              ? "bg-gradient-to-r from-emerald-900/60 to-teal-900/40 border-b border-emerald-500/20"
              : "bg-gradient-to-r from-amber-900/60 to-orange-900/40 border-b border-amber-500/20"
          }`}
        >
          <div className={`mt-0.5 text-2xl ${isCredito ? "text-emerald-400" : "text-amber-400"}`}>
            {isCredito ? "💰" : "⚠️"}
          </div>
          <div className="flex-1">
            <h2 className="text-base font-semibold text-white leading-tight">
              Diferença Financeira —{" "}
              <span className={isCredito ? "text-emerald-400" : "text-amber-400"}>
                {isCredito ? "Crédito ao Cliente" : "Débito Adicional"}
              </span>
            </h2>
            <p className="text-xs text-white/50 mt-0.5">
              Proposta #{idInt} · {nomeCliente}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl hover:bg-white/10 text-white/70 hover:text-white transition-colors self-center"
            title="Voltar para proposta"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Resumo financeiro */}
        <div className="px-6 py-4 bg-white/5 border-b border-white/5 grid grid-cols-3 gap-3 text-center flex-shrink-0">
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Valor pago</p>
            <p className="text-sm font-semibold text-white/80">{formatCurrency(valorPagoConfirmado)}</p>
          </div>
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Novo total</p>
            <p className="text-sm font-semibold text-white/80">{formatCurrency(novoTotal)}</p>
          </div>
          <div>
            <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">Diferença</p>
            <p className={`text-sm font-bold ${isCredito ? "text-emerald-400" : "text-amber-400"}`}>
              {isCredito ? "−" : "+"}{formatCurrency(absDiff)}
            </p>
          </div>
        </div>

        {/* Corpo: opções */}
        <div className="px-6 py-5 space-y-3 overflow-y-auto flex-1">
          <p className="text-xs text-white/50 mb-4">
            {isCredito
              ? "O novo total é menor que o valor pago. Escolha o destino do crédito:"
              : "O novo total é maior que o valor pago. Como tratar a diferença?"}
          </p>

          {/* ─── Opções de CRÉDITO ─── */}
          {isCredito && (
            <>
              <RadioOption
                id="manter_credito"
                label="Manter crédito para uso futuro"
                description={`${formatCurrency(absDiff)} ficam disponíveis para abater em próximas propostas deste cliente.`}
                selected={selectedAcao === "MANTER_CREDITO"}
                onSelect={() => setSelectedAcao("MANTER_CREDITO")}
                accent="emerald"
              />

              {canDevolver && (
                <RadioOption
                  id="devolver"
                  label="Devolver ao cliente (solicitar ao Financeiro)"
                  description={`Registra a solicitação de devolução de ${formatCurrency(absDiff)}. O Financeiro receberá uma pendência para confirmar a transferência real ao cliente.`}
                  selected={selectedAcao === "DEVOLVER"}
                  onSelect={() => setSelectedAcao("DEVOLVER")}
                  accent="emerald"
                  badge="2 estágios"
                />
              )}

              <RadioOption
                id="abater_debito"
                label="Abater débito existente"
                description="Usa o crédito para abater um débito em aberto deste cliente. Selecione o débito alvo e o valor no próximo passo."
                selected={selectedAcao === "ABATER_DEBITO"}
                onSelect={() => { setSelectedAcao("ABATER_DEBITO"); setError(null); }}
                accent="emerald"
              />

              {/* Sub-painel de abatimento */}
              {selectedAcao === "ABATER_DEBITO" && (
                <div className="ml-7 bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                  {loadingDebitos && (
                    <p className="text-xs text-white/40">Carregando débitos do cliente...</p>
                  )}
                  {!loadingDebitos && debitos.length === 0 && (
                    <p className="text-xs text-amber-400">
                      ⚠️ Nenhum débito registrado para este cliente. Escolha outra opção.
                    </p>
                  )}
                  {!loadingDebitos && debitos.length > 0 && (
                    <>
                      <p className="text-xs text-white/50">Selecione o débito a abater:</p>
                      <div className="space-y-2 max-h-36 overflow-y-auto">
                        {debitos.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => setDebitoAlvo(d)}
                            className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition-all ${
                              debitoAlvo?.id === d.id
                                ? "border-emerald-500/50 bg-emerald-900/20"
                                : "border-white/10 hover:border-white/20"
                            }`}
                          >
                            <span className="font-medium text-white/80">
                              {formatCurrency(d.valor)}
                            </span>
                            <span className="text-white/40 ml-2">
                              — {d.observacao ?? d.origem} ({new Date(d.created_at).toLocaleDateString("pt-BR")})
                            </span>
                          </button>
                        ))}
                      </div>
                      {debitoAlvo && (
                        <div>
                          <label className="block text-xs text-white/40 mb-1">
                            Valor a abater (máx {formatCurrency(Math.min(absDiff, debitoAlvo.valor))}):
                          </label>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            max={Math.min(absDiff, debitoAlvo.valor)}
                            value={valorAbatimento}
                            onChange={(e) => setValorAbatimento(e.target.value)}
                            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                          />
                          {debitoAlvo.valor - parseFloat(valorAbatimento || "0") > 0 && (
                            <p className="text-[10px] text-white/30 mt-1">
                              Saldo restante do débito após abatimento:{" "}
                              {formatCurrency(debitoAlvo.valor - parseFloat(valorAbatimento || "0"))}
                            </p>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {/* ─── Opções de DÉBITO ─── */}
          {!isCredito && (
            <>
              <RadioOption
                id="debito_pendente_cobranca"
                label="Registrar débito e gerar cobrança depois"
                description={`O débito de ${formatCurrency(absDiff)} é registrado agora. Após fechar, acesse a aba Pagamentos e emita a cobrança complementar (PIX, Boleto ou Cartão) conforme combinado com o cliente.`}
                selected={selectedAcao === "DEBITO_PENDENTE_COBRANCA"}
                onSelect={() => setSelectedAcao("DEBITO_PENDENTE_COBRANCA")}
                accent="amber"
                badge="Recomendado"
              />

              {canBonificar && (
                <RadioOption
                  id="bonificar"
                  label="Bonificar (absorver comercialmente)"
                  description={`A empresa absorve os ${formatCurrency(absDiff)} sem cobrar do cliente. Registrado como bonificação comercial.`}
                  selected={selectedAcao === "BONIFICAR"}
                  onSelect={() => setSelectedAcao("BONIFICAR")}
                  accent="amber"
                />
              )}

              {canDebitoFuturo && (
                <RadioOption
                  id="debito_futuro"
                  label="Registrar como débito futuro"
                  description={`Registra ${formatCurrency(absDiff)} como débito pendente do cliente para cobrança em momento oportuno sem urgência.`}
                  selected={selectedAcao === "DEBITO_FUTURO"}
                  onSelect={() => setSelectedAcao("DEBITO_FUTURO")}
                  accent="amber"
                />
              )}
            </>
          )}

          {/* Aviso DEVOLVER (dois estágios) */}
          {selectedAcao === "DEVOLVER" && (
            <div className="ml-7 flex items-start gap-2 bg-blue-900/20 border border-blue-500/20 rounded-lg px-3 py-2 text-xs text-blue-300">
              <span className="flex-shrink-0">ℹ️</span>
              <span>
                O valor será registrado como solicitação de devolução. O Financeiro receberá
                uma pendência para confirmar que a transferência ao cliente foi realizada.
                A devolução não é automática — precisa ser executada externamente.
              </span>
            </div>
          )}

          {/* Campo de observação */}
          <div className="mt-2">
            <label className="block text-xs text-white/40 mb-1">
              Observação (ficará registrada na timeline da proposta)
            </label>
            <textarea
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 placeholder:text-white/20 resize-none focus:outline-none focus:ring-1 focus:ring-white/20"
              rows={2}
              placeholder="Ex: Cliente solicitou redução de quantidade na reunião de aprovação..."
              maxLength={500}
            />
          </div>

          {/* Erro */}
          {error && (
            <div className="flex items-start gap-2 bg-red-900/20 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between gap-3 bg-white/3 flex-shrink-0">
          <p className="text-[10px] text-white/30 max-w-[220px] leading-relaxed">
            Esta escolha é obrigatória. A alteração estará concluída após confirmar.
          </p>
          <button
            id="btn-confirmar-diferenca-financeira"
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting || !selectedAcao || (selectedAcao === "ABATER_DEBITO" && (!debitoAlvo || debitos.length === 0))}
            className={`
              px-5 py-2 rounded-lg text-sm font-semibold transition-all
              ${
                selectedAcao && !isSubmitting
                  ? isCredito
                    ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg"
                    : "bg-amber-600 hover:bg-amber-500 text-white shadow-lg"
                  : "bg-white/10 text-white/30 cursor-not-allowed"
              }
            `}
          >
            {isSubmitting ? "Registrando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-componente: RadioOption
// ---------------------------------------------------------------------------

function RadioOption({
  id,
  label,
  description,
  selected,
  onSelect,
  accent,
  badge,
}: {
  id: string;
  label: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  accent: "emerald" | "amber";
  badge?: string;
}) {
  const borderColor = selected
    ? accent === "emerald"
      ? "border-emerald-500/50 bg-emerald-900/20"
      : "border-amber-500/50 bg-amber-900/20"
    : "border-white/10 bg-white/3 hover:border-white/20";

  const dotColor = selected
    ? accent === "emerald"
      ? "bg-emerald-400"
      : "bg-amber-400"
    : "bg-transparent border border-white/20";

  return (
    <button
      id={`radio-${id}`}
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-xl border px-4 py-3 transition-all flex items-start gap-3 ${borderColor}`}
    >
      <div className={`mt-0.5 w-4 h-4 rounded-full flex-shrink-0 flex items-center justify-center transition-all ${dotColor}`}>
        {selected && (
          <div className="w-1.5 h-1.5 rounded-full bg-[#1a1d2e]" />
        )}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-white/90 leading-tight">{label}</p>
          {badge && (
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
              accent === "emerald" ? "bg-emerald-900/60 text-emerald-400" : "bg-amber-900/60 text-amber-400"
            }`}>
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-white/40 mt-0.5 leading-relaxed">{description}</p>
      </div>
    </button>
  );
}
