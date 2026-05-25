import type { Company } from "@/lib/types";

export const mockCompanies: Company[] = [
  {
    id: 0,
    name: "Todas as empresas",
    shortName: "Todas",
    document: "",
    isConsolidated: true
  },
  {
    id: 1,
    name: "Ideal Grafica",
    shortName: "Ideal",
    document: "00.000.000/0001-01"
  },
  {
    id: 2,
    name: "Ideal Biro",
    shortName: "Biro",
    document: "00.000.000/0002-02"
  },
  {
    id: 3,
    name: "E3 Brindes",
    shortName: "E3",
    document: "00.000.000/0003-03"
  }
];
