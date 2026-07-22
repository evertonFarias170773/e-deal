/**
 * maestro-simple-presenter.ts
 *
 * Formata respostas amigáveis para o Maestro Simple v1.
 * Produz ConversationMessage com o mesmo formato esperado pela UI.
 *
 * REGRAS FASE CLIENTE 100%:
 * - Nunca expor texto técnico
 * - Citar fonte de dados com precisão
 * - Não assumir cidade oficial se houver divergência com endereços
 * - Tratar bônus e crédito corretamente
 * - Não usar data_cadastro como fundação
 */

import type {
  ConversationMessage,
  ActivityStep,
  MessageSource,
  MessageComponent,
} from '../../types';
import type {
  SimpleClientContext,
  SimpleMaestroContext,
  LastAnswerRecord,
} from './maestro-simple-context';
import type { MaestroPeriodo } from './maestro-simple-intents';
import type {
  RecebimentosResult,
  ComparacaoRecebimentosResult,
  ComparacaoItem,
} from './maestro-simple-pagamentos.server';
import type { OrcamentoAvulsoResult } from './maestro-simple-produtos.server';
import type { OrcamentoAvulsoItem, ActiveQuoteSnapshot } from './maestro-v2-context-manager';
import type { OrcamentoAvulsoItemReq } from './maestro-simple-produtos.server';
import type { PropostaFrete } from '@/features/orcamentos/types';
import type { OrcamentoServiceResult } from './maestro-orcamento-service.server';
import { resolverTermoCatalogo } from './maestro-orcamento-catalogo-oficial';

export interface PresenterResult {
  message: ConversationMessage;
  activity: ActivityStep[];
  lastAnswerUpdate?: LastAnswerRecord | null;
}

// ─── Utilidades ───────────────────────────────────────────────────────────

let _counter = 0;
function genId(prefix = 'maestro'): string {
  _counter += 1;
  return `${prefix}-${Date.now()}-${_counter}`;
}
function now(): string { return new Date().toISOString(); }
function nowTime(): string {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Seleciona o frete sugerido: prioriza Sedex (por nome da transportadora ou servi\u00e7o).
 * Fallback: menor valor dispon\u00edvel.
 */
function selecionarFreteSugerido(fretes: PropostaFrete[]): PropostaFrete {
  const sedex = fretes.find(f => {
    const transp = (f.transportadora || '').toLowerCase();
    const servico = (f.servico || '').toLowerCase();
    const id = (f.id || '').toLowerCase();
    return transp.includes('sedex') || servico.includes('sedex') || id.includes('sedex');
  });
  if (sedex) return sedex;
  const validFretes = fretes.filter(f => f.id !== 'retira_balcao');
  if (validFretes.length > 0) {
    return validFretes.sort((a, b) => a.valor - b.valor)[0];
  }
  return fretes[0];
}


function formatBRL(v: number | null | undefined): string {
  if (typeof v !== 'number') return 'não disponível';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatPercent(v: number | null | undefined): string {
  if (typeof v !== 'number') return '';
  return `${v}%`;
}

function orND(v: string | null | undefined, label?: string): string {
  if (!v || v.trim() === '') return label ? `${label} não cadastrado` : 'não cadastrado';
  return v;
}

function formatDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return raw;
}

function getSource(c: SimpleClientContext, table: 'clientes' | 'enderecos' | 'contatos' | 'clientes_socios' = 'clientes'): MessageSource {
  let tableName = c.source;
  if (table === 'enderecos') tableName = c.fontesRelacoes?.enderecos || 'public.enderecos';
  if (table === 'contatos') tableName = c.fontesRelacoes?.contatos || 'public.contatos';
  if (table === 'clientes_socios') tableName = c.fontesRelacoes?.socios || 'public.clientes_socios';

  return {
    table: tableName,
    label: `Fonte: ${tableName} · cliente ${c.clientDisplayCode}`,
    queriedAt: c.queriedAt,
  };
}

// ─── Divergência de Cidades ──────────────────────────────────────────────

/**
 * Retorna as cidades únicas encontradas nos endereços que são diferentes da cidade_uf.
 */
function getCidadesDivergentes(c: SimpleClientContext): string[] {
  if (!c.clientCityUf || !c.enderecos || c.enderecos.length === 0) return [];
  const baseCity = c.clientCityUf.split('-')[0].trim().toLowerCase();
  
  const divergentes = new Set<string>();
  c.enderecos.forEach(e => {
    if (e.cidade) {
      const eCity = e.cidade.trim().toLowerCase();
      if (eCity !== baseCity) {
        divergentes.add(`${e.cidade.trim()} - ${e.uf || '?'}`);
      }
    }
  });
  return Array.from(divergentes);
}

// ─── Presenter: Cliente Encontrado ───────────────────────────────────────

export function presenterClienteEncontrado(
  cliente: SimpleClientContext
): PresenterResult {
  const nome     = cliente.clientName || `Cliente ${cliente.clientDisplayCode}`;
  const fantasia = cliente.clientFantasia && cliente.clientFantasia !== nome
    ? ` (${cliente.clientFantasia})`
    : '';
  const tel      = orND(cliente.clientPhone);
  const email    = orND(cliente.clientEmail);
  const cidade   = orND(cliente.clientCityUf);
  const vendedor = orND(cliente.clientSeller);
  const doc      = orND(cliente.clientDocument);
  const limite   = formatBRL(cliente.clientCreditLimit);
  const credito  = formatBRL(cliente.clientCredit);

  const partes: string[] = [`Encontrei **${nome}${fantasia}**, código **${cliente.clientDisplayCode}**.`];
  if (cliente.clientSeller) partes.push(`Vendedor responsável: **${cliente.clientSeller}**.`);
  if (typeof cliente.clientCreditLimit === 'number') {
    partes.push(`Limite de crédito: **${limite}**.`);
  }
  partes.push('Confira os dados completos no card abaixo.');

  const components: MessageComponent[] = [
    {
      type: 'card',
      data: {
        title:    nome,
        subtitle: `Código: ${cliente.clientDisplayCode}`,
        items: [
          { label: 'CNPJ/CPF',            value: doc },
          { label: 'Telefone/WhatsApp',    value: tel },
          { label: 'E-mail',               value: email },
          { label: 'Cidade/UF',            value: cidade },
          { label: 'Vendedor',             value: vendedor },
          { label: 'Limite de crédito',    value: limite },
          { label: 'Crédito disponível',   value: credito },
          ...(cliente.clientDataFundacao
            ? [{ label: 'Fundação', value: formatDate(cliente.clientDataFundacao) || cliente.clientDataFundacao }]
            : []),
        ].filter(item => item.value !== 'não cadastrado'),
      },
    },
  ];

  const lastAnswer: LastAnswerRecord = {
    type:      'client_found',
    value:     `${nome} (${cliente.clientDisplayCode})`,
    label:     'Cliente localizado',
    dbField:   'id_cliente',
    source:    cliente.source || 'public.clientes',
    confidence: 'high',
    reason:    `Encontrei o cliente pelo código/busca e carreguei o cadastro completo da entidade clientes.`,
    answeredAt: now(),
  };

  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     partes.join(' '),
      contentType: 'card',
      components,
      sources:     [getSource(cliente)],
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [
      { id: 'step-1', label: 'Identificando cliente',                         status: 'done', timestamp: nowTime() },
      { id: 'step-2', label: `Consultando dados`,                             status: 'done', timestamp: nowTime() },
      { id: 'step-3', label: 'Cliente localizado',                            status: 'done', detail: nome, timestamp: nowTime() },
    ],
    lastAnswerUpdate: lastAnswer,
  };
}

// ─── Presenter: Não Encontrado & Erros ───────────────────────────────────

export function presenterClienteNaoEncontrado(busca: string): PresenterResult {
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     `Não encontrei nenhum cliente com **"${busca}"** no ERP. Verifique o código, CNPJ ou nome e tente novamente.`,
      contentType: 'text',
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'medium',
    },
    activity: [
      { id: 'step-1', label: 'Consultando cliente no ERP', status: 'done',  timestamp: nowTime() },
      { id: 'step-2', label: 'Nenhum resultado encontrado', status: 'done', timestamp: nowTime() },
    ],
    lastAnswerUpdate: null,
  };
}

export function presenterClienteMultiplosCandidatos(busca: string, candidates: any[]): PresenterResult {
  const lista = candidates.map((c, i) => `${i + 1}. **${c.nome}**${c.fantasia ? ` (${c.fantasia})` : ''}\n   *Documento: ${c.documento || 'ND'} — Cidade: ${c.cidade_uf || 'ND'} (Código: ${c.id_cliente})*`).join('\n\n');
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     `Não encontrei exatamente o nome **"${busca}"**, mas encontrei ${candidates.length} cadastros parecidos. Deseja usar algum destes?\n\n${lista}\n\n*Responda com o código do cliente desejado.*`,
      contentType: 'text',
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'medium',
    },
    activity: [
      { id: 'step-1', label: 'Consultando cliente no ERP', status: 'done',  timestamp: nowTime() },
      { id: 'step-2', label: 'Candidatos parciais encontrados', status: 'done', timestamp: nowTime() },
    ],
    lastAnswerUpdate: null,
  };
}

export function presenterClienteMatchParcial(busca: string, candidate: any): PresenterResult {
  const nome = candidate.nome || candidate.fantasia || 'cadastro';
  const cidade = candidate.cidade_uf ? ` — ${candidate.cidade_uf}` : '';
  const doc = candidate.documento ? ` | Doc: ${candidate.documento}` : '';
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     `Não encontrei exatamente **"${busca}"**, mas encontrei um cadastro parecido:\n\n**${nome}** (Código: ${candidate.id_cliente}${cidade}${doc})\n\n*Este é o cliente que você quer consultar? Responda com o código para confirmar ou forneça mais detalhes.*`,
      contentType: 'text',
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'medium',
    },
    activity: [
      { id: 'step-1', label: 'Consultando cliente no ERP', status: 'done',  timestamp: nowTime() },
      { id: 'step-2', label: 'Match parcial encontrado — aguardando confirmação', status: 'done', timestamp: nowTime() },
    ],
    lastAnswerUpdate: null,
  };
}

/**
 * Apresenta cliente confirmado com itens de orçamento preservados.
 * Usado após confirmar_cliente_pendente quando havia itens na mensagem original.
 */
export function presenterClienteConfirmadoComOrcamento(client: any, itens: Array<{ quantidade: number; termo: string }>): PresenterResult {
  const nome = client.clientName || client.clientFantasia || `Cliente ${client.clientInternalId}`;
  const listaItens = itens.map(i => `• ${i.quantidade}x ${i.termo}`).join('\n');
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     `Certo! Trabalhando com **${nome}**. Retomando a cotação com os itens informados:\n\n${listaItens}\n\nPreciso do endereço de entrega para calcular o frete. Qual endereço devo usar?`,
      contentType: 'text',
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [
      { id: 'step-1', label: 'Cliente confirmado', status: 'done', timestamp: nowTime() },
      { id: 'step-2', label: 'Itens do orçamento preservados', status: 'done', timestamp: nowTime() },
      { id: 'step-3', label: 'Aguardando endereço de entrega', status: 'pending', timestamp: nowTime() },
    ],
    lastAnswerUpdate: null,
  };
}

export function presenterClienteErroAuth(): PresenterResult {
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     'Não consegui acessar o cadastro de clientes no momento. Verifique se você está logado no ERP e tente novamente.',
      contentType: 'text',
      specialist:  'comercial',
      timestamp:   now(),
      status:      'error',
      confidence:  'low',
    },
    activity: [
      { id: 'step-err', label: 'Falha de acesso — sessão ausente ou expirada', status: 'error', timestamp: nowTime() },
    ],
  };
}

/**
 * Presenter exibido quando a busca retorna mais de 6 resultados.
 * O Maestro pede refinamento sem listar nem escolher automaticamente.
 */
export function presenterClienteBuscaAmpla(termo: string, itensPendentes?: any[] | null): PresenterResult {
  let content = `Encontrei muitos cadastros relacionados a **"${termo}"**. Para evitar selecionar o cliente errado, me informe um dado mais específico:\n\n• **Nome completo** ou razão social\n• **CPF** ou **CNPJ**\n• **Código** do cliente\n• **Cidade** ou UF`;

  if (itensPendentes && itensPendentes.length > 0) {
    const listaItens = itensPendentes.map(i => `• ${i.quantidade.toLocaleString('pt-BR')}x ${i.termo}`).join('\n');
    content = `⚠️ **Orçamento em espera:** Encontrei muitos cadastros relacionados a **"${termo}"**.\n\nPara prosseguir com a cotação dos seguintes itens:\n${listaItens}\n\nPor favor, me informe um dado de identificação do cliente:\n\n• **Código** do cliente ou **CNPJ/CPF**\n• **Nome completo** ou **Cidade/UF**`;
  }

  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content,
      contentType: 'text',
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'low',
    },
    activity: [
      { id: 'step-1', label: 'Consultando cliente no ERP', status: 'done', timestamp: nowTime() },
      { id: 'step-2', label: 'Muitos resultados — refinamento necessário', status: 'done', timestamp: nowTime() },
    ],
    lastAnswerUpdate: null,
  };
}

