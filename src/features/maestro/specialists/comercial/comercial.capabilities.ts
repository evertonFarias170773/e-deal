import type { SpecialistCapabilities } from '../specialist.types';

export const ComercialCapabilities: SpecialistCapabilities = {
  supportedDomains: ['comercial', 'vendas', 'clientes', 'propostas', 'produtos'],
  supportedIntents: ['consultar', 'listar', 'explicar', 'orientar', 'analisar'],
  supportedObjects: ['cliente', 'proposta', 'produto', 'catalogo', 'pedido'],
  supportedTools: ['clientes.consultar', 'propostas.consultar', 'produtos.consultar'],
  supportedActions: ['nova_proposta', 'ver_financeiro', 'editar_cliente']
};
