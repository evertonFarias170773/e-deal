import type { ConversationContext } from '../../types';
import type { ResponseModel } from '../../core/response/response.types';

export function comercialResponsePresenter(
  query: string,
  toolResult: any,
  context: ConversationContext
): ResponseModel {
  const toolId = context.registryResolution?.results[0]?.toolId;

  if (toolId === 'clientes.consultar') {
    return presenterClientesConsultar(query, toolResult, context);
  }

  return {
    title: 'Comercial',
    summary: 'Ação comercial executada.',
  };
}

function presenterClientesConsultar(
  query: string,
  toolResult: any,
  context: ConversationContext
): ResponseModel {
  const clientes = toolResult.data || [];

  if (!clientes || clientes.length === 0) {
    return {
      title: 'Cliente Não Localizado',
      summary: `Não encontrei o cliente informado no cadastro.`,
      recommendations: [
        'Você pode informar:',
        '- código;',
        '- nome;',
        '- CPF/CNPJ.'
      ],
    };
  }

  if (clientes.length === 1) {
    const c = clientes[0];
    
    // Fallback de Summary Genérico vs "Micro-IA" contextual
    let summary = `Cliente **${c.idCliente || c.id}** localizado.`;

    const q = query.toLowerCase();
    if (q.includes('telefone') || q.includes('contato') || q.includes('celular') || q.includes('whatsapp')) {
      const tel = c.whatsapp || c.telefone || 'não cadastrado';
      summary = `O telefone/WhatsApp de **${c.razaoSocial}** é **${tel}**.`;
    } else if (q.includes('cnpj') || q.includes('cpf') || q.includes('documento')) {
      const doc = c.cpfCnpj || 'não informado';
      summary = `O CNPJ/CPF de **${c.razaoSocial}** é **${doc}**.`;
    } else if (q.includes('cidade') || q.includes('uf') || q.includes('estado') || q.includes('local') || q.includes('fica') || q.includes('endereco') || q.includes('endereço')) {
      const loc = c.cidade || 'não informada';
      summary = `O cliente **${c.razaoSocial}** está localizado em **${loc}**.`;
    } else if (q.includes('email') || q.includes('e-mail')) {
      const em = c.email || 'não cadastrado';
      summary = `O e-mail de **${c.razaoSocial}** é **${em}**.`;
    } else if (q.includes('vendedor')) {
      const vend = c.vendedor || 'não vinculado';
      summary = `O vendedor responsável por **${c.razaoSocial}** é **${vend}**.`;
    } else if (q.includes('crédito') || q.includes('credito') || q.includes('limite')) {
      const cred = typeof c.credito === 'number'
        ? c.credito.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : 'não disponível';
      const lim = typeof c.limiteCredito === 'number'
        ? c.limiteCredito.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
        : 'não disponível';
      summary = `**${c.razaoSocial}** tem limite de crédito de **${lim}** e crédito disponível de **${cred}**.`;
    } else if (q.includes('cadastro') || q.includes('data') || q.includes('fundação') || q.includes('fundacao') || q.includes('criado')) {
      const data = c.dataFundacao ? new Date(c.dataFundacao).toLocaleDateString('pt-BR') : 'não informada';
      summary = `O cliente **${c.razaoSocial}** foi cadastrado em **${data}**.`;
    } else if (q.includes('quem é') || q.includes('quem e') || q.includes('quem')) {
      summary = `O cliente **${c.idCliente || c.id}** é a **${c.razaoSocial}**${c.nomeFantasia ? ` (${c.nomeFantasia})` : ''}.`;
    } else if (q.includes('situação') || q.includes('situacao') || q.includes('bloqueado') || q.includes('ativo') || q.includes('inativo')) {
      const sit = c.riscoCredito || c.tipoPessoa || 'Ativo';
      summary = `A situação de **${c.razaoSocial}** no ERP é: **${sit}**.`;
    }

    return {
      title: 'Cliente localizado',
      summary,
      cards: [
        {
          title: 'Dados Cadastrais',
          metadata: {
            'Código': c.idCliente?.toString() || c.id?.toString() || '-',
            'Razão Social': c.razaoSocial || '-',
            'Nome Fantasia': c.nomeFantasia || '-',
            'CPF/CNPJ': c.cpfCnpj || '-',
            'Situação': c.tipoPessoa || 'Ativo',
            'Cidade / UF': c.cidade || '-',
            'Telefone / WhatsApp': c.whatsapp || c.telefone || 'Não informado',
            'E-mail': c.email || 'Não informado',
            'Data de cadastro': c.dataFundacao ? new Date(c.dataFundacao).toLocaleDateString('pt-BR') : '-',
          }
        }
      ],
      recommendations: [
        'Posso também:',
        '• consultar propostas desse cliente;',
        '• consultar pedidos;',
        '• consultar financeiro;',
        '• consultar produção.'
      ]
    };
  }

  // Múltiplos
  return {
    title: 'Múltiplos Clientes Encontrados',
    summary: `Foram encontrados ${clientes.length} cadastros correspondentes à sua busca.`,
    explanation: 'Como a busca retornou mais de um resultado, listamos abaixo as opções. Qual deles você deseja analisar?',
    tables: [
      {
        headers: ['Código', 'Razão Social', 'CNPJ/CPF', 'Cidade'],
        rows: clientes.map((c: any) => [
          c.idCliente?.toString() || '-',
          c.razaoSocial || '-',
          c.cpfCnpj || '-',
          c.cidade || '-'
        ])
      }
    ]
  };
}
