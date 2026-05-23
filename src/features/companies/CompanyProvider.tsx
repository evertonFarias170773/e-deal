"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { mockCompanies } from "@/lib/mocks/empresas.mock";
import type { Company } from "@/lib/types";

type CompanyContextValue = {
  companies: Company[];
  activeCompany: Company;
  setActiveCompanyId: (companyId: number) => void;
};

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [activeCompanyId, setActiveCompanyId] = useState(0);

  const activeCompany =
    mockCompanies.find((company) => company.id === activeCompanyId) ?? mockCompanies[0];

  const value = useMemo(
    () => ({
      companies: mockCompanies,
      activeCompany,
      setActiveCompanyId
    }),
    [activeCompany]
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany() {
  const context = useContext(CompanyContext);

  if (!context) {
    throw new Error("useCompany deve ser usado dentro de CompanyProvider.");
  }

  return context;
}
