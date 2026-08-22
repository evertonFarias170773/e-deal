import type { CriarCobrancaFormValues } from "@/features/cobrancas/types";
import { Field, InfoBox, inputClass, PanelCard } from "@/features/cobrancas/form-ui";
import { formatCurrency } from "@/lib/formatters/currency";

type PixMockPanelProps = {
  values: CriarCobrancaFormValues;
  empresaLabel: string;
  onChange: (patch: Partial<CriarCobrancaFormValues>) => void;
};

export function PixMockPanel({ values, empresaLabel, onChange }: PixMockPanelProps) {
  return (
    <PanelCard
      title="Simulação PIX"
      description="Gera link e copia-e-cola de Pix para simulação. Não cobra de verdade."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <InfoBox label="Empresa recebedora" value={empresaLabel} detail="Cada empresa usará credencial própria na integração futura." />
        <InfoBox label="Valor da cobrança" value={formatCurrency(values.valor)} detail="Status inicial previsto: A_RECEBER." />
        <Field label="Expiração do PIX">
          <input
            type="datetime-local"
            value={values.expiracaoPix}
            onChange={(event) => onChange({ expiracaoPix: event.target.value })}
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
      </div>
    </PanelCard>
  );
}
