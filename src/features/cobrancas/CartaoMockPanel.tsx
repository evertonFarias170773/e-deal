import type { CriarCobrancaFormValues } from "@/features/cobrancas/types";
import { Field, InfoBox, inputClass, PanelCard } from "@/features/cobrancas/form-ui";
import { formatCurrency } from "@/lib/formatters/currency";

type CartaoMockPanelProps = {
  values: CriarCobrancaFormValues;
  empresaLabel: string;
  onChange: (patch: Partial<CriarCobrancaFormValues>) => void;
};

export function CartaoMockPanel({ values, empresaLabel, onChange }: CartaoMockPanelProps) {
  return (
    <PanelCard
      title="Simulação de cartão de crédito"
      description="Simulação de checkout de cartão. Ainda não cobra de verdade."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <InfoBox label="Empresa recebedora" value={empresaLabel} detail="Cobrança real de cartão ainda não está disponível." />
        <InfoBox label="Valor" value={formatCurrency(values.valor)} detail="Status inicial previsto: A_RECEBER." />
        <Field label="Descrição">
          <input
            value={values.descricao}
            onChange={(event) => onChange({ descricao: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Captura automática (simulada)">
          <select
            value={values.capturaAutomatica ? "SIM" : "NAO"}
            onChange={(event) => onChange({ capturaAutomatica: event.target.value === "SIM" })}
            className={inputClass}
          >
            <option value="SIM">Sim</option>
            <option value="NAO">Não</option>
          </select>
        </Field>
      </div>
    </PanelCard>
  );
}
