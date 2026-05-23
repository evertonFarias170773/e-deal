import type { MockUser } from "@/lib/types";

export const mockCurrentUser: MockUser = {
  id: "user_mock_001",
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
  id: "user_mock_002",
  name: "Caroline Silva",
  email: "caroline@ideal.local",
  sector: "COMERCIAL",
  companyId: 2,
  isAdmin: false,
  isGerente: false,
  isSuperAdmin: false,
  isSeller: true
};