// ─── Presenter: Resumo Geral ─────────────────────────────────────────────

export function presenterClienteSummary(ctx: SimpleMaestroContext): PresenterResult {
  const c     = ctx.activeClient!;
  const nome  = c.clientName || `Cliente ${c.clientDisplayCode}`;
  const src   = getSource(c);
  const partes: string[] = [];

  partes.push(`**${nome}** — código **${c.clientDisplayCode}**, pelo cadastro completo:`);
  if (c.clientDocument)         partes.push(`• **CNPJ/CPF:** ${c.clientDocument}`);
  if (c.clientCityUf)           partes.push(`• **Cidade/UF:** ${c.clientCityUf}`);
  if (c.clientSeller)           partes.push(`• **Vendedor:** ${c.clientSeller}`);
  if (c.clientPhone)            partes.push(`• **Telefone:** ${c.clientPhone}`);
  
  if (c.clientEmail)            partes.push(`• **E-mail:** ${c.clientEmail}`);
  else                          partes.push(`• **E-mail:** não cadastrado`);
  
  if (typeof c.clientCreditLimit === 'number')
    partes.push(`• **Limite de crédito:** ${formatBRL(c.clientCreditLimit)}`);
  
  if (c.isBonus) {
    const perc = c.percentualBonus ? ` (${formatPercent(c.percentualBonus)})` : '';
    partes.push(`• **Bônus ativo:** Sim${perc}`);
  }

  if (c.clientDataFundacao) {
    partes.push(`• **Fundação da empresa:** ${formatDate(c.clientDataFundacao) || c.clientDataFundacao}`);
  }

  partes.push(`\n*Fonte: ${src.table} — pelo cadastro carregado.*`);

  const lastAnswer: LastAnswerRecord = {
    type:      'summary',
    value:     nome,
    label:     'Resumo do cliente',
    source:    c.source,
    confidence: 'high',
    reason:    `Apresentei um resumo com os campos do cadastro completo de ${nome} (${c.clientDisplayCode}).`,
    answeredAt: now(),
  };

  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     partes.join('\n'),
      contentType: 'text',
      sources:     [src],
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [
      { id: 'step-1', label: 'Resumo do cadastro gerado', status: 'done', timestamp: nowTime() },
    ],
    lastAnswerUpdate: lastAnswer,
  };
}

// ─── Presenter: Campo Específico ─────────────────────────────────────────

export function presenterCampoContextual(
  field: string | undefined,
  ctx: SimpleMaestroContext
): PresenterResult {
  const c   = ctx.activeClient!;
  const src = getSource(c);
  let content = '';
  let lastAnswer: LastAnswerRecord | null = null;
  const sources: MessageSource[] = [src];

  function buildField(
    dbField: string,
    label: string,
    value: string | undefined | null,
    resposta: string,
    confianca: 'high' | 'medium' | 'low' = 'high',
    customSource?: string
  ): void {
    content = resposta;
    lastAnswer = {
      type:      'field',
      field:     field ?? dbField,
      value:     value ?? 'não cadastrado',
      label,
      dbField,
      source:    customSource || c.source,
      confidence: confianca,
      reason:    `Respondi com base no campo \`${dbField}\` do cadastro de ${c.clientName} (${c.clientDisplayCode}) na tabela ${customSource || c.source}.`,
      answeredAt: now(),
    };
  }

  switch (field) {

    case 'telefone': {
      const tels = [];
      if (c.clientPhone) tels.push(c.clientPhone);
      if (c.clientWhatsapp2) tels.push(c.clientWhatsapp2);
      
      if (tels.length > 0) {
        buildField('telefone/whatsapp', 'Telefone/WhatsApp', tels.join(', '),
          `Os contatos telefônicos de **${c.clientName}** são: **${tels.join(' / ')}**.`);
      } else {
        buildField('whatsapp_1', 'Telefone/WhatsApp', undefined,
          `**${c.clientName}** não tem telefone cadastrado no ERP.`, 'medium');
      }
      break;
    }

    case 'cnpj':
      if (c.clientDocument) {
        buildField('documento', 'CNPJ/CPF', c.clientDocument,
          `O CNPJ/CPF de **${c.clientName}** é **${c.clientDocument}**.`);
      } else {
        buildField('documento', 'CNPJ/CPF', undefined,
          `**${c.clientName}** não tem CNPJ/CPF cadastrado no ERP.`, 'medium');
      }
      break;

    case 'email': {
      const emails = [];
      if (c.clientEmail) emails.push(`Principal: ${c.clientEmail}`);
      if (c.clientEmailContato) emails.push(`Contato: ${c.clientEmailContato}`);
      if (c.clientEmailFinanceiro) emails.push(`Financeiro: ${c.clientEmailFinanceiro}`);

      if (emails.length > 0) {
        buildField('email', 'E-mail', emails.join(' | '),
          `E-mails de **${c.clientName}** encontrados no cadastro:\n${emails.map(e => `• ${e}`).join('\n')}`);
      } else {
        buildField('email', 'E-mail', undefined,
          `**${c.clientName}** não tem e-mail cadastrado no ERP.`, 'medium');
      }
      break;
    }

    case 'cidade': {
      if (c.clientCityUf) {
        const div = getCidadesDivergentes(c);
        if (div.length > 0) {
          sources.push(getSource(c, 'enderecos'));
          buildField('cidade_uf', 'Cidade/UF', c.clientCityUf,
            `Pelo campo \`cidade_uf\` do cadastro, consta **${c.clientCityUf}**.\n\n⚠️ **Atenção:** Também encontrei endereços vinculados em outras cidades (${div.join(', ')}). Como há divergência, o ideal é conferir qual endereço deve ser considerado principal.`);
        } else {
          buildField('cidade_uf', 'Cidade/UF', c.clientCityUf,
            `**${c.clientName}** está localizado em **${c.clientCityUf}** — conforme o cadastro.`);
        }
      } else {
        buildField('cidade_uf', 'Cidade/UF', undefined,
          `A cidade de **${c.clientName}** não está registrada no cadastro principal.`, 'medium');
      }
      break;
    }

    case 'vendedor':
      if (c.clientSeller) {
        buildField('nome_vendedor', 'Vendedor', c.clientSeller,
          `O vendedor responsável por **${c.clientName}** é **${c.clientSeller}**.`);
      } else {
        buildField('nome_vendedor', 'Vendedor', undefined,
          `**${c.clientName}** não tem vendedor vinculado no cadastro.`, 'medium');
      }
      break;

    case 'credito': {
      const hasCredito = typeof c.clientCreditLimit === 'number' || typeof c.clientCredit === 'number';
      let text = `Situação de crédito de **${c.clientName}**:`;
      if (hasCredito) {
        text += `\n• **Limite:** ${formatBRL(c.clientCreditLimit)}\n• **Disponível:** ${formatBRL(c.clientCredit)}`;
      } else {
        text += `\nAs informações de limite não estão disponíveis.`;
      }
      
      buildField('limite_credito', 'Crédito', hasCredito ? 'Disponível' : 'ND', text);
      break;
    }

    case 'bonus': {
      let text = `Informações de Bônus de **${c.clientName}**:`;
      if (c.isBonus != null) {
        text += `\n• **Bônus Ativo:** ${c.isBonus ? 'Sim' : 'Não'}`;
        if (c.isBonus && c.percentualBonus) {
          text += `\n• **Percentual:** ${formatPercent(c.percentualBonus)}`;
        }
      } else {
        text += `\n_Não há dado preenchido sobre bônus neste cadastro._`;
      }
      buildField('is_bonus', 'Bônus', c.isBonus != null ? 'Disponível' : 'ND', text);
      break;
    }

    case 'nome':
      buildField('nome', 'Razão Social', c.clientName,
        `O cliente **${c.clientDisplayCode}** é **${c.clientName}**${c.clientDocument ? ` — CNPJ/CPF: ${c.clientDocument}` : ''}.`);
      break;

    case 'fundacao': {
      if (c.clientDataFundacao) {
        const dtFmt = formatDate(c.clientDataFundacao);
        buildField('data_fundacao', 'Data de Fundação', c.clientDataFundacao,
          `**${c.clientName}** foi fundada em **${dtFmt || c.clientDataFundacao}** — conforme consta no cadastro.`);
      } else {
        const fallback = c.clientDataCadastro ? `\nO que existe é a data de cadastro no ERP: **${formatDate(c.clientDataCadastro) || c.clientDataCadastro}**.` : '';
        buildField('data_fundacao', 'Data de Fundação', undefined,
          `Não encontrei a data de fundação no cadastro de **${c.clientName}**.${fallback}`, 'medium');
      }
      break;
    }

    case 'cadastro_data': {
      if (c.clientDataCadastro) {
        buildField('data_cadastro', 'Data de Cadastro', c.clientDataCadastro,
          `**${c.clientName}** foi cadastrado no ERP em **${formatDate(c.clientDataCadastro) || c.clientDataCadastro}**.`);
      } else {
        buildField('data_cadastro', 'Data de Cadastro', undefined,
          `Não consta a data de cadastro no ERP para **${c.clientName}**.`, 'low');
      }
      break;
    }

    case 'padrao_pagamento': {
      if (c.padraoPagamento) {
        buildField('padrao_pagamento', 'Padrão de Pagamento', c.padraoPagamento,
          `O padrão de pagamento cadastrado para esse cliente é **${c.padraoPagamento}**.`);
      } else {
        buildField('padrao_pagamento', 'Padrão de Pagamento', undefined,
          `Não encontrei padrão de pagamento cadastrado para este cliente.`, 'medium');
      }
      break;
    }

    case 'restricao': {
      if (c.restricao !== undefined) {
        const desc = c.restricao ? 'Sim' : 'Não';
        buildField('restricao', 'Restrição Cadastral', desc,
          `O cliente **${c.clientName}** ${c.restricao ? 'possui' : 'não possui'} restrições cadastrais.`);
      } else {
        buildField('restricao', 'Restrição Cadastral', undefined,
          `Não constam informações de restrições cadastrais para o cliente **${c.clientName}**.`, 'medium');
      }
      break;
    }

    case 'ativo': {
      if (c.ativo !== undefined) {
        const desc = c.ativo ? 'Ativo' : 'Inativo';
        buildField('ativo', 'Status do Cadastro', desc,
          `O status do cadastro de **${c.clientName}** é **${desc}**.`);
      } else {
        buildField('ativo', 'Status do Cadastro', undefined,
          `Não constam informações de status do cadastro para o cliente **${c.clientName}**.`, 'medium');
      }
      break;
    }

    case 'risco_credito': {
      if (c.riscoCredito) {
        buildField('risco_credito', 'Risco de Crédito', c.riscoCredito,
          `O risco de crédito cadastrado para **${c.clientName}** está classificado como **${c.riscoCredito}**.`);
      } else {
        buildField('risco_credito', 'Risco de Crédito', undefined,
          `Não encontrei risco de crédito cadastrado para este cliente.`, 'medium');
      }
      break;
    }

    case 'enderecos': {
      const hasErro = (c as any).erroCarregamentoRelacao;
      if (hasErro) {
        buildField('enderecos', 'Endereços', undefined,
          `Não consegui consultar os endereços agora.`, 'low', 'public.enderecos');
      } else if (c.enderecos && c.enderecos.length > 0) {
        sources.push(getSource(c, 'enderecos'));
        const lines = c.enderecos.map((e, index) => {
          const tipo = e.tipoEndereco ? `**${e.tipoEndereco}**` : `**Endereço ${index + 1}**`;
          const detalhes = [
            e.endereco,
            e.numero ? `Nº ${e.numero}` : '',
            e.complemento ? `(${e.complemento})` : '',
            e.bairro ? `Bairro ${e.bairro}` : '',
            e.cidade ? `${e.cidade} - ${e.uf || ''}` : '',
            e.cep ? `CEP: ${e.cep}` : ''
          ].filter(Boolean).join(', ');
          return `• ${tipo}: ${detalhes}`;
        });
        buildField('enderecos', 'Endereços', 'Listado',
          `Endereços cadastrados para **${c.clientName}**:\n${lines.join('\n')}`, 'high', 'public.enderecos');
      } else {
        buildField('enderecos', 'Endereços', undefined,
          `Não encontrei endereços cadastrados para esse cliente.`, 'medium', 'public.enderecos');
      }
      break;
    }

    case 'contatos': {
      const hasErro = (c as any).erroCarregamentoRelacao;
      if (hasErro) {
        buildField('contatos', 'Contatos', undefined,
          `Não consegui consultar os contatos agora.`, 'low', 'public.contatos');
      } else if (c.contatos && c.contatos.length > 0) {
        sources.push(getSource(c, 'contatos'));
        const lines = c.contatos.map(ct => {
          const cargoStr = ct.cargo ? ` (${ct.cargo})` : '';
          const whatsStr = ct.whats ? ` · WhatsApp: ${ct.whats}` : '';
          const emailStr = ct.email ? ` · E-mail: ${ct.email}` : '';
          return `• **${ct.nomeContato}**${cargoStr}${whatsStr}${emailStr}`;
        });
        buildField('contatos', 'Contatos', 'Listado',
          `Contatos cadastrados para **${c.clientName}**:\n${lines.join('\n')}`, 'high', 'public.contatos');
      } else {
        buildField('contatos', 'Contatos', undefined,
          `Não encontrei contatos cadastrados para esse cliente.`, 'medium', 'public.contatos');
      }
      break;
    }

    case 'socios':
    case 'vinculos': {
      const hasErro = (c as any).erroCarregamentoRelacao;
      if (hasErro) {
        buildField('socios', 'Sócios/Vínculos', undefined,
          `Não consegui consultar os vínculos cadastrais agora.`, 'low', 'public.clientes_socios');
      } else if (c.socios && c.socios.length > 0) {
        sources.push(getSource(c, 'clientes_socios'));
        const lines = c.socios.map(s => {
          const nome = s.nomeSocio || `Cliente ${s.idClienteSocio}`;
          return s.tipoRelacao ? `• **${nome}** — ${s.tipoRelacao}` : `• **${nome}**`;
        });
        buildField('socios', 'Sócios/Vínculos', 'Listado',
          `Sócios/vínculos cadastrados para **${c.clientName}**:\n${lines.join('\n')}`, 'high', 'public.clientes_socios');
      } else {
        buildField('socios', 'Sócios/Vínculos', undefined,
          `Não encontrei sócios ou vínculos cadastrados para esse cliente.`, 'medium', 'public.clientes_socios');
      }
      break;
    }

    default: {
      content = `Não encontrei a informação solicitada no cadastro completo de **${c.clientName}**. Posso responder sobre: telefone, CNPJ, e-mail, cidade, vendedor, crédito, padrão de pagamento, restrição, status do cadastro, risco de crédito, bônus, fundação, endereços, contatos ou vínculos.`;
      lastAnswer = null;
    }
  }

  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content,
      contentType: 'text',
      sources,
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  (lastAnswer as LastAnswerRecord | null)?.confidence ?? 'medium',
    },
    activity: [
      { id: 'step-1', label: 'Lendo dado do cadastro', status: 'done', timestamp: nowTime() },
    ],
    lastAnswerUpdate: lastAnswer,
  };
}

