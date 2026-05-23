"use client";

import { Building2 } from "lucide-react";
import { useCompany } from "@/features/companies/CompanyProvider";

export function CompanySwitcher() {
  const { companies, activeCompany, setActiveCompanyId } = useCompany();

  return (
    <label className="flex items-center gap-2 rounded-2xl border border-[#d7e5e8] bg-white px-3 py-2 text-sm shadow-sm">
      <Building2 className="h-4 w-4 text-[#0f9f9a]" />
      <span className="hidden text-slate-500 sm:inline">Empresa</span>
      <select
        value={activeCompany.id}
        onChange={(event) => setActiveCompanyId(Number(event.target.value))}
        className="max-w-36 border-0 bg-transparent font-medium text-slate-800 outline-none md:max-w-none"
      >
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.shortName}
          </option>
        ))}
      </select>
    </label>
  );
}
