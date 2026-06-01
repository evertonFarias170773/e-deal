import type { MockUser } from "@/lib/types";

export const mockCurrentUser: MockUser = {
  id: "d3b07384-d113-4ec5-a55e-85a02e693b31",
  name: "Everton Martins",
  email: "everton@ideal.local",
  sector: "ADMIN",
  companyId: 1,
  isAdmin: true,
  isGerente: true,
  isSuperAdmin: true,
  isSeller: true
};

export const mockSellerUser: MockUser = {
  id: "a8a760c6-3023-455e-b9b5-685b5420d440",
  name: "Caroline Silva",
  email: "caroline@ideal.local",
  sector: "COMERCIAL",
  companyId: 2,
  isAdmin: false,
  isGerente: false,
  isSuperAdmin: false,
  isSeller: true
};