// ─── Presenter: Contatos ─────────────────────────────────────────────────

export function presenterClienteContacts(ctx: SimpleMaestroContext): PresenterResult {
  const c = ctx.activeClient!;
  const contatos = c.contatos || [];

  if (contatos.length === 0) {
    return {
      message: {
        id: genId(), role: 'maestro', contentType: 'text', specialist: 'comercial', status: 'completed', confidence: 'medium', timestamp: now(),
        content: `Não encontrei contatos secundários vinculados a **${c.clientName}** na tabela de contatos.`,
        sources: [getSource(c, 'contatos')]
      },
      activity: [{ id: 'step-1', label: 'Buscando contatos', status: 'done', timestamp: nowTime() }],
      lastAnswerUpdate: {
        type: 'field', field: 'contatos', value: '0 contatos', label: 'Lista de Contatos', dbField: 'contatos', source: c.fontesRelacoes.contatos, confidence: 'medium', reason: 'A tabela de contatos não retornou registros para este id_cliente.', answeredAt: now()
      }
    };
  }

  const linhas = contatos.map(ct => {
    let t = `• **${ct.nomeContato || 'Sem nome'}**`;
    if (ct.cargo) t += ` (${ct.cargo})`;
    const infos = [];
    if (ct.whats) infos.push(ct.whats);
    if (ct.email) infos.push(ct.email);
    if (infos.length > 0) t += ` — ${infos.join(' | ')}`;
    return t;
  });

  return {
    message: {
      id: genId(), role: 'maestro', contentType: 'text', specialist: 'comercial', status: 'completed', confidence: 'high', timestamp: now(),
      content: `Encontrei ${contatos.length} contato(s) vinculado(s) a **${c.clientName}**:\n\n${linhas.join('\n')}`,
      sources: [getSource(c, 'contatos')]
    },
    activity: [{ id: 'step-1', label: 'Contatos carregados', status: 'done', timestamp: nowTime() }],
    lastAnswerUpdate: {
      type: 'field', field: 'contatos', value: `${contatos.length} contatos`, label: 'Lista de Contatos', dbField: 'contatos', source: c.fontesRelacoes.contatos, confidence: 'high', reason: `Apresentei a lista de contatos retornados da tabela contatos.`, answeredAt: now()
    }
  };
}

// ─── Presenter: Sócios / Vínculos ────────────────────────────────────────

export function presenterClientePartners(ctx: SimpleMaestroContext): PresenterResult {
  const c = ctx.activeClient!;
  const socios = c.socios || [];

  if (socios.length === 0) {
    return {
      message: {
        id: genId(), role: 'maestro', contentType: 'text', specialist: 'comercial', status: 'completed', confidence: 'medium', timestamp: now(),
        content: `Não há empresas autorizadas ou vínculos comerciais registrados para **${c.clientName}** na tabela de sócios.`,
        sources: [getSource(c, 'clientes_socios')]
      },
      activity: [{ id: 'step-1', label: 'Buscando vínculos', status: 'done', timestamp: nowTime() }],
      lastAnswerUpdate: {
        type: 'field', field: 'socios', value: '0 vínculos', label: 'Empresas Autorizadas', dbField: 'clientes_socios', source: c.fontesRelacoes.socios, confidence: 'medium', reason: 'A tabela clientes_socios não retornou registros.', answeredAt: now()
      }
    };
  }

  const linhas = socios.map(s => {
    const nome = s.nomeSocio || `Código ${s.idClienteSocio}`;
    const rel = s.tipoRelacao ? `[${s.tipoRelacao}]` : '';
    return `• **${nome}** ${rel}`;
  });

  return {
    message: {
      id: genId(), role: 'maestro', contentType: 'text', specialist: 'comercial', status: 'completed', confidence: 'high', timestamp: now(),
      content: `Encontrei ${socios.length} vínculo(s) comercial/autorizada(s) para **${c.clientName}**:\n\n${linhas.join('\n')}`,
      sources: [getSource(c, 'clientes_socios')]
    },
    activity: [{ id: 'step-1', label: 'Vínculos carregados', status: 'done', timestamp: nowTime() }],
    lastAnswerUpdate: {
      type: 'field', field: 'socios', value: `${socios.length} vínculos`, label: 'Empresas Autorizadas', dbField: 'clientes_socios', source: c.fontesRelacoes.socios, confidence: 'high', reason: `Apresentei a lista de relacionamentos de clientes_socios enriquecidos.`, answeredAt: now()
    }
  };
}

// ─── Presenter: Campo Desconhecido ────────────────────────────────────────

export function presenterCampoDesconhecido(ctx: SimpleMaestroContext): PresenterResult {
  const c = ctx.activeClient!;
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     `Não encontrei essa informação no cadastro completo de **${c.clientName}**.\n\n_Dica: você pode perguntar sobre contatos, endereços, e-mails, bônus, fundação ou crédito._`,
      contentType: 'text',
      sources:     [getSource(c)],
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'medium',
    },
    activity: [{ id: 'step-1', label: 'Campo não disponível', status: 'done', timestamp: nowTime() }],
  };
}

// ─── Presenter: Confirmação / "tem certeza?" ──────────────────────────────

export function presenterClienteConfirmation(ctx: SimpleMaestroContext): PresenterResult {
  const lastAnswer = ctx.lastAnswer;

  if (!lastAnswer) {
    if (!ctx.activeClient) return presenterSemContexto();
    return {
      message: {
        id:          genId(),
        role:        'maestro',
        content:     `Ainda não respondi nenhuma informação específica sobre **${ctx.activeClient.clientName}** nesta conversa. Pode perguntar sobre contatos, e-mails, endereços ou bônus.`,
        contentType: 'text',
        specialist:  'comercial',
        timestamp:   now(),
        status:      'completed',
        confidence:  'medium',
      },
      activity: [],
    };
  }

  const content = [
    `Sim, tenho ${lastAnswer.confidence === 'high' ? 'boa confiança' : 'confiança média'} nessa informação.`,
    ``,
    `**Última resposta:** ${lastAnswer.label}`,
    `**Valor:** ${lastAnswer.value}`,
    lastAnswer.dbField ? `**Campo no banco:** \`${lastAnswer.dbField}\`` : '',
    `**Fonte:** \`${lastAnswer.source}\``,
    ``,
    `_${lastAnswer.reason}_`,
    ``,
    `Se esse dado estiver desatualizado, ele precisa ser corrigido no ERP.`,
  ].filter(Boolean).join('\n');

  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content,
      contentType: 'text',
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  lastAnswer.confidence,
    },
    activity: [
      { id: 'step-1', label: 'Verificando última resposta', status: 'done', timestamp: nowTime() },
    ],
  };
}

// ─── Presenter: Histórico Comercial → Fase 2 ─────────────────────────────

export function presenterClienteHistoryFase2(ctx: SimpleMaestroContext): PresenterResult {
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     `Pelo cadastro do cliente, posso detalhar pedidos aprovados (últimos pedidos), propostas pendentes do mês ou o maior pedido. Para outras consultas avançadas de orçamentos e histórico de compras por produto, essas opções serão adicionadas nas próximas fases de produtos.`,
      contentType: 'text',
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'medium',
    },
    activity: [
      { id: 'step-1', label: 'Histórico comercial verificado', status: 'done', timestamp: nowTime() },
    ],
  };
}

/**
 * Presenter: Último orçamento do cliente (aprovado ou pendente).
 */
export function presenterUltimoOrcamento(
  result: PropostasResult,
  cliente: SimpleClientContext,
): PresenterResult {
  const nome = cliente.clientFantasia || cliente.clientName;
  if (result.authError) return presenterErro('auth_error em orçamentos');

  if (!result.found || result.items.length === 0) {
    return {
      message: {
        id: genId(),
        role: 'maestro',
        content: `Não encontrei nenhum orçamento cadastrado para **${nome}**.\n\nFonte: ${result.source}`,
        contentType: 'text',
        specialist: 'comercial',
        timestamp: now(),
        status: 'completed',
        confidence: 'high',
      },
      activity: [{ id: genId('step'), label: 'Último orçamento consultado', detail: 'Nenhum encontrado', status: 'done', timestamp: nowTime() }],
    };
  }

  const p = result.items[0];
  const dataFmt = formatDate(p.created_at) || p.created_at;
  const statusStr = p.status_interno ? ` (${p.status_interno})` : '';
  const content =
    `O último orçamento cadastrado para **${nome}** é o de **Nº ${p.id_int}**, criado em **${dataFmt}**, no valor de **${p.valor !== null ? formatBRL(p.valor) : 'não informado'}**${statusStr}.\n\n` +
    `Fonte: ${result.source}`;

  return {
    message: {
      id: genId(),
      role: 'maestro',
      content,
      contentType: 'text',
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [{ id: genId('step'), label: 'Último orçamento localizado', detail: `Nº ${p.id_int} · ${p.valor !== null ? formatBRL(p.valor) : ''}`, status: 'done', timestamp: nowTime() }],
  };
}

/**
 * Presenter: Último pedido real do cliente.
 */
export function presenterUltimoPedido(
  result: PropostasResult,
  cliente: SimpleClientContext,
): PresenterResult {
  const nome = cliente.clientFantasia || cliente.clientName;
  if (result.authError) return presenterErro('auth_error em pedidos');

  if (!result.found || result.items.length === 0) {
    return {
      message: {
        id: genId(),
        role: 'maestro',
        content: `Não encontrei nenhum pedido aprovado cadastrado para **${nome}**.\n\nFonte: ${result.source}`,
        contentType: 'text',
        specialist: 'comercial',
        timestamp: now(),
        status: 'completed',
        confidence: 'high',
      },
      activity: [{ id: genId('step'), label: 'Último pedido consultado', detail: 'Nenhum encontrado', status: 'done', timestamp: nowTime() }],
    };
  }

  const p = result.items[0];
  const dataFmt = formatDate(p.created_at) || p.created_at;
  const content =
    `O último pedido aprovado de **${nome}** é o de **Nº ${p.id_int}**, criado em **${dataFmt}**, no valor de **${p.valor !== null ? formatBRL(p.valor) : 'não informado'}**.\n\n` +
    `Fonte: ${result.source}`;

  return {
    message: {
      id: genId(),
      role: 'maestro',
      content,
      contentType: 'text',
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [{ id: genId('step'), label: 'Último pedido localizado', detail: `Nº ${p.id_int} · ${p.valor !== null ? formatBRL(p.valor) : ''}`, status: 'done', timestamp: nowTime() }],
  };
}

// ─── Presenter: Trocar Cliente ────────────────────────────────────────────

export function presenterClienteSwitch(): PresenterResult {
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     'Para trocar de cliente, me informe o código, CNPJ ou nome do novo cliente. Exemplo: `cliente 1234` ou `cli Empresa X`.',
      contentType: 'text',
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [{ id: 'step-1', label: 'Aguardando novo cliente', status: 'done', timestamp: nowTime() }],
    lastAnswerUpdate: null,
  };
}

export function presenterSemContexto(): PresenterResult {
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     'Não tenho cliente ativo nesta conversa. Me informe o código, CNPJ ou nome para começar.',
      contentType: 'text',
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [],
  };
}

