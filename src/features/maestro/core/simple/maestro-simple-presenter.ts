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
import type { OrcamentoAvulsoItem } from './maestro-v2-context-manager';

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

      if (c.isBonus != null) {
        text += `\n\n• **Bônus Ativo:** ${c.isBonus ? 'Sim' : 'Não'}`;
        if (c.isBonus && c.percentualBonus) {
          text += `\n• **Percentual:** ${formatPercent(c.percentualBonus)}`;
        }
      } else {
        text += `\n_Não há dado preenchido sobre bônus neste cadastro._`;
      }
      
      buildField('limite_credito / is_bonus', 'Crédito e Bônus', hasCredito ? 'Disponível' : 'ND', text);
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

export function presenterAjuda(): PresenterResult {
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     'Bom dia! Me diga o cliente, pedido ou assunto que você quer consultar.',
      contentType: 'text',
      specialist:  'geral',
      timestamp:   now(),
      status:      'completed',
      confidence:  'high',
    },
    activity: [],
  };
}

export function presenterClosure(): PresenterResult {
  return {
    message: {
      id:          genId(),
      role:        'maestro',
      content:     'De nada! Quando precisar, é só chamar.',
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
  const nome = userName || 'Everton';
  const itensStr = itens && itens.length > 0
    ? itens.map(it => `✅ ${it.quantidade.toLocaleString('pt-BR')} ${it.termo}`).join('\n')
    : 'Nenhum item válido';
  
  return {
    message: {
      id: genId(),
      role: 'maestro',
      content: `Foi mal, ${nome}. Mantive só os itens válidos do orçamento. Hoje tenho:\n\n${itensStr}\n\nQuer que eu continue daqui ou limpe e recomece?`,
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


