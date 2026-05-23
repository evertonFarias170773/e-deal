import type { Proposta } from "@/features/orcamentos/types";
import { formatCurrency } from "@/lib/formatters/currency";
import { StatusBadge } from "@/components/common/StatusBadge";

type PropostaCobrancaSelectorProps = {
  propostas: Proposta[];
  selectedIdInt: number | null;
  onSelect: (idInt: number) => void;
};

export function PropostaCobrancaSelector({
  propostas,
  selectedIdInt,
  onSelect
}: PropostaCobrancaSelectorProps) {
  return (
    <div className="grid gap-3">
      {propostas.map((proposta) => {
        const isSelected = proposta.id_int === selectedIdInt;

        return (
          <button
            key={proposta.id}
            type="button"
            onClick={() => onSelect(proposta.id_int)}
            className={`rounded-3xl border p-4 text-left transition ${
              isSelected ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-slate-50 hover:bg-white"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Proposta #{proposta.id_int}</p>
                <h3 className="mt-2 font-semibold text-slate-950">{proposta.cliente.nome}</h3>
                <p className="mt-1 text-sm text-slate-500">{proposta.cliente.documento}</p>
              </div>
              <StatusBadge status={proposta.status} tone={proposta.status === "APROVADO" ? "success" : "warning"} />
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <InfoPill label="Empresa" value={proposta.empresa} />
              <InfoPill label="Vendedor" value={proposta.vendedor} />
              <InfoPill label="Valor total" value={formatCurrency(proposta.resumo.valorTotal)} />
              <InfoPill label="Frete" value={formatCurrency(proposta.resumo.frete)} />
            </div>

            <p className="mt-4 text-sm leading-6 text-slate-600">{proposta.observacoes}</p>
          </button>
        );
      })}
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
