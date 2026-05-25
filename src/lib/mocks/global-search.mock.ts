import type { GlobalSearchResult } from "@/lib/types";

export const globalSearchResultsMock: GlobalSearchResult[] = [
  {
    id: "cliente-gremio",
    type: "Cliente",
    title: "Gremio Football Porto Alegrense",
    description: "Cliente #922723 - Porto Alegre/RS",
    href: "/cadastros/922723"
  },
  {
    id: "proposta-16790",
    type: "Proposta",
    title: "Proposta 16790",
    description: "Pulseiras e credenciais - R$ 8.420,00",
    href: "/orcamentos"
  },
  {
    id: "boleto-123456",
    type: "Boleto",
    title: "Boleto 123456-C",
    description: "Vencimento em 21/05/2026 - R$ 1.240,00",
    href: "/contas-a-receber"
  },
  {
    id: "nfe-16604",
    type: "NF-e",
    title: "NFE-16604-001",
    description: "Autorizada - Ideal Biro - R$ 120,00",
    href: "/notas-fiscais"
  },
  {
    id: "os-0001",
    type: "OS",
    title: "OS-0001",
    description: "Credenciais PVC em producao",
    href: "/os-producao"
  },
  {
    id: "documento-cnpj",
    type: "Documento",
    title: "04.142.031/0001-38",
    description: "Entre Pontos Express LTDA",
    href: "/cadastros/120017"
  },
  {
    id: "produto-triband",
    type: "Produto",
    title: "Pulseira Triband",
    description: "Produto #101 - Pulseiras - 25x2cm",
    href: "/produtos/101"
  },
  {
    id: "produto-cartao-pvc",
    type: "Produto",
    title: "Cartao PVC 0,76mm",
    description: "Produto #801 - Cartoes - usado pelo Maestro",
    href: "/produtos/801"
  },
  {
    id: "proposta-16790-produtos",
    type: "Proposta",
    title: "Proposta 16790",
    description: "Entre Pontos Express LTDA - pulseiras e ingressos",
    href: "/orcamentos/16790"
  },
  {
    id: "proposta-16804",
    type: "Proposta",
    title: "Proposta 16804",
    description: "Gremio - credenciais PVC - aguardando",
    href: "/orcamentos/16804"
  }
];
