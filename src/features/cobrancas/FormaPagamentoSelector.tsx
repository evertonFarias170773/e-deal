import type { CobrancaTipo } from "@/features/cobrancas/types";
import { tiposCobrancaMock } from "@/lib/mocks/pagamentos.mock";

type FormaPagamentoSelectorProps = {
  value: CobrancaTipo;
  onChange: (value: CobrancaTipo) => void;
};

export function FormaPagamentoSelector({ value, onChange }: FormaPagamentoSelectorProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {tiposCobrancaMock.map((tipo) => {
        const isSelected = tipo.id === value;

        return (
          <button
            key={tipo.id}
            type="button"
            onClick={() => onChange(tipo.id)}
            className={`rounded-3xl border p-4 text-left transition ${
              isSelected ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-slate-50 hover:bg-white"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-slate-950">{tipo.label}</h3>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                mock
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">{tipo.descricao}</p>
          </button>
        );
      })}
    </div>
  );
}
