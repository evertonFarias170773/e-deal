import type { CobrancaParcelaSimulada, CriarCobrancaFormValues } from "@/features/cobrancas/types";
import { InfoBox, PanelCard } from "@/features/cobrancas/form-ui";
import { formatCurrency } from "@/lib/formatters/currency";

type CartaoParceladoMockPanelProps = {
  values: CriarCobrancaFormValues;
  parcelas: CobrancaParcelaSimulada[];
  onChange: (patch: Partial<CriarCobrancaFormValues>) => void;
};

export function CartaoParceladoMockPanel({
  values,
  parcelas,
  onChange
}: CartaoParceladoMockPanelProps) {
  const parcelaSelecionada = values.parcelaSelecionada ?? parcelas[0];

  return (
    <PanelCard
      title="Simulação de cartão parcelado"
      description="Selecione a parcela para salvar visualmente taxa, valor final e status de cartão parcelado."
    >
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          {parcelas.map((parcela) => {
            const isSelected = parcela.parcelas === parcelaSelecionada?.parcelas;

            return (
              <button
                key={parcela.parcelas}
                type="button"
                onClick={() => onChange({ parcelaSelecionada: parcela })}
                className={`w-full rounded-3xl border p-4 text-left transition ${
                  isSelected ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-slate-50 hover:bg-white"
                }`}
              >
                <p className="font-semibold text-slate-950">{parcela.rotulo}</p>
                <p className="mt-2 text-sm text-slate-600">
                  Taxa {parcela.taxaPercentual.toFixed(1)}% | valor final {formatCurrency(parcela.valorFinal)}
                </p>
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <InfoBox label="Valor original" value={formatCurrency(values.valor)} />
          <InfoBox label="Parcelas" value={`${parcelaSelecionada?.parcelas ?? 1}x`} />
          <InfoBox label="Taxa percentual" value={`${(parcelaSelecionada?.taxaPercentual ?? 0).toFixed(1)}%`} />
          <InfoBox label="Valor da taxa" value={formatCurrency(parcelaSelecionada?.valorTaxa ?? 0)} />
          <InfoBox label="Valor final" value={formatCurrency(parcelaSelecionada?.valorFinal ?? values.valor)} />
          <InfoBox label="Valor por parcela" value={formatCurrency(parcelaSelecionada?.valorParcela ?? values.valor)} />
        </div>
      </div>
    </PanelCard>
  );
}
