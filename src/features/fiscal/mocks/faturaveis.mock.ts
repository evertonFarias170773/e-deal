import type { FaturavelOrigem } from "../types";

export const faturaveisMocks: FaturavelOrigem[] = [
  {
    id: "fat-pedido-1",
    tipo: "PEDIDO",
    ref_origem: "PED-18290-A",
    id_cliente: 11311,
    cliente_nome: "Marcio Roberto Rocha Cardoso",
    cliente_fantasia: "Marcio Roberto Rocha Cardoso",
    id_empresa: 1,
    status: "PENDENTE",
    valor_total: 1540.00,
    created_at: "2026-06-02T10:00:00Z",
    itens: [
      {
        id: "item-1-1",
        descricao: "Impressão de Credenciais Pro",
        quantidade: 1000,
        valor_unitario: 1.20,
        valor_total: 1200.00,
        ncm: "49111090",
        cfop: "5101"
      },
      {
        id: "item-1-2",
        descricao: "Pulseiras de Identificação Tyvek",
        quantidade: 1000,
        valor_unitario: 0.34,
        valor_total: 340.00,
        ncm: "39269090",
        cfop: "5101"
      }
    ]
  },
  {
    id: "fat-pedido-2",
    tipo: "PEDIDO",
    ref_origem: "PED-18292-B",
    id_cliente: 922723,
    cliente_nome: "Carol Embalagens Ltda",
    cliente_fantasia: "Carol Embalagens",
    id_empresa: 2,
    status: "PENDENTE",
    valor_total: 820.00,
    created_at: "2026-06-03T14:15:00Z",
    itens: [
      {
        id: "item-2-1",
        descricao: "Caixas de Papelão Personalizadas",
        quantidade: 200,
        valor_unitario: 4.10,
        valor_total: 820.00,
        ncm: "48191000",
        cfop: "5102"
      }
    ]
  },
  {
    id: "fat-os-1",
    tipo: "OS",
    ref_origem: "OS-19001",
    id_cliente: 11311,
    cliente_nome: "Marcio Roberto Rocha Cardoso",
    cliente_fantasia: "Marcio Roberto Rocha Cardoso",
    id_empresa: 3,
    status: "PENDENTE",
    valor_total: 1250.00,
    created_at: "2026-06-01T09:30:00Z",
    itens: [
      {
        id: "item-3-1",
        descricao: "Desenho e Layout de Credenciais",
        quantidade: 1,
        valor_unitario: 1250.00,
        valor_total: 1250.00,
        ncm: "00000000",
        cfop: "0000"
      }
    ]
  },
  {
    id: "fat-os-2",
    tipo: "OS",
    ref_origem: "OS-19002",
    id_cliente: 922723,
    cliente_nome: "Carol Embalagens Ltda",
    cliente_fantasia: "Carol Embalagens",
    id_empresa: 1,
    status: "PENDENTE",
    valor_total: 450.00,
    created_at: "2026-06-03T11:45:00Z",
    itens: [
      {
        id: "item-4-1",
        descricao: "Assessoria em Design de Facas de Corte",
        quantidade: 1,
        valor_unitario: 450.00,
        valor_total: 450.00,
        ncm: "00000000",
        cfop: "0000"
      }
    ]
  }
];
