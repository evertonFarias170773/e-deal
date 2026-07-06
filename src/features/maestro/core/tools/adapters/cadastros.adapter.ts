import { getCadastrosReadOnlyList } from '../../../../cadastros/services/cadastros-read.service';
import type { ToolResult } from '../tools.types';

export interface ConsultarClientesParams {
  search?: string;
  idClienteSearch?: string;
}

export async function consultarClientesERP(params: ConsultarClientesParams): Promise<ToolResult> {
  const startTime = Date.now();
  
  try {
    const result = await getCadastrosReadOnlyList({
      pageIndex: 0,
      pageSize: 50, // Truncado para evitar overload na camada do Maestro
      search: params.search,
      idClienteSearch: params.idClienteSearch,
    });

    const executionTime = Date.now() - startTime;

    // Normalizing data for the Maestro Tool (Adapter logic)
    const mappedData = result.cadastros.map(c => ({
      id: c.id,
      /** ID inteiro interno (usado em propostas.id_cliente, pagamentos_v2.id_cliente, etc.) */
      idClienteInterno: c.idCliente,          // número inteiro real do banco
      /** Código de exibição ao usuário (string, ex: "8469") — retrocompat */
      idCliente: c.idClienteText,
      razaoSocial: c.nome,
      nomeFantasia: c.fantasia,
      cpfCnpj: c.documento,
      tipoPessoa: c.tipoPessoa,
      cidade: c.cidadeUf,
      vendedor: c.nomeVendedor,
      telefone: c.telefoneFixo,
      whatsapp: c.whatsapp1 || c.whatsapp2,
      credito: c.credito,
      limiteCredito: c.limiteCredito,
      riscoCredito: c.riscoCredito,
      dataFundacao: c.dataFundacao,
      aniversarianteHoje: c.aniversarianteHoje,
    }));

    return {
      toolId: 'clientes.consultar',
      success: true,
      data: mappedData,
      source: result.source,
      count: mappedData.length,
      executionTime,
      warnings: result.warnings || [],
      errors: result.errorMessage ? [result.errorMessage] : [],
    };
  } catch (err: any) {
    return {
      toolId: 'clientes.consultar',
      success: false,
      data: [],
      source: 'system',
      count: 0,
      executionTime: Date.now() - startTime,
      warnings: [],
      errors: [err.message || 'Erro desconhecido ao consultar clientes no ERP via adapter'],
    };
  }
}
