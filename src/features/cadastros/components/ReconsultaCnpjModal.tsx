"use client";

import { Building2, MapPin, RefreshCw, X } from "lucide-react";

import type { LinhaComparacaoReconsulta } from "@/features/cadastros/lib/reconsulta-cnpj";


interface ReconsultaCnpjModalProps {
  isOpen: boolean;
  idCliente: number;
  nomeCliente: string;
  documentoFormatado: string;
  campos: LinhaComparacaoReconsulta[];
  enderecoAtual: string | null;
  enderecoNovo: string | null;
  enderecoMudou: boolean;
  /** `true` quando o cadastro não tem endereço PRINCIPAL — a aplicação vai criar um. */
  criaEnderecoPrincipal: boolean;
  isAplicando: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Confirmação da reconsulta do CNPJ, lado a lado.
 *
 * POR QUE A CONFIRMAÇÃO É OBRIGATÓRIA
 *   A reconsulta SOBRESCREVE o endereço principal do cadastro — a mesma linha
 *   que alimenta a etiqueta dos Correios e o destinatário da NF-e. Aplicar
 *   direto, sem mostrar o que muda, trocaria um endereço errado por outro sem
 *   ninguém perceber. O usuário vê as duas colunas e decide.
 *
 * O QUE ESTE COMPONENTE NÃO FAZ
 *   Nada. Ele é burro de propósito: recebe as linhas já comparadas e devolve
 *   `onConfirm`. Quem consulta, compara e grava é a página do cadastro — assim
 *   a regra de "só sobrescreve o que a Receita devolveu preenchido" mora num
 *   lugar só.
 */
export function ReconsultaCnpjModal({
  isOpen,
  idCliente,
  nomeCliente,
  documentoFormatado,
  campos,
  enderecoAtual,
  enderecoNovo,
  enderecoMudou,
  criaEnderecoPrincipal,
  isAplicando,
  onClose,
  onConfirm
}: ReconsultaCnpjModalProps) {
  if (!isOpen) return null;

  const camposAlterados = campos.filter((linha) => linha.mudou).length;
  const temEndereco = Boolean(enderecoNovo);
  const nadaMuda = camposAlterados === 0 && !enderecoMudou;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar reconsulta do CNPJ"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-blue-50 p-2.5 text-blue-700">
              <RefreshCw className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold leading-tight text-slate-900">
                Reconsulta do CNPJ
              </h3>
              <p className="mt-0.5 text-xs text-slate-500">
                <span className="font-mono">ID {idCliente}</span> · {nomeCliente || "Sem nome"} ·{" "}
                <span className="font-mono">{documentoFormatado}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isAplicando}
            className="rounded-xl p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {nadaMuda ? (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              A Receita devolveu exatamente o que já está gravado. Não há nada para aplicar.
            </p>
          ) : (
            <p className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">
              Ao aplicar, os valores da coluna <strong>Receita Federal</strong> substituem os
              gravados. O endereço marcado <strong>PRINCIPAL</strong> é sobrescrito; endereços de
              Entrega, Cobrança e Fiscal não são tocados, e nenhum endereço é apagado.
            </p>
          )}

          <section>
            <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
              <Building2 className="h-4 w-4 text-slate-400" />
              Dados do cadastro
              <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                {camposAlterados} {camposAlterados === 1 ? "mudança" : "mudanças"}
              </span>
            </h4>

            {campos.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-xs text-slate-500">
                A consulta não devolveu nenhum campo preenchido além do endereço.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2.5 font-semibold">Campo</th>
                      <th className="px-4 py-2.5 font-semibold">Gravado hoje</th>
                      <th className="px-4 py-2.5 font-semibold">Receita Federal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campos.map((linha) => (
                      <tr
                        key={linha.rotulo}
                        className={`border-t border-slate-100 ${linha.mudou ? "bg-blue-50/40" : ""}`}
                      >
                        <td className="px-4 py-2.5 font-semibold text-slate-700">{linha.rotulo}</td>
                        <td className="px-4 py-2.5 text-slate-500">
                          {linha.atual || <span className="italic text-slate-400">vazio</span>}
                        </td>
                        <td
                          className={`px-4 py-2.5 ${
                            linha.mudou ? "font-semibold text-blue-800" : "text-slate-500"
                          }`}
                        >
                          {linha.novo || <span className="italic text-slate-400">vazio</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mt-6">
            <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-800">
              <MapPin className="h-4 w-4 text-slate-400" />
              Endereço principal
              {criaEnderecoPrincipal && temEndereco ? (
                <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  será criado
                </span>
              ) : null}
            </h4>

            {!temEndereco ? (
              <p className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-xs text-slate-500">
                A consulta não devolveu endereço. O endereço gravado permanece como está.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Gravado hoje
                  </span>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                    {enderecoAtual || (
                      <span className="italic text-slate-400">
                        Nenhum endereço principal cadastrado.
                      </span>
                    )}
                  </p>
                </div>
                <div
                  className={`rounded-2xl border p-4 ${
                    enderecoMudou ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Receita Federal
                  </span>
                  <p
                    className={`mt-1.5 text-sm leading-relaxed ${
                      enderecoMudou ? "font-semibold text-blue-900" : "text-slate-600"
                    }`}
                  >
                    {enderecoNovo}
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isAplicando}
            className="rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isAplicando || nadaMuda}
            className="rounded-2xl bg-[#0b2f4a] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0d3a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAplicando ? "Aplicando..." : "Aplicar ao cadastro"}
          </button>
        </div>
      </div>
    </div>
  );
}
