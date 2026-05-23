import type { CriarCobrancaFormValues } from "@/features/cobrancas/types";
import { Field, InfoBox, inputClass, PanelCard } from "@/features/cobrancas/form-ui";
import { formatCurrency } from "@/lib/formatters/currency";

type BoletoMockPanelProps = {
  values: CriarCobrancaFormValues;
  empresaLabel: string;
  onChange: (patch: Partial<CriarCobrancaFormValues>) => void;
};

export function BoletoMockPanel({ values, empresaLabel, onChange }: BoletoMockPanelProps) {
  return (
    <PanelCard
      title="Simulação de boleto"
      description="Mantém vencimento, multa e juros como placeholders visuais para futura integração segura."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <InfoBox label="Empresa recebedora" value={empresaLabel} detail="Fluxo futuro separado por empresa." />
        <InfoBox label="Valor" value={formatCurrency(values.valor)} detail="Status inicial previsto: A_RECEBER." />
        <Field label="Vencimento">
          <input
            type="date"
            value={values.vencimento}
            onChange={(event) => onChange({ vencimento: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Descrição">
          <input
            value={values.descricao}
            onChange={(event) => onChange({ descricao: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Multa (%)">
          <input
            type="number"
            min={0}
            step="0.1"
            value={values.multaPercentual}
            onChange={(event) => onChange({ multaPercentual: Number(event.target.value) || 0 })}
            className={inputClass}
          />
        </Field>
        <Field label="Juros (%)">
          <input
            type="number"
            min={0}
            step="0.1"
            value={values.jurosPercentual}
            onChange={(event) => onChange({ jurosPercentual: Number(event.target.value) || 0 })}
            className={inputClass}
          />
        </Field>
      </div>
    </PanelCard>
  );
}
