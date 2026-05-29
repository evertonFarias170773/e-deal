"use client";

import { Building2 } from "lucide-react";
import { useCompany } from "@/features/companies/CompanyProvider";

export function CompanySwitcher() {
  const { companies, activeCompany, setActiveCompanyId } = useCompany();

  return (
    <label
      className="flex items-center gap-2 rounded-2xl px-3 py-2 text-sm shadow-sm"
      style={{
        background: "var(--card)",
        border: "1px solid var(--border)"
      }}
    >
      <Building2
        className="h-4 w-4 shrink-0"
        style={{ color: "var(--secondary)" }}
      />
      <span
        className="hidden sm:inline"
        style={{ color: "var(--muted)" }}
      >
        Empresa
      </span>
      <select
        value={activeCompany.id}
        onChange={(event) => setActiveCompanyId(Number(event.target.value))}
        className="max-w-36 border-0 bg-transparent font-medium outline-none md:max-w-none"
        style={{ color: "var(--foreground)" }}
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
