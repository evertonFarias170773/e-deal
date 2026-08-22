import type { CreditoAnaliseMock, CriarCobrancaFormValues } from "@/features/cobrancas/types";
import { Field, InfoBox, inputClass, PanelCard } from "@/features/cobrancas/form-ui";
import { formatCurrency } from "@/lib/formatters/currency";

type FaturadoCreditoMockPanelProps = {
  values: CriarCobrancaFormValues;
  analise: CreditoAnaliseMock;
  onChange: (patch: Partial<CriarCobrancaFormValues>) => void;
};

export function FaturadoCreditoMockPanel({
  values,
  analise,
  onChange
}: FaturadoCreditoMockPanelProps) {
  const liberado = analise.disponivel >= analise.valorSolicitado;

  return (
    <PanelCard
      title="Simulação de faturado / crédito"
      description="Analisa o limite do cliente e decide entre liberação imediata ou solicitação ao financeiro."
    >
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <InfoBox label="Limite de crédito" value={formatCurrency(analise.limite)} />
        <InfoBox label="Utilizado" value={formatCurrency(analise.utilizado)} />
        <InfoBox label="Disponível" value={formatCurrency(analise.disponivel)} />
        <InfoBox label="Valor solicitado" value={formatCurrency(analise.valorSolicitado)} />
        <InfoBox label="Risco" value={analise.risco} detail={liberado ? "Crédito disponível." : "Necessita análise financeira."} />
      </div>

      <div className={`mt-4 rounded-3xl border p-4 ${liberado ? "border-teal-200 bg-teal-50 text-teal-800" : "border-orange-200 bg-orange-50 text-orange-800"}`}>
        <p className="font-semibold">{liberado ? "Crédito disponível. Faturamento liberado." : "Crédito insuficiente. Solicitação enviada ao financeiro."}</p>
        <p className="mt-2 text-sm leading-6">
          {liberado
            ? "Ao gerar a cobrança, o mock criará status A_VENCER com confirmado=true."
            : "Ao gerar a cobrança, o mock manterá a cobrança aguardando retorno e registrará mensagem em propostas_chat."}
        </p>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="Vencimento">
          <input
            type="date"
            value={values.vencimento}
            onChange={(event) => onChange({ vencimento: event.target.value })}
            className={inputClass}
          />
        </Field>
        <Field label="Observação">
          <input
            value={values.observacao}
            onChange={(event) => onChange({ observacao: event.target.value })}
            className={inputClass}
          />
        </Field>
      </div>
    </PanelCard>
  );
}
