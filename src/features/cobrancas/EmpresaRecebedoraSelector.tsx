import type { EmpresaRecebedoraOption } from "@/features/cobrancas/types";

type EmpresaRecebedoraSelectorProps = {
  empresas: EmpresaRecebedoraOption[];
  selectedId: number | null;
  onSelect: (id: number) => void;
};

export function EmpresaRecebedoraSelector({
  empresas,
  selectedId,
  onSelect
}: EmpresaRecebedoraSelectorProps) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {empresas.map((empresa) => {
        const isSelected = empresa.id === selectedId;

        return (
          <button
            key={empresa.id}
            type="button"
            onClick={() => onSelect(empresa.id)}
            className={`rounded-3xl border p-4 text-left transition ${
              isSelected ? "border-teal-200 bg-teal-50" : "border-slate-200 bg-slate-50 hover:bg-white"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-slate-950">{empresa.labelCurta}</h3>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                credencial futura
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">{empresa.nome}</p>
            <p className="mt-1 text-xs text-slate-500">{empresa.documento}</p>
            <p className="mt-3 text-sm leading-6 text-slate-600">{empresa.fluxoFuturo}</p>
          </button>
        );
      })}
    </div>
  );
}
