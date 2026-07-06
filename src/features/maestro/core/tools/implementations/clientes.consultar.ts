import { consultarClientesERP } from '../adapters/cadastros.adapter';
import type { ToolResult } from '../tools.types';

export async function executeClientesConsultar(params: Record<string, any>): Promise<ToolResult> {
  // The Planner/Context would have injected parameters into this tool
  // Here we map the generic parameters from the AI intent into the Adapter arguments
  const search = params.nome || params.razaoSocial || params.documento || params.buscaGeral || (params.targetObject === 'cliente' ? undefined : params.targetObject);
  const idClienteSearch = params.clientId || params.codigoInterno || params.idCliente;

  return consultarClientesERP({
    search,
    idClienteSearch,
  });
}
