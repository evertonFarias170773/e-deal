"use client";

import { Field, inputClass } from "@/features/cobrancas/form-ui";
import { formatCurrency } from "@/lib/formatters/currency";
import { centavosDoValor } from "@/features/orcamentos/lib/total-no-centavo";
import { dividirFaturadoComEntrada, type FormaDaEntrada } from "@/features/cobrancas/lib/faturado-com-entrada";

/**
 * Campos do "Faturado com entrada" (06/11/2026): forma e valor da entrada, e o
 * restante que vira Faturado. A condição do faturado é o select de sempre, logo
 * acima, no quadro "Campos mínimos do faturado".
 */
type Props = {
  totalProposta: number;
  formaEntrada: FormaDaEntrada;
  onFormaEntrada: (forma: FormaDaEntrada) => void;
  valorEntrada: string;
  onValorEntrada: (valor: string) => void;
  pixDisponivel: boolean;
  boletoDisponivel: boolean;
};

/** "1.234,56" ou "1234.56" -> número. */
export function lerValorDigitado(texto: string): number {
  const limpo = String(texto ?? "").trim();
  if (!limpo) return 0;
  const normalizado = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : NaN;
}

export function FaturadoComEntradaCampos({
  totalProposta,
  formaEntrada,
  onFormaEntrada,
  valorEntrada,
  onValorEntrada,
  pixDisponivel,
  boletoDisponivel
}: Props) {
  const divisao = dividirFaturadoComEntrada(centavosDoValor(totalProposta), centavosDoValor(lerValorDigitado(valorEntrada)));

  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-teal-100 bg-teal-50/40 p-4">
      <p className="text-sm font-semibold text-slate-900">Entrada</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Forma da entrada *">
          <div className="flex gap-2">
            {(["PIX", "BOLETO"] as const).map((forma) => {
              const disponivel = forma === "PIX" ? pixDisponivel : boletoDisponivel;
              const marcada = formaEntrada === forma;
              return (
                <button
                  key={forma}
                  type="button"
                  disabled={!disponivel}
                  onClick={() => onFormaEntrada(forma)}
                  className={`flex-1 rounded-2xl border px-3 py-2 text-sm font-semibold transition ${
                    marcada ? "border-[#0f9f9a] bg-[#dff8f6] text-slate-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  } disabled:cursor-not-allowed disabled:opacity-50`}
                >
                  {forma === "PIX" ? "PIX" : "Boleto"}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Valor da entrada *">
          <input
            type="text"
            inputMode="decimal"
            value={valorEntrada}
            onChange={(e) => onValorEntrada(e.target.value)}
            placeholder="0,00"
            className={inputClass}
          />
        </Field>
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <p className="text-slate-600">
          Total da proposta: <strong className="text-slate-900">{formatCurrency(totalProposta)}</strong>
        </p>
        <p className="text-slate-600">
          Entrada: <strong className="text-slate-900">{divisao.ok ? formatCurrency(divisao.entradaCentavos / 100) : "—"}</strong>
        </p>
        <p className="text-slate-600">
          Restante faturado: <strong className="text-slate-900">{divisao.ok ? formatCurrency(divisao.restanteCentavos / 100) : "—"}</strong>
        </p>
      </div>
      {!divisao.ok && valorEntrada.trim() ? <p className="text-xs text-orange-700">{divisao.message}</p> : null}
      <p className="text-xs leading-relaxed text-slate-500">
        Ao gerar, nascem duas cobranças juntas: a entrada, por {formaEntrada === "PIX" ? "PIX" : "boleto"}, e o restante,
        Faturado com a condição escolhida. Se uma não puder ser criada, nenhuma é.
      </p>
    </div>
  );
}