/** Saudação adequada ao horário de Brasília (nunca "Bom dia" fixo). */
function saudacaoPorHorario(): string {
  let hora: number;
  try {
    hora = Number(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }));
  } catch {
    hora = new Date().getHours();
  }
  if (hora >= 5 && hora < 12) return 'Bom dia';
  if (hora >= 12 && hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function presenterAjuda(ctx?: SimpleMaestroContext): PresenterResult {
  const saudacao = saudacaoPorHorario();
  const nomeCliente = ctx?.activeClient?.clientName;
  const content = nomeCliente
    ? `${saudacao}! Seguimos com **${nomeCliente}** ativo. Me diga o que você precisa — cadastro, pedidos, boletos ou uma nova cotação.`
    : `${saudacao}! Me diga o cliente, pedido ou assunto que você quer consultar — ou já mande a cotação direto (ex.: "3450 triband para o cliente 8469").`;
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content,
      contentType: 'text',
      specialist:  'geral',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [],
  };
}

export function presenterClosure(ctx?: SimpleMaestroContext): PresenterResult {
  const nomeCliente = ctx?.activeClient?.clientName;
  const content = nomeCliente
    ? `De nada! **${nomeCliente}** continua ativo — quando precisar, é só continuar daqui.`
    : 'De nada! Quando precisar, é só chamar.';
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content,
      contentType: 'text',
      specialist:  'geral',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [],
  };
}

export function presenterWaitUser(): PresenterResult {
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     'Claro! Fico aguardando.',
      contentType: 'text',
      specialist:  'geral',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [],
  };
}

export function presenterFallback(ctx: SimpleMaestroContext): PresenterResult {
  if (ctx.activeClient) {
    const nome = ctx.activeClient.clientName || `Cliente ${ctx.activeClient.clientDisplayCode}`;
    return {
      message: {
        id:          genId(),
        role:        'maestro',
        content:     `Tenho **${nome}** ativo. Você pode perguntar sobre e-mails, bônus, contatos, localização, ou pedir um resumo geral.`,
        contentType: 'text',
        specialist:  'comercial',
        timestamp:   now(),
        status:      'completed',
        confidence:  'medium',
      },
      activity: [],
    };
  }
  return presenterSemContexto();
}

export function presenterErro(detalhe?: string): PresenterResult {
  if (detalhe) console.error('[Maestro Simple] Erro:', detalhe);
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     'Houve um problema ao consultar o banco de dados. Por favor, tente novamente.',
      contentType: 'text',
      specialist:  'geral',
      timestamp:   now(),
      status:      'error',
      confidence:  'low',
    },
    activity: [{ id: 'step-err', label: 'Erro interno', status: 'error', timestamp: nowTime() }],
  };
}

// ─── Fase 2: Pedidos e Financeiro ─────────────────────────────────────────────

// Tipos espelhados dos adapters server-side (evita import cross-file em TS strict)
export interface PedidoSimples {
  id_int: number;
  status_interno: string | null;
  valor: number | null;
  created_at: string;
  vendedor: string | null;
}
export interface PropostasResult {
  found: boolean;
  items: PedidoSimples[];
  count: number;
  totalValor?: number;
  periodo?: string;
  source: string;
  authError?: boolean;
  error?: string;
}
export interface BoletoSimples {
  id_int: number;
  vencimento: string | null;
  valor: number | null;
  valor_atualizado: number | null;
  status: string | null;
  dias_atraso: number;
  n_nf: string | null;
  paid_at: string | null;
}
export interface BoletosResult {
  found: boolean;
  items: BoletoSimples[];
  count: number;
  filtro: string;
  source: string;
  authError?: boolean;
  error?: string;
}


/**
 * Resposta para perguntas sem cliente ativo com contexto comercial.
 * Frase específica que orienta o usuário a informar o cliente primeiro.
 */
export function presenterSemClienteComercial(): PresenterResult {
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     'Me informe primeiro o cliente — pelo código, CNPJ ou nome — para eu consultar isso com segurança.',
      contentType: 'text',
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [{ id: genId('step'), label: 'Sem cliente ativo', status: 'done', timestamp: nowTime() }],
  };
}

/** Formata data de ISO para dd/mm/aaaa */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'data não disponível';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Formata valor em BRL ou retorna mensagem padronizada */
function fmtBRL(v: number | null | undefined): string {
  if (v == null) return 'valor não disponível';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Presenter: Últimos pedidos reais do cliente (is_prd_aprovado=true).
 */
export function presenterUltimosPedidos(
  result: PropostasResult,
  cliente: SimpleClientContext,
): PresenterResult {
  const nome = cliente.clientFantasia || cliente.clientName;

  if (result.authError) {
    return presenterErro('auth_error em propostas');
  }

  if (!result.found || result.items.length === 0) {
    const content = `Não encontrei pedidos confirmados para **${nome}** na base de dados.\n` +
      `ℹ️ Fonte: ${result.source} · Filtro: is_prd_aprovado=true`;
    return {
      message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'comercial', timestamp: now(), status: 'completed', confidence: 'high' },
      activity: [{ id: genId('step'), label: 'Pedidos consultados', detail: 'Nenhum pedido real encontrado', status: 'done', timestamp: nowTime() }],
      lastAnswerUpdate: { type: 'other', value: '0', label: 'Últimos pedidos', source: result.source, confidence: 'high', reason: 'Nenhum pedido real encontrado', answeredAt: now() },
    };
  }

  const linhas = result.items.map(p =>
    `• #${p.id_int} — ${fmtBRL(p.valor)} — ${fmtDate(p.created_at)} — ${p.status_interno ?? 'status não informado'}`,
  );

  const content =
    `Encontrei ${result.items.length} pedido${result.items.length > 1 ? 's' : ''} confirmado${result.items.length > 1 ? 's' : ''} para **${nome}**:\n` +
    linhas.join('\n') + '\n' +
    `\nℹ️ Fonte: ${result.source} · Filtro: is_prd_aprovado=true, is_reproved=false`;

  return {
    message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'comercial', timestamp: now(), status: 'completed', confidence: 'high' },
    activity: [{ id: genId('step'), label: 'Pedidos consultados', detail: `${result.count} pedido(s)`, status: 'done', timestamp: nowTime() }],
    lastAnswerUpdate: { type: 'other', value: String(result.count), label: 'Últimos pedidos', source: result.source, confidence: 'high', reason: 'Consulta de pedidos reais', answeredAt: now() },
  };
}

/**
 * Presenter: Faturamento por período.
 */
export function presenterFaturamentoPeriodo(
  result: PropostasResult,
  cliente: SimpleClientContext,
  periodo: MaestroPeriodo,
): PresenterResult {
  const nome       = cliente.clientFantasia || cliente.clientName;
  const periodoLabel = result.periodo ?? periodo.label;

  if (result.authError) return presenterErro('auth_error em faturamento');

  if (!result.found || result.items.length === 0) {
    const content =
      `Não encontrei pedidos confirmados para **${nome}** ${periodoLabel}.\n\n` +
      `ℹ️ Fonte: ${result.source} · Filtro: is_prd_aprovado=true`;
    return {
      message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'comercial', timestamp: now(), status: 'completed', confidence: 'high' },
      activity: [{ id: genId('step'), label: 'Faturamento consultado', detail: 'Sem pedidos no período', status: 'done', timestamp: nowTime() }],
      lastAnswerUpdate: { type: 'other', value: '0', label: `Faturamento ${periodoLabel}`, source: result.source, confidence: 'high', reason: 'Sem pedidos no período', answeredAt: now() },
    };
  }

  const total  = result.totalValor ?? result.items.reduce((a, p) => a + (p.valor ?? 0), 0);
  
  const linhas = result.items.slice(0, 5).map(p =>
    `- Pedido #${p.id_int} — ${fmtDate(p.created_at)} — status ${p.status_interno ?? 'não informado'}.`
  );

  const content =
    `Em ${periodoLabel.toLowerCase()}, **${nome}** teve **${result.count}** pedido${result.count > 1 ? 's' : ''} confirmado${result.count > 1 ? 's' : ''}, totalizando **${fmtBRL(total)}**.\n\n` +
    linhas.join('\n') + '\n\n' +
    `Fonte: ${result.source}`;

  return {
    message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'comercial', timestamp: now(), status: 'completed', confidence: 'high' },
    activity: [{ id: genId('step'), label: 'Faturamento calculado', detail: `${result.count} pedidos · ${fmtBRL(total)}`, status: 'done', timestamp: nowTime() }],
    lastAnswerUpdate: { type: 'other', value: fmtBRL(total), label: `Faturamento Comercial ${periodoLabel}`, source: result.source, confidence: 'high', reason: 'Soma de pedidos reais', answeredAt: now() },
  };
}

/**
 * Presenter: Recebimento Financeiro Real por período (pagamentos_v2).
 */
export function presenterRecebimentoPeriodo(
  result: RecebimentosResult,
  cliente: SimpleClientContext,
  periodo: MaestroPeriodo,
): PresenterResult {
  const nome       = cliente.clientFantasia || cliente.clientName;
  const periodoLabel = result.periodo ?? periodo.label;

  if (result.authError) return presenterErro('auth_error em faturamento');

  if (!result.found || result.items.length === 0) {
    const content =
      `Não encontrei recebimentos financeiros confirmados para **${nome}** ${periodoLabel}.\n\n` +
      `ℹ️ Fonte: ${result.source} · Filtro: confirmado=true AND status='PAID' AND paid_at!=null`;
    return {
      message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'comercial', timestamp: now(), status: 'completed', confidence: 'high' },
      activity: [{ id: genId('step'), label: 'Recebimentos consultados', detail: 'Sem recebimentos no período', status: 'done', timestamp: nowTime() }],
      lastAnswerUpdate: { type: 'other', value: '0', label: `Recebimento ${periodoLabel}`, source: result.source, confidence: 'high', reason: 'Sem recebimentos no período', answeredAt: now() },
    };
  }

  const total  = result.totalValor ?? result.items.reduce((a, p) => a + (p.valor ?? 0), 0);
  
  const content =
    `Em ${periodoLabel.toLowerCase()}, **${nome}** teve **${result.count}** pagamento${result.count > 1 ? 's' : ''} recebido${result.count > 1 ? 's' : ''}, totalizando **${fmtBRL(total)}**.\n\n` +
    `Fonte: ${result.source}`;

  return {
    message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'comercial', timestamp: now(), status: 'completed', confidence: 'high' },
    activity: [{ id: genId('step'), label: 'Faturamento financeiro calculado', detail: `${result.count} recebimentos · ${fmtBRL(total)}`, status: 'done', timestamp: nowTime() }],
    lastAnswerUpdate: { type: 'other', value: fmtBRL(total), label: `Faturamento Financeiro ${periodoLabel}`, source: result.source, confidence: 'high', reason: 'Soma de pagamentos_v2', answeredAt: now() },
  };
}

/**
 * Presenter: Maior pedido do cliente.
 */
export function presenterMaiorPedido(
  result: PropostasResult,
  cliente: SimpleClientContext,
): PresenterResult {
  const nome = cliente.clientFantasia || cliente.clientName;

  if (result.authError) return presenterErro('auth_error em maior pedido');

  if (!result.found || result.items.length === 0) {
    const content = `Não encontrei pedidos confirmados para **${nome}** na base.\nℹ️ Fonte: ${result.source}`;
    return {
      message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'comercial', timestamp: now(), status: 'completed', confidence: 'high' },
      activity: [{ id: genId('step'), label: 'Maior pedido consultado', detail: 'Nenhum encontrado', status: 'done', timestamp: nowTime() }],
      lastAnswerUpdate: { type: 'other', value: 'não encontrado', label: 'Maior pedido', source: result.source, confidence: 'high', reason: 'Sem pedidos reais', answeredAt: now() },
    };
  }

  const p       = result.items[0];
  const content =
    `O maior pedido confirmado de **${nome}** foi o **#${p.id_int}**, ` +
    `no valor de **${fmtBRL(p.valor)}**, criado em **${fmtDate(p.created_at)}**` +
    (p.status_interno ? ` — status: ${p.status_interno}` : '') + '.\n' +
    `ℹ️ Fonte: ${result.source} · Filtro: is_prd_aprovado=true, is_reproved=false`;

  return {
    message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'comercial', timestamp: now(), status: 'completed', confidence: 'high' },
    activity: [{ id: genId('step'), label: 'Maior pedido localizado', detail: `#${p.id_int} · ${fmtBRL(p.valor)}`, status: 'done', timestamp: nowTime() }],
    lastAnswerUpdate: { type: 'other', value: fmtBRL(p.valor), label: 'Maior pedido', source: result.source, confidence: 'high', reason: 'Pedido de maior valor', answeredAt: now() },
  };
}

