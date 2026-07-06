import { executeClientesConsultar } from './implementations/clientes.consultar';
import { executePropostasConsultarPorCliente } from './implementations/propostas.consultar';
import { executePropostasConsultarPorIdInt } from './implementations/propostas.consultar_por_id_int';
import type { ToolResult } from './tools.types';

export async function executeTool(toolId: string, params: Record<string, any>): Promise<ToolResult> {
  // O Dispatcher validou a ferramenta, e o Executor chama a implementação correspondente.
  switch (toolId) {
    case 'clientes.consultar':
      return executeClientesConsultar(params);

    case 'propostas.consultar_por_cliente':
      return executePropostasConsultarPorCliente(params);

    case 'propostas.consultar_por_id_int':
      return executePropostasConsultarPorIdInt(params);
      
    // Bypass mockado para as demais ferramentas do Catálogo ainda não implementadas
    default:
      const startTime = Date.now();
      await new Promise(r => setTimeout(r, 400 + Math.random() * 400)); // fake delay
      return {
        toolId,
        success: true,
        data: { notice: 'Dados mockados gerados pelo bypass.' },
        source: 'mock',
        count: 0,
        executionTime: Date.now() - startTime,
        warnings: [`A ferramenta '${toolId}' não possui implementação real. Bypass ativado.`],
        errors: [],
      };
  }
}