/**
 * Presenter: Propostas não aprovadas para produção no mês.
 */
export function presenterPropostasAbertas(
  result: PropostasResult,
  cliente: SimpleClientContext,
): PresenterResult {
  const nome = cliente.clientFantasia || cliente.clientName;

  if (result.authError) return presenterErro('auth_error em propostas abertas');

  if (!result.found || result.items.length === 0) {
    const content =
      `Não encontrei propostas pendentes de aprovação para **${nome}** neste mês.\n` +
      `ℹ️ Fonte: ${result.source} · Filtro: is_prd_aprovado=false, is_reproved=false`;
    return {
      message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'comercial', timestamp: now(), status: 'completed', confidence: 'high' },
      activity: [{ id: genId('step'), label: 'Propostas abertas consultadas', detail: 'Nenhuma pendente', status: 'done', timestamp: nowTime() }],
      lastAnswerUpdate: { type: 'other', value: '0', label: 'Propostas abertas', source: result.source, confidence: 'high', reason: 'Sem propostas pendentes no mês', answeredAt: now() },
    };
  }

  const linhas = result.items.map(p =>
    `• #${p.id_int} — ${fmtBRL(p.valor)} — ${p.status_interno ?? 'status não informado'} — ${fmtDate(p.created_at)}`,
  );

  const content =
    `Encontrei **${result.count}** proposta${result.count > 1 ? 's' : ''} ainda não liberada${result.count > 1 ? 's' : ''} para produção neste mês — **${nome}**:\n` +
    linhas.join('\n') + '\n' +
    `\nℹ️ Fonte: ${result.source} · Filtro: is_prd_aprovado=false, is_reproved=false`;

  return {
    message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'comercial', timestamp: now(), status: 'completed', confidence: 'high' },
    activity: [{ id: genId('step'), label: 'Propostas abertas consultadas', detail: `${result.count} pendente(s)`, status: 'done', timestamp: nowTime() }],
    lastAnswerUpdate: { type: 'other', value: String(result.count), label: 'Propostas abertas', source: result.source, confidence: 'high', reason: 'Propostas sem is_prd_aprovado', answeredAt: now() },
  };
}

/**
 * Presenter: Boletos do cliente (em aberto / atraso / não liquidados).
 */
export function presenterBoletos(
  result: BoletosResult,
  cliente: SimpleClientContext,
): PresenterResult {
  const nome = cliente.clientFantasia || cliente.clientName;

  if (result.authError) return presenterErro('auth_error em boletos');

  if (!result.found || result.items.length === 0) {
    const content =
      `Não encontrei boletos ${result.filtro} para **${nome}**.\n` +
      `ℹ️ Fonte: ${result.source} · Liquidação via paid_at`;
    return {
      message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'financeiro', timestamp: now(), status: 'completed', confidence: 'high' },
      activity: [{ id: genId('step'), label: 'Boletos consultados', detail: `Nenhum ${result.filtro}`, status: 'done', timestamp: nowTime() }],
      lastAnswerUpdate: { type: 'other', value: '0', label: `Boletos ${result.filtro}`, source: result.source, confidence: 'high', reason: 'Nenhum boleto encontrado', answeredAt: now() },
    };
  }

  const linhas = result.items.map(b => {
    const atraso = b.dias_atraso > 0 ? ` — ${b.dias_atraso} dia${b.dias_atraso > 1 ? 's' : ''} em atraso` : '';
    const nf     = b.n_nf ? ` — NF ${b.n_nf}` : '';
    return `• #${b.id_int} — venc. ${fmtDate(b.vencimento)} — ${fmtBRL(b.valor_atualizado ?? b.valor)} — ${b.status ?? '?'}${atraso}${nf}`;
  });

  const content =
    `Encontrei **${result.count}** boleto${result.count > 1 ? 's' : ''} ${result.filtro} para **${nome}**:\n` +
    linhas.join('\n') + '\n' +
    `\nℹ️ Fonte: ${result.source} · Liquidação via paid_at · Sem linha digitável`;

  return {
    message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'financeiro', timestamp: now(), status: 'completed', confidence: 'high' },
    activity: [{ id: genId('step'), label: 'Boletos consultados', detail: `${result.count} boleto(s) ${result.filtro}`, status: 'done', timestamp: nowTime() }],
    lastAnswerUpdate: { type: 'other', value: String(result.count), label: `Boletos ${result.filtro}`, source: result.source, confidence: 'high', reason: 'Consulta de boletos por paid_at', answeredAt: now() },
  };
}

/**
 * Presenter: Comparação de recebimentos mensais (pagamentos_v2).
 */
export function presenterComparacaoRecebimentos(
  result: ComparacaoRecebimentosResult,
  cliente: SimpleClientContext,
): PresenterResult {
  const nome = cliente.clientFantasia || cliente.clientName;
  if (result.error) return presenterErro(`Erro na comparação: ${result.error}`);

  const content = `Aqui está a comparação de recebimentos financeiros para **${nome}**. Fonte: ${result.source}`;

  const lastAnswer: LastAnswerRecord = {
    type: 'comparison',
    value: `Comparação de ${result.items.length} meses`,
    label: 'Comparação de recebimentos',
    source: result.source,
    confidence: 'high',
    reason: 'Comparação estruturada de recebimentos mensais',
    answeredAt: now(),
    data: result.items,
  };

  return {
    message: {
      id: genId(),
      role: 'maestro',
      content,
      contentType: 'text',
      specialist: 'financeiro',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
      components: [
        {
          type: 'table',
          data: {
            headers: ['Mês', 'Pagamentos recebidos', 'Total recebido'],
            rows: result.items.map(item => [
              item.label,
              String(item.count),
              fmtBRL(item.totalValor)
            ])
          }
        }
      ]
    },
    activity: [{ id: genId('step'), label: 'Comparação calculada', detail: `${result.items.length} meses`, status: 'done', timestamp: nowTime() }],
    lastAnswerUpdate: lastAnswer,
  };
}

/**
 * Presenter: Revalida uma consulta financeira re-executando a chamada ao DB.
 */
export function presenterRevalidacaoFinanceira(
  result: ComparacaoRecebimentosResult,
  cliente: SimpleClientContext,
): PresenterResult {
  const base = presenterComparacaoRecebimentos(result, cliente);
  base.message.content = `Acabei de reexecutar a consulta no banco (public.pagamentos_v2) para confirmar.\n\n${base.message.content}`;
  base.activity.unshift({ id: genId('step'), label: 'Consulta financeira revalidada', detail: 'Banco consultado novamente', status: 'done', timestamp: nowTime() });
  return base;
}

/**
 * Presenter: Explica a origem da última resposta salva no contexto (fallback de confirmação).
 */
export function presenterRevalidacaoGenerica(ctx: SimpleMaestroContext): PresenterResult {
  if (!ctx.lastAnswer) return presenterSemContexto();
  
  const content = `Conferi a última consulta salva nesta conversa. Ela veio da fonte **${ctx.lastAnswer.source}** e retornou o seguinte: **${ctx.lastAnswer.value}** (${ctx.lastAnswer.label}).\n\nSe precisar que eu execute uma nova pesquisa específica, é só avisar!`;

  return {
    message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'geral', timestamp: now(), status: 'completed', confidence: 'high' },
    activity: [{ id: genId('step'), label: 'Revalidação genérica', detail: 'Contexto estruturado lido', status: 'done', timestamp: nowTime() }],
  };
}

/**
 * Presenter: Realiza análises matemáticas determinísticas da comparação anterior (follow-up).
 */
export function presenterAnaliseComparacao(
  analise: 'tabela' | 'melhor_mes' | 'variacao',
  comparisonData: ComparacaoItem[],
  cliente: SimpleClientContext,
  mesA?: string,
  mesB?: string,
): PresenterResult {
  const nome = cliente.clientFantasia || cliente.clientName;

  if (comparisonData.length === 0) {
    const content = 'Não tenho uma comparação anterior para analisar. Me diga quais meses deseja comparar.';
    return {
      message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'financeiro', timestamp: now(), status: 'completed', confidence: 'high' },
      activity: [],
    };
  }

  if (analise === 'tabela') {
    const content = `Aqui estão os dados da comparação anterior para **${nome}** em formato de tabela:`;

    return {
      message: {
        id: genId(),
        role: 'maestro',
        content,
        contentType: 'text',
        specialist: 'financeiro',
        timestamp: now(),
        status: 'completed',
        confidence: 'high',
        components: [
          {
            type: 'table',
            data: {
              headers: ['Mês', 'Pagamentos recebidos', 'Total recebido'],
              rows: comparisonData.map(item => [
                item.label,
                String(item.count),
                fmtBRL(item.totalValor)
              ])
            }
          }
        ]
      },
      activity: [{ id: genId('step'), label: 'Tabela gerada', detail: `${comparisonData.length} meses`, status: 'done', timestamp: nowTime() }],
    };
  }

  if (analise === 'melhor_mes') {
    let melhor = comparisonData[0];
    for (const item of comparisonData) {
      if (item.totalValor > melhor.totalValor) {
        melhor = item;
      }
    }

    const content =
      `O melhor mês foi **${melhor.label}**, com **${melhor.count}** pagamentos recebidos e um total de **${fmtBRL(melhor.totalValor)}**.\n\n` +
      `Fonte: public.pagamentos_v2`;

    return {
      message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'financeiro', timestamp: now(), status: 'completed', confidence: 'high' },
      activity: [{ id: genId('step'), label: 'Análise concluída', detail: `Melhor mês: ${melhor.label}`, status: 'done', timestamp: nowTime() }],
    };
  }

  if (analise === 'variacao') {
    if (!mesA || !mesB) {
      const content = 'Por favor, me informe quais meses deseja comparar para calcular a variação.';
      return {
        message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'financeiro', timestamp: now(), status: 'completed', confidence: 'high' },
        activity: [],
      };
    }

    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const a = comparisonData.find(x => norm(x.label).includes(norm(mesA)));
    const b = comparisonData.find(x => norm(x.label).includes(norm(mesB)));

    if (!a || !b) {
      const content = `Não consegui localizar ambos os meses ("${mesA}" e/ou "${mesB}") na comparação anterior para calcular a variação.`;
      return {
        message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'financeiro', timestamp: now(), status: 'completed', confidence: 'high' },
        activity: [],
      };
    }

    const dif = b.totalValor - a.totalValor;
    const pct = a.totalValor > 0 ? (dif / a.totalValor) * 100 : 0;
    
    let content = '';
    if (dif < 0) {
      content = `De **${a.label}** para **${b.label}**, houve uma queda de **${fmtBRL(Math.abs(dif))}** (**${Math.abs(pct).toFixed(2)}%**).\n\n` +
        `• ${a.label}: ${fmtBRL(a.totalValor)} (${a.count} pagamentos)\n` +
        `• ${b.label}: ${fmtBRL(b.totalValor)} (${b.count} pagamentos)\n\n` +
        `Fonte: public.pagamentos_v2`;
    } else {
      content = `De **${a.label}** para **${b.label}**, houve um crescimento de **${fmtBRL(dif)}** (**${pct.toFixed(2)}%**).\n\n` +
        `• ${a.label}: ${fmtBRL(a.totalValor)} (${a.count} pagamentos)\n` +
        `• ${b.label}: ${fmtBRL(b.totalValor)} (${b.count} pagamentos)\n\n` +
        `Fonte: public.pagamentos_v2`;
    }

    return {
      message: { id: genId(), role: 'maestro', content, contentType: 'text', specialist: 'financeiro', timestamp: now(), status: 'completed', confidence: 'high' },
      activity: [{ id: genId('step'), label: 'Variação calculada', detail: `${a.label} vs ${b.label}`, status: 'done', timestamp: nowTime() }],
    };
  }

  return presenterErro('Operação de análise não suportada.');
}

function getShortProductName(descricao: string, termoSolicitado: string): string {
  const lowerDesc = descricao.toLowerCase();
  const lowerTerm = termoSolicitado.toLowerCase();

  // Mapeamentos específicos comuns:
  if (lowerDesc.includes('pulseira') && lowerTerm.includes('triband')) {
    return 'Triband';
  }
  if (lowerDesc.includes('mobi') || lowerTerm.includes('mobi')) {
    return 'Ingresso MOBI';
  }
  if (lowerDesc.includes('up box') || lowerTerm.includes('up')) {
    return 'Ingresso UP BOX';
  }
  if (lowerDesc.includes('cordao') || lowerTerm.includes('jacare')) {
    return 'Cordão Jacaré';
  }

  // Fallback: Cortar por delimitadores
  const separators = [
    ' - ',
    ' : ',
    ':',
    ' formato ',
    ' tamanho ',
    ' de lacre ',
    ' com ',
    ' para ',
    ' de alta ',
    ' ideal para '
  ];
  
  let short = descricao;
  for (const sep of separators) {
    const parts = short.split(sep);
    if (parts[0].trim().length > 3) {
      short = parts[0];
    }
  }

  short = short.trim();
  short = short.charAt(0).toUpperCase() + short.slice(1);
  return short;
}

// ─── Orçamento Avulso (Simulação) ─────────────────────────────────────────────

export function presenterOrcamentoAvulso(result: OrcamentoAvulsoResult): PresenterResult {
  const { itens, totalGeral } = result;

  let contentText = 'Olá, 😀\n\nSegue orçamento para os itens solicitados.\n\nProdutos Orçados:\n\n';
  let allSuccess = true;

  itens.forEach(item => {
    if (item.status === 'nao_encontrado') {
      contentText += `❌ **${item.quantidade}x ${item.termo}**: Não encontrei nenhum produto com esse nome no cadastro.\n`;
      allSuccess = false;
    } else if (item.status === 'ambiguo') {
      contentText += `⚠️ **${item.quantidade}x ${item.termo}**: Encontrei ${item.produtosEncontrados.length} opções para esse termo. Qual delas você quer usar?\n`;
      item.produtosEncontrados.slice(0, 5).forEach(p => {
        contentText += `   - ${p.descricao} (ID: ${p.id_produto})\n`;
      });
      allSuccess = false;
    } else if (item.status === 'inativo') {
      const p = item.produtosEncontrados[0];
      contentText += `🚫 **${item.quantidade}x ${item.termo}**: O produto **${p.descricao}** encontra-se inativo no momento. Não é possível incluí-lo.\n`;
      allSuccess = false;
    } else if (item.status === 'preco_incompleto') {
      const p = item.produtosEncontrados[0];
      contentText += `⚠️ **${item.quantidade}x ${item.termo}**: O produto **${p.descricao}** está sem preço base no cadastro.\n`;
      allSuccess = false;
    } else if (item.status === 'sucesso') {
      const p = item.produtosEncontrados[0];
      const sub = item.subtotalCalculado;
      const formattedQtd = new Intl.NumberFormat('pt-BR').format(item.quantidade);
      const shortName = getShortProductName(p.descricao, item.termo);
      contentText += `✅ ${formattedQtd} ${shortName}: ${fmtBRL(sub)}\n`;
    }
  });

  if (allSuccess && totalGeral !== null) {
    contentText += `\nFrete: a combinar\n\nO valor total do pedido ficou em ${fmtBRL(totalGeral)}\n\nSe estiver tudo certo, me confirma por aqui que já dou andamento ao processo!\n`;
  } else {
    contentText += `\n*Como houve itens não encontrados, inativos ou com dúvidas, o total geral não foi calculado.*\n`;
  }

  return {
    message: {
      id: genId(),
      role: 'maestro',
      content: contentText,
      contentType: 'text',
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [
      { id: genId('step'), label: 'Simulação de orçamento avulso', detail: `Itens: ${itens.length}`, status: 'done', timestamp: nowTime() }
    ]
  };
}

/**
 * Formata resposta de orçamento avulso usando o novo OrcamentoService.
 * Prefere nomeComercial do catálogo oficial quando o ID foi resolvido por ele.
 * Nunca exibe descrições longas do banco.
 */
export function presenterOrcamentoAvulsoService(result: OrcamentoServiceResult, cliente?: SimpleClientContext, budgetAddressFull?: string, fretes?: PropostaFrete[], hasMissingWeight?: boolean): PresenterResult {
  const { resolucao, totalGeral, errors, temPendencia, nextState } = result;

  let allSuccess = !temPendencia && errors.length === 0;
  let contentText = '';

  if (temPendencia && nextState.pendingOptions && nextState.pendingOptions.length > 0) {
    const termo = nextState.pendingTerm || 'produto';
    contentText = `Encontrei ${nextState.pendingOptions.length} opções para "${termo}". Qual deles você quer usar?\n\n`;
    
    // Display up to 5 options with their IDs to differentiate identical names
    const displayOptions = nextState.pendingOptions.slice(0, 5);
    displayOptions.forEach(opt => {
      contentText += `${opt.index}. ${opt.name} (Cód: ${opt.id})\n`;
    });
    
    if (nextState.pendingOptions.length > 5) {
      const remaining = nextState.pendingOptions.length - 5;
      contentText += `\n*E mais ${remaining} opções semelhantes. Refine a busca ou escolha uma das acima.*\n`;
    }
    
    contentText += `\nPode responder com o número ou com o nome.`;
    
    return {
      message: {
        id: genId(),
        role: 'maestro',
        content: contentText,
        contentType: 'text',
        specialist: 'comercial',
        timestamp: now(),
        status: 'completed',
        confidence: 'high',
      },
      activity: [
        { id: genId('step'), label: 'Resolvendo ambiguidade', detail: `Opções: ${nextState.pendingOptions.length}`, status: 'done', timestamp: nowTime() }
      ]
    };
  }

  if (cliente?.clientName) {
    contentText = `📄 Orçamento para **${cliente.clientName}**\n\n`;
  } else {
    contentText = '📄 Orçamento conforme solicitação\n\n';
  }

  let hasErrorsOrInactives = false;

  resolucao.forEach(item => {
    if (item.status === 'nao_encontrado') {
      contentText += `❌ **${item.quantidade}x ${item.termo}**: Não encontrei nenhum produto com esse nome no cadastro.\n\n`;
      hasErrorsOrInactives = true;
    } else if (item.status === 'inativo') {
      const descricao = item.produto?.descricao ?? item.termo;
      contentText += `🚫 **${item.quantidade}x ${item.termo}**: O produto **${descricao}** está inativo.\n\n`;
      hasErrorsOrInactives = true;
    } else if (item.status === 'preco_incompleto') {
      const descricao = item.produto?.descricao ?? item.termo;
      contentText += `⚠️ **${item.quantidade}x ${item.termo}**: O produto **${descricao}** está sem preço no cadastro.\n\n`;
      hasErrorsOrInactives = true;
    } else if (item.status === 'sucesso' && item.produto) {
      const formattedQtd = new Intl.NumberFormat('pt-BR').format(item.quantidade);
      const catalogoInfo = resolverTermoCatalogo(item.termo);
      const nomeProduto = catalogoInfo.nomeComercial ?? getShortProductName(item.produto.descricao, item.termo);
      const dimensao = catalogoInfo.dimensaoComercial ? ` (${catalogoInfo.dimensaoComercial})` : '';
      const prazo = catalogoInfo.prazoProducaoTexto ?? 'Prazo sob consulta';
      
      contentText += `🎟️ ${nomeProduto}${dimensao}\n`;
      contentText += `📦 Quantidade: ${formattedQtd} unidades — ${fmtBRL(item.subtotal ?? 0)}\n`;
      contentText += `🏭 Prazo de produção: ${prazo}\n\n`;
    }
  });

  if (allSuccess && totalGeral !== null) {
    // Monta linha de endereço apenas se houver endereço real
    let enderecoDesc: string | null = null;
    if (budgetAddressFull) {
      enderecoDesc = budgetAddressFull;
    } else if (cliente?.enderecos?.length) {
      const end = cliente.enderecos[0];
      if (end.cidade && end.uf) {
        const bairro = end.bairro ? `${end.bairro} | ` : '';
        enderecoDesc = `${bairro}${end.cidade} / ${end.uf}`;
      } else if (end.cep) {
        enderecoDesc = `CEP ${end.cep}`;
      }
    }

    if (enderecoDesc) {
      contentText += `-----------------------------\n`;
      contentText += `📌 ${enderecoDesc}\n`;
      contentText += `-----------------------------\n\n`;
    }

    if (fretes && fretes.length > 0) {
      // Exibe todos os fretes ordenados por valor
      const sortedFretes = [...fretes].sort((a, b) => a.valor - b.valor);
      // Prioriza Sedex como frete sugerido; fallback = menor valor
      const fretePadrao = selecionarFreteSugerido(fretes);

      sortedFretes.forEach(f => {
        contentText += `🚚 ${f.transportadora}: ${fmtBRL(f.valor)}\n`;
        const prazoStr = typeof f.prazo === 'number' ? `${f.prazo} dia(s) útil(eis)` : (f.prazo || 'Sob consulta');
        contentText += `Prazo de entrega: ${prazoStr}\n\n`;
      });

      let subtotalFinal = totalGeral;
      let percentualBonusStr = '';
      if (cliente && cliente.percentualBonus && cliente.percentualBonus > 0) {
        const desconto = Number((totalGeral * cliente.percentualBonus / 100).toFixed(2));
        subtotalFinal = totalGeral - desconto;
        percentualBonusStr = ` (bônus ${cliente.percentualBonus}%)`;
      }

      const subtotalStr = fmtBRL(totalGeral);
      const totalFinalStr = fmtBRL(subtotalFinal + fretePadrao.valor);

      contentText += `🧾 Subtotal produtos: ${subtotalStr}\n`;
      if (percentualBonusStr) {
        contentText += `💸 Subtotal líquido${percentualBonusStr}: ${fmtBRL(subtotalFinal)}\n`;
      }
      contentText += `Frete sugerido (${fretePadrao.transportadora}): ${fmtBRL(fretePadrao.valor)}\n`;
      if (hasMissingWeight) {
        contentText += `⚠️ *Aviso: Os itens orçados não possuem peso cadastrado. O cálculo de transportadoras (como Sedex e PAC) requer o peso total.* Opcionalmente, pode-se prosseguir com Retira no Balcão ou informar outro meio.\n`;
      }
      contentText += `\n💰 Total final: ${totalFinalStr}\n`;
    } else {
      let subtotalFinal = totalGeral;
      let percentualBonusStr = '';
      if (cliente && cliente.percentualBonus && cliente.percentualBonus > 0) {
        const desconto = Number((totalGeral * cliente.percentualBonus / 100).toFixed(2));
        subtotalFinal = totalGeral - desconto;
        percentualBonusStr = ` (bônus ${cliente.percentualBonus}%)`;
      }

      // Sem cliente/endereço/CEP — sem frete real disponível
      contentText += `🧾 Subtotal produtos: ${fmtBRL(totalGeral)}\n`;
      if (percentualBonusStr) {
        contentText += `💸 Subtotal líquido${percentualBonusStr}: ${fmtBRL(subtotalFinal)}\n`;
      }
      contentText += `🚚 Frete: a calcular após informar cliente/endereço\n\n`;
      contentText += `💰 Total (sem frete): ${fmtBRL(subtotalFinal)}\n`;
    }
  } else if (hasErrorsOrInactives) {
    contentText += `\n*Como houve itens não encontrados, inativos ou com dúvidas, o total geral não foi calculado.*\n`;
  }

  return {
    message: {
      id: genId(),
      role: 'maestro',
      content: contentText,
      contentType: 'text',
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [
      { id: genId('step'), label: 'Simulação de orçamento avulso (service)', detail: `Itens: ${resolucao.length}`, status: 'done', timestamp: nowTime() }
    ]
  };
}

export function presenterEsclarecerOrcamento(): PresenterResult {
  return {
    message: {
      id: genId(),
      role: 'maestro',
      content: 'Você quer fazer um orçamento avulso ou consultar informações de um cliente?',
      contentType: 'text',
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [
      { id: genId('step'), label: 'Esclarecer intenção', detail: 'Orçamento vs Cliente', status: 'done', timestamp: nowTime() }
    ]
  };
}

export function presenterContinuacaoOrcamento(): PresenterResult {
  return {
    message: {
      id: genId(),
      role: 'maestro',
      content: 'Você quer continuar o orçamento avulso ou consultar um cliente?',
      contentType: 'text',
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [
      { id: genId('step'), label: 'Esclarecer intenção', detail: 'Continuar orçamento avulso', status: 'done', timestamp: nowTime() }
    ]
  };
}

export function presenterLimparOrcamento(): PresenterResult {
  return {
    message: {
      id: genId(),
      role: 'maestro',
      content: 'Orçamento limpo. O que você gostaria de orçar agora?',
      contentType: 'text',
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [
      { id: genId('step'), label: 'Limpar orçamento', detail: 'Itens removidos', status: 'done', timestamp: nowTime() }
    ]
  };
}

export function presenterVoltarOrcamento(): PresenterResult {
  return {
    message: {
      id: genId(),
      role: 'maestro',
      content: 'Eu saí do orçamento avulso ao consultar o cliente. Quer que eu monte novamente com os itens?',
      contentType: 'text',
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [
      { id: genId('step'), label: 'Voltar ao orçamento', detail: 'Domínio restaurado', status: 'done', timestamp: nowTime() }
    ]
  };
}

export function presenterPerguntarQuantidade(): PresenterResult {
  return {
    message: {
      id: genId(),
      role: 'maestro',
      content: 'Quantas unidades você quer orçar?',
      contentType: 'text',
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [
      { id: genId('step'), label: 'Perguntar quantidade', detail: 'Quantidade ausente', status: 'done', timestamp: nowTime() }
    ]
  };
}

export function presenterRecuperacaoOrcamento(itens: OrcamentoAvulsoItem[], userName?: string): PresenterResult {
  const prefixo = userName ? `Foi mal, ${userName}.` : 'Foi mal.';
  const itensStr = itens && itens.length > 0
    ? itens.map(it => `✅ ${it.quantidade.toLocaleString('pt-BR')} ${it.termo}`).join('\n')
    : 'Nenhum item válido';

  return {
    message: {
      id: genId(),
      role: 'maestro',
      content: `${prefixo} Mantive só os itens válidos do orçamento. Hoje tenho:\n\n${itensStr}\n\nQuer que eu continue daqui ou limpe e recomece?`,
      contentType: 'text',
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [
      { id: genId('step'), label: 'Recuperar orçamento', detail: 'Erro ou reclamação do usuário', status: 'done', timestamp: nowTime() }
    ]
  };
}

export function presenterCancelarOrcamentoAvulso(activeClient: any): PresenterResult {
  const msgText = activeClient
    ? `Tudo bem, deixei o orçamento avulso de lado. Seguimos com o cliente ativo **${activeClient.clientName || `código ${activeClient.clientDisplayCode}`}**.`
    : `Tudo bem, deixei o orçamento avulso de lado. Como posso ajudar agora?`;
    
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     msgText,
      contentType: 'text',
      sources:     [],
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [
      { id: genId('step'), label: 'Cancelar orçamento', detail: 'Foco no cliente ativo', status: 'done', timestamp: nowTime() }
    ],
    lastAnswerUpdate: null
  };
}

export function presenterMostrarItensOrcamento(itens: OrcamentoAvulsoItem[]): PresenterResult {
  const lines = itens && itens.length > 0
    ? itens.map(it => `✅ **${it.quantidade.toLocaleString('pt-BR')}** ${it.termo}`).join('\n')
    : 'Nenhum item ativo no momento.';
    
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     `No orçamento atual temos os seguintes itens:\n\n${lines}`,
      contentType: 'text',
      sources:     [],
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [
      { id: genId('step'), label: 'Mostrar itens', detail: 'Listar itens ativos', status: 'done', timestamp: nowTime() }
    ],
    lastAnswerUpdate: null
  };
}

export function presenterEscolhaEndereco(pending: { clientId: number, addresses: any[] }): PresenterResult {
  const opcoesMd = pending.addresses.map((end, idx) => {
    const endFormatado = `${end.endereco}, ${end.numero} - ${end.bairro}, ${end.cidade}/${end.uf}`;
    return `**Opção ${idx + 1}**: ${end.tipo_endereco || 'ENTREGA'} - ${endFormatado} (CEP: ${end.cep})`;
  }).join('\n');

  const count = pending.addresses.length;
  const textoEnderecos = count === 1 ? '1 endereço' : `${count} endereços`;

  return {
    message: {
      id: 'maestro-msg-' + Date.now(),
      role: 'maestro',
      content: `Encontrei ${textoEnderecos} para este cadastro. Qual deles uso para cotação do frete?\n\n${opcoesMd}\n\nPode responder com o número ("1", "2"...) ou naturalmente — "o segundo", "o de entrega", "o de Porto Alegre".`,
      contentType: 'text',
      sources: [],
      specialist: 'comercial',
      timestamp: new Date().toISOString(),
      status: 'completed',
      confidence: 'high'
    },
    activity: [
      {
        id: 'escolha-endereco-' + Date.now(),
        label: `Escolhendo Endereço`,
        detail: `Cliente ID ${pending.clientId}`,
        status: 'done',
        timestamp: new Date().toISOString()
      }
    ]
  };
}


export function presenterSolicitarEnderecoManual(cliente: any): PresenterResult {
  return {
    message: {
    id: 'maestro-msg-' + Date.now(),
      role: 'maestro',
      content: `Para prosseguir com a cotação de frete para **${cliente?.clientName || 'este cliente'}**, preciso do endereço ou CEP de destino (nenhum endereço foi encontrado no cadastro).\n\nPor favor, digite o CEP ou endereço completo para calcularmos o frete.`,
      contentType: 'text',
      sources: [],
      specialist: 'comercial',
      timestamp: new Date().toISOString(),
      status: 'completed',
      confidence: 'high'
    },
    activity: [
      {
        id: 'endereco-manual-' + Date.now(),
        label: 'Aguardando Endereço',
        detail: 'Nenhum endereço no cadastro',
        status: 'done',
        timestamp: new Date().toISOString()
      }
    ]
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase 3a: Presenters de Salvar Cotação
// ─────────────────────────────────────────────────────────────────────────────

import type { PendingSaveQuotation } from './maestro-v2-context-manager';

/**
 * Pergunta de confirmação exibida ao final da cotação vinculada com frete.
 * Exibida automaticamente pelo engine após montar a cotação completa.
 */
export function presenterPerguntarSalvarCotacao(pending: PendingSaveQuotation): PresenterResult {
  const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const lines: string[] = [];

  lines.push(`---`);
  lines.push(`💾 **Deseja salvar esta cotação como proposta no ERP?**`);
  lines.push(``);
  lines.push(`**Cliente:** ${pending.clientName}`);
  lines.push(`**Endereço:** ${pending.enderecoFull}`);
  lines.push(`**Itens:** ${pending.itens.length}`);
  lines.push(`**Subtotal:** ${formatBRL(pending.subtotal)}`);
  lines.push(`**Frete (${pending.freteEscolhido.transportadora}):** ${formatBRL(pending.freteEscolhido.valor)}`);
  lines.push(`**Total:** ${formatBRL(pending.total)}`);
  lines.push(``);


  return {
    message: {
      id: genId('save-confirm'),
      role: 'maestro',
      content: lines.join('\n'),
      contentType: 'text',
      sources: [],
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
      actions: [
        { label: '💾 Salvar cotação', value: 'salvar cotação', style: 'primary' },
        { label: '🚫 Cancelar', value: 'cancelar', style: 'danger' },
      ],
    },
    activity: [
      {
        id: genId('save-act'),
        label: 'Aguardando Confirmação',
        detail: 'Cotação completa — aguardando resposta do usuário',
        status: 'done',
        timestamp: now(),
      },
    ],
  };
}

/**
 * Resposta de sucesso após salvar a proposta.
 */
export function presenterSaveCotacaoSucesso(idInt: number, clientName: string): PresenterResult {
  const lines: string[] = [];
  lines.push(`✅ **Proposta criada com sucesso!**`);
  lines.push(``);
  lines.push(`**Cliente:** ${clientName}`);
  lines.push(`**Número da proposta:** #${idInt}`);
  lines.push(``);
  lines.push(`📋 [Abrir proposta #${idInt} no ERP](/orcamentos/${idInt}/editar)`);
  lines.push(``);
  lines.push(`> ⚠️ **Antes de avançar, revise a proposta no ERP:** verifique cliente, itens, frete e valores antes de gerar cobrança ou enviar ao cliente.`);

  return {
    message: {
      id: genId('save-ok'),
      role: 'maestro',
      content: lines.join('\n'),
      contentType: 'text',
      sources: [],
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
      actions: [
        { label: `📋 Abrir proposta #${idInt}`, value: `/orcamentos/${idInt}/editar`, style: 'primary' },
      ],
    },
    activity: [
      {
        id: genId('save-ok-act'),
        label: 'Proposta Salva',
        detail: `#${idInt} criada com status NOVO`,
        status: 'done',
        timestamp: now(),
      },
    ],
  };
}

/**
 * Resposta quando o usuário cancela o salvamento.
 */
export function presenterCancelarSaveCotacao(): PresenterResult {
  return {
    message: {
      id: genId('save-cancel'),
      role: 'maestro',
      content: `🚫 **Salvamento cancelado.** A cotação foi descartada — nenhum dado foi gravado no ERP.\n\nSe quiser fazer uma nova cotação, é só me pedir.`,
      contentType: 'text',
      sources: [],
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [],
  };
}

/**
 * Resposta quando o usuário escolhe "editar antes".
 */
export function presenterEditarAntesSave(idInt?: number): PresenterResult {
  const lines: string[] = [];
  if (idInt) {
    lines.push(`✏️ **Para editar a proposta #${idInt}:**`);
    lines.push(``);
    lines.push(`📋 [Abrir proposta #${idInt} no ERP](/orcamentos/${idInt}/editar)`);
    lines.push(``);
    lines.push(`Nenhum dado automático foi alterado. Edite pela tela de Orçamentos e salve lá.`);
  } else {
    lines.push(`✏️ **Para editar antes de salvar:**`);
    lines.push(``);
    lines.push(`Primeiro salve a cotação respondendo **salvar cotação** e depois edite pelo link que aparecer.`);
    lines.push(``);
    lines.push(`Ou, se preferir, monte o orçamento diretamente na tela de **Orçamentos** do ERP para ter controle completo.`);
  }

  return {
    message: {
      id: genId('save-edit'),
      role: 'maestro',
      content: lines.join('\n'),
      contentType: 'text',
      sources: [],
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [],
  };
}

/**
 * Resposta quando o usuário tenta salvar uma cotação que já foi salva.
 * Evita duplicação.
 */
export function presenterPropostaJaSalva(idInt: number, clientName: string): PresenterResult {
  return {
    message: {
      id: genId('already-saved'),
      role: 'maestro',
      content: `ℹ️ Esta cotação já foi salva como proposta **#${idInt}** para **${clientName}**.\n\n📋 [Abrir proposta #${idInt} no ERP](/orcamentos/${idInt}/editar)\n\nSe quiser fazer uma nova cotação, é só me pedir.`,
      contentType: 'text',
      sources: [],
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [],
  };
}

/**
 * Resposta de erro ao tentar salvar.
 */
export function presenterErroSaveCotacao(errorMessage: string, bloqueadoPorContato?: boolean): PresenterResult {
  const lines: string[] = [];
  if (bloqueadoPorContato) {
    lines.push(`⛔ **Não foi possível salvar a proposta.**`);
    lines.push(``);
    lines.push(errorMessage);
  } else {
    lines.push(`❌ **Erro ao salvar a proposta.**`);
    lines.push(``);
    lines.push(`${errorMessage}`);
    lines.push(``);
    lines.push(`Tente novamente ou abra a tela de Orçamentos para salvar manualmente.`);
  }

  return {
    message: {
      id: genId('save-err'),
      role: 'maestro',
      content: lines.join('\n'),
      contentType: 'text',
      sources: [],
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high',
    },
    activity: [],
  };
}

/**
 * Resposta para consultar os fretes da cotação ativa no contexto V2.
 */
export function presenterConsultarFretesCotacao(pendingQuotation: any): PresenterResult {
  const fretes = pendingQuotation.fretes || [];
  if (fretes.length === 0) {
    return {
      message: {
        id: genId('frete-vazio'),
        role: 'maestro',
        content: 'Não encontrei nenhuma opção de frete retornada para essa cotação.',
        contentType: 'text',
        timestamp: now(),
        status: 'completed'
      },
      activity: []
    };
  }

  let contentText = 'Aqui estão as opções de frete retornadas para esta cotação:\n\n';
  fretes.forEach((f: any) => {
    const isSedex = f.servico?.toLowerCase().includes('sedex') || f.transportadora?.toLowerCase().includes('sedex');
    const badge = isSedex ? ' 🚀' : '';
    contentText += `- **${f.transportadora}** (${f.servico})${badge}: ${fmtBRL(f.valor)} — Prazo: ${f.prazo}\n`;
  });

  return {
    message: {
      id: genId('frete-info'),
      role: 'maestro',
      content: contentText,
      contentType: 'text',
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high'
    },
    activity: []
  };
}

// ─── Cotação Ativa Conversável ───────────────────────────────────────────────────

/**
 * Responde perguntas sobre a cotação ativa usando somente dados do snapshot.
 * NUNCA inventa características técnicas, materiais, acabamentos ou impressões.
 */
export function presenterConsultarCotacaoAtiva(
  quote: ActiveQuoteSnapshot,
  queryType: string
): PresenterResult {
  let content = '';
  // Encurta descrições longas conhecidas para o card; nomes vindos do
  // catálogo oficial/banco passam intactos. Word-boundary evita falsos
  // positivos (ex.: "suporte" continha "up" e virava "Ingresso UP BOX").
  const formatName = (n: string) => {
    const lower = n.toLowerCase();
    if (/\bmobi\b/.test(lower)) return 'Ingresso MOBI';
    if (/\bup(\s*box)?\b/.test(lower)) return 'Ingresso UP BOX';
    if (lower.includes('pulseira') && lower.includes('triband')) return 'Triband';
    if (/\b(cordao|cordão|jacare|jacaré)\b/.test(lower)) return 'Cordão Jacaré';
    return n;
  };

  switch (queryType) {
    case 'subtotal':
      if (quote.percentualBonus && quote.descontoReais && quote.percentualBonus > 0) {
        content = `O subtotal dos produtos nessa cotação é **${formatBRL(quote.subtotalProdutos)}**. Com o bônus de ${quote.percentualBonus}%, o subtotal líquido fica **${formatBRL(quote.subtotalLiquido || quote.subtotalProdutos)}**.`;
      } else {
        content = `O subtotal dos produtos nessa cotação é **${formatBRL(quote.subtotalProdutos)}**.`;
      }
      break;
    case 'total':
      content = 'O total final dessa cotação é **' + formatBRL(quote.total) + '** (produtos líquidos: ' + formatBRL(quote.subtotalLiquido || quote.subtotalProdutos) + ' + frete ' + quote.freteSelecionado.transportadora + ': ' + formatBRL(quote.freteSelecionado.valor) + ').';
      break;
    case 'frete_sugerido':
      content = 'O frete sugerido foi **' + quote.freteSelecionado.transportadora + '** por **' + formatBRL(quote.freteSelecionado.valor) + '** (' + (quote.freteSelecionado.prazo || 'prazo não informado') + ').';
      break;
    case 'transportadoras': {
      const lista = quote.fretes.map((f, i) => (i + 1) + '. **' + f.transportadora + '** — ' + formatBRL(f.valor) + ' (' + (f.prazo || 'prazo não informado') + ')').join('\n');
      content = 'As transportadoras disponíveis nessa cotação foram:\n\n' + lista;
      break;
    }
    case 'endereco':
      content = 'O endereço usado nessa cotação foi: **' + quote.enderecoFull + '**' + (quote.cep ? ' (CEP: ' + quote.cep + ')' : '') + '.';
      break;
    case 'itens': {
      const li = quote.itens.map((it, i) => (i + 1) + '. **' + formatName(it.nome) + '** — ' + it.quantidade.toLocaleString('pt-BR') + ' un. — ' + formatBRL(it.subtotal)).join('\n');
      content = 'Os itens dessa cotação foram:\n\n' + li;
      break;
    }
    case 'peso':
      content = quote.pesoTotalGramas > 0
        ? `Tenho apenas o peso total calculado da cotação: **${quote.pesoTotalGramas.toLocaleString('pt-BR')} g**. O peso por produto não está disponível no snapshot atual.`
        : 'O peso não consta no snapshot dessa cotação.';
      break;
    case 'resumo':
    default: {
      const liR = quote.itens.map(it => '- ' + formatName(it.nome) + ': ' + it.quantidade.toLocaleString('pt-BR') + ' un. — ' + formatBRL(it.subtotal)).join('\n');
      const salvaSuffix = (quote.status === 'salva' && quote.savedIdInt)
        ? 'Proposta #' + quote.savedIdInt + ' salva.'
        : 'Ainda não salva. Deseja salvar como proposta?';
        
      let bonusText = '';
      if (quote.percentualBonus && quote.descontoReais && quote.percentualBonus > 0) {
        bonusText = `Bônus (${quote.percentualBonus}%): **-${formatBRL(quote.descontoReais)}**\nSubtotal com Bônus: **${formatBRL(quote.subtotalLiquido || quote.subtotalProdutos)}**\n`;
      }
      
      content = '**Cotação ativa para ' + quote.clientName + '**\n\nItens:\n' + liR + '\n\nSubtotal: **' + formatBRL(quote.subtotalProdutos) + '**\n' + bonusText + 'Frete (' + quote.freteSelecionado.transportadora + '): **' + formatBRL(quote.freteSelecionado.valor) + '**\nTotal: **' + formatBRL(quote.total) + '**\n\nEndereço: ' + quote.enderecoFull + '\n\n' + salvaSuffix;
      break;
    }
  }
  return {
    message: { id: genId('quote-query'), role: 'maestro', content, contentType: 'text', specialist: 'comercial', timestamp: now(), status: 'completed', confidence: 'high' },
    activity: [{ id: 'q1', label: 'Consultando cotação ativa', status: 'done', timestamp: nowTime() }],
    lastAnswerUpdate: null,
  };
}

/** Confirma troca de frete e mostra total atualizado. */
export function presenterTrocaFreteCotacaoAtiva(quote: ActiveQuoteSnapshot): PresenterResult {
  return {
    message: {
      id: genId('frete-swap'), role: 'maestro',
      content: 'Frete atualizado para **' + quote.freteSelecionado.transportadora + '**!\n\nFrete: **' + formatBRL(quote.freteSelecionado.valor) + '** (' + (quote.freteSelecionado.prazo || 'prazo não informado') + ')\nSubtotal produtos: **' + formatBRL(quote.subtotalProdutos) + '**\n**Total atualizado: ' + formatBRL(quote.total) + '**',
      contentType: 'text', specialist: 'comercial', timestamp: now(), status: 'completed', confidence: 'high',
    },
    activity: [{ id: 'f1', label: 'Frete atualizado', status: 'done', timestamp: nowTime() }],
    lastAnswerUpdate: null,
  };
}

/** Informa que transportadora não apareceu na cotação e lista opções reais. */
export function presenterFreteNaoDisponivel(fretes: ActiveQuoteSnapshot['fretes'], mentioned: string): PresenterResult {
  const opcoes = fretes.map((f, i) => (i + 1) + '. **' + f.transportadora + '** — ' + formatBRL(f.valor)).join('\n');
  return {
    message: {
      id: genId('frete-nd'), role: 'maestro',
      content: 'A transportadora **' + mentioned + '** não apareceu nesta cotação. ' + (opcoes ? 'As opções disponíveis são:\n\n' + opcoes : 'Não há opções de frete nesta cotação.'),
      contentType: 'text', specialist: 'comercial', timestamp: now(), status: 'completed', confidence: 'high',
    },
    activity: [],
    lastAnswerUpdate: null,
  };
}

/** Apresenta itens + subtotal + lista numerada de transportadoras para escolha.
 *  Análogo ao presenterEscolhaEndereco — usuário responde com "1", "2", etc.
 *  Destaca a opção de menor preço com 💚.
 */
export function presenterEscolhaTransportadora(
  clientName: string,
  enderecoFull: string,
  itens: Array<{ nome: string; quantidade: number; subtotal: number }>,
  subtotal: number,
  fretes: Array<{ transportadora: string; servico: string; valor: number; prazo?: string }>,
  percentualBonus?: number,
  descontoReais?: number,
  subtotalLiquido?: number
): PresenterResult {
  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const validForMin = fretes.filter(f => (f as any).id !== 'retira_balcao' && f.transportadora !== 'Retira no balcão');
  const menorValor = validForMin.length > 0 ? Math.min(...validForMin.map(f => f.valor)) : Math.min(...fretes.map(f => f.valor));

  // Encurta descrições longas conhecidas para o card; nomes vindos do
  // catálogo oficial/banco passam intactos. Word-boundary evita falsos
  // positivos (ex.: "suporte" continha "up" e virava "Ingresso UP BOX").
  const formatName = (n: string) => {
    const lower = n.toLowerCase();
    if (/\bmobi\b/.test(lower)) return 'Ingresso MOBI';
    if (/\bup(\s*box)?\b/.test(lower)) return 'Ingresso UP BOX';
    if (lower.includes('pulseira') && lower.includes('triband')) return 'Triband';
    if (/\b(cordao|cordão|jacare|jacaré)\b/.test(lower)) return 'Cordão Jacaré';
    return n;
  };

  const listaItens = itens
    .map(it => `🎟️ ${formatName(it.nome)}\n📦 Quantidade: ${it.quantidade.toLocaleString('pt-BR')} unidades — ${fmtBRL(it.subtotal)}`)
    .join('\n\n');

  const listaOpcoes = fretes.length > 2
    ? fretes.map((_, i) => `"${i + 1}"`).join(', ')
    : fretes.map((_, i) => `"${i + 1}"`).join(' ou ');

  const listaFretes = fretes
    .map((f, i) => {
      const destaque = f.valor === menorValor ? ' 💚 menor preço' : '';
      const prazo = f.prazo ? ` — Prazo: ${f.prazo}` : '';
      const obs = (f as any).observacao ? `\n> ⚠️ ${(f as any).observacao}` : '';
      return `Opção ${i + 1}: ${f.transportadora} — ${fmtBRL(f.valor)}${prazo}${destaque}${obs}`;
    })
    .join('\n');

  const lines = [
    `📄 Orçamento para ${clientName}`,
    ``,
    listaItens,
    ``,
    `-----------------------------`,
    `📌 ${enderecoFull}`,
    `-----------------------------`,
    ``,
    `🧾 Subtotal produtos: ${fmtBRL(subtotal)}`,
  ];

  if (percentualBonus && descontoReais && percentualBonus > 0) {
    lines.push(`🎁 Bônus (${percentualBonus}%): -${fmtBRL(descontoReais)}`);
    lines.push(`💰 Subtotal com Bônus: ${fmtBRL(subtotalLiquido || subtotal)}`);
  }

  lines.push(
    ``,
    `🚚 Escolha a transportadora para entrega:`,
    ``,
    listaFretes,
    ``,
    `Pode responder com ${listaOpcoes} — ou naturalmente: "a mais barata", "sedex", "a segunda".`
  );

  const content = lines.join('\n');

  return {
    message: {
      id:          genId('frete-choice'),
      role:        'maestro',
      content,
      contentType: 'text',
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [
      { id: 'step-1', label: 'Produtos calculados',                    status: 'done',    timestamp: nowTime() },
      { id: 'step-2', label: 'Fretes calculados',                      status: 'done',    timestamp: nowTime() },
      { id: 'step-3', label: 'Aguardando escolha de transportadora',   status: 'pending', timestamp: nowTime() },
    ],
    lastAnswerUpdate: null,
  };
}

/**
 * Exibe o card formatado da proposta após o usuário confirmar a transportadora.
 * Mantém o mesmo visual do card original de orçamento (com emojis, separadores, etc).
 */
export function presenterFreteConfirmado(quote: ActiveQuoteSnapshot): PresenterResult {
  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  // Encurta descrições longas conhecidas para o card; nomes vindos do
  // catálogo oficial/banco passam intactos. Word-boundary evita falsos
  // positivos (ex.: "suporte" continha "up" e virava "Ingresso UP BOX").
  const formatName = (n: string) => {
    const lower = n.toLowerCase();
    if (/\bmobi\b/.test(lower)) return 'Ingresso MOBI';
    if (/\bup(\s*box)?\b/.test(lower)) return 'Ingresso UP BOX';
    if (lower.includes('pulseira') && lower.includes('triband')) return 'Triband';
    if (/\b(cordao|cordão|jacare|jacaré)\b/.test(lower)) return 'Cordão Jacaré';
    return n;
  };

  const listaItens = quote.itens
    .map(it => [
      `🎟️ ${formatName(it.nome)}`,
      `📦 Quantidade: ${it.quantidade.toLocaleString('pt-BR')} unidades — ${fmtBRL(it.subtotal)}`,
      `🏭 Prazo de produção: Prazo sob consulta`,
    ].join('\n'))
    .join('\n\n');

  const prazoFrete = quote.freteSelecionado.prazo
    ? `Prazo de entrega: ${quote.freteSelecionado.prazo}`
    : '';

  const lines = [
    `📄 Orçamento para ${quote.clientName}`,
    ``,
    listaItens,
    ``,
    `-----------------------------`,
    `📌 ${quote.enderecoFull}`,
    `-----------------------------`,
    ``,
    `🧾 Subtotal produtos: ${fmtBRL(quote.subtotalProdutos)}`,
  ];

  if (quote.percentualBonus && quote.descontoReais && quote.percentualBonus > 0) {
    lines.push(`🎁 Bônus (${quote.percentualBonus}%): -${fmtBRL(quote.descontoReais)}`);
    lines.push(`💰 Subtotal com Bônus: ${fmtBRL(quote.subtotalLiquido || quote.subtotalProdutos)}`);
  }

  lines.push(
    `🚚 ${quote.freteSelecionado.transportadora}: ${fmtBRL(quote.freteSelecionado.valor)}`
  );
  if (prazoFrete) lines.push(prazoFrete);
  
  lines.push(
    ``,
    `💰 **Total da Proposta: ${fmtBRL(quote.total)}**`
  );

  return {
    message: {
      id:          genId('frete-confirmed'),
      role:        'maestro',
      content:     lines.join('\n'),
      contentType: 'text',
      specialist:  'comercial',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [
      { id: 'step-1', label: 'Produtos calculados',      status: 'done', timestamp: nowTime() },
      { id: 'step-2', label: 'Frete selecionado',        status: 'done', timestamp: nowTime() },
      { id: 'step-3', label: 'Orçamento finalizado',     status: 'done', timestamp: nowTime() },
    ],
    lastAnswerUpdate: null,
  };
}

/**
 * Resposta curta para mensagens sociais.
 * `temCotacaoAberta` DEVE refletir o estado real (activeQuote não salva ou
 * pendingSaveQuotation sem savedIdInt) — este presenter nunca afirma cotação
 * que não existe.
 */
export function presenterRespostaSocialCotacao(userName?: string | null, temCotacaoAberta = false): PresenterResult {
  const nome = userName ? userName.split(' ')[0] : '';
  const greeting = nome ? `Por nada, ${nome}!` : `Por nada!`;
  const sufixo = temCotacaoAberta
    ? ' A cotação continua aberta se quiser salvar ou ajustar.'
    : ' Estou por aqui quando precisar.';
  return {
    message: {
      id: genId('social-cotacao'),
      role: 'maestro',
      content: `${greeting}${sufixo}`,
      contentType: 'text',
      specialist: 'comercial',
      timestamp: now(),
      status: 'completed',
      confidence: 'high'
    },
    activity: []
  };
}
