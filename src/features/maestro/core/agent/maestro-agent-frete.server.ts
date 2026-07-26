/**
 * maestro-agent-frete.server.ts
 *
 * Cotação de frete para o agent loop — MESMO padrão do fluxo de orçamentos
 * (frete.service.ts) e do motor legado do Maestro (maestro-simple-engine.ts):
 *   - SEDEX/PAC, Azul Cargo (fora do RS), transportadoras (RPC) e VEPPO
 *     (RS fora de Porto Alegre), via Promise.allSettled — falha parcial não
 *     derruba a cotação;
 *   - peso SEMPRE em gramas; volumes = ceil(peso / 14500);
 *   - "Retira no Balcão" R$ 0,00 sempre presente (lista nunca vazia);
 *   - valores vêm 100% dos serviços — o modelo nunca fornece número.
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  solicitarCotacaoSedex,
  solicitarCotacaoAzulCargo,
  solicitarCotacaoTransportadoras,
  solicitarCotacaoVeppo,
} from '@/features/orcamentos/services/frete.service';
import type { PropostaFrete } from '@/features/orcamentos/types';

export interface EnderecoFrete {
  id: string;
  cep: string;
  bairro: string;
  cidade: string;
  uf: string;
  enderecoFull: string;
}

export interface OpcaoFrete {
  id: string;
  transportadora: string;
  servico: string;
  valor: number;
  prazo: string;
  /** Subtotal dos itens + valor desta opção (calculado no servidor) */
  totalComFrete?: number;
}

export interface CotacaoFreteResult {
  found: boolean;
  endereco: EnderecoFrete | null;
  pesoGramas: number;
  opcoes: OpcaoFrete[];
  avisos: string[];
  source: string;
}

export const OPCAO_RETIRA_BALCAO: OpcaoFrete = {
  id: 'retira_balcao',
  transportadora: 'Retira no Balcão',
  servico: 'Retirada no local',
  valor: 0,
  prazo: 'A combinar',
};

const GRAMAS_POR_VOLUME = 14_500;

function normalizarTexto(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Endereço UTILIZÁVEL para cotação (cep com 8 dígitos + cidade + uf),
 * preferindo o tipo PRINCIPAL — mesmo critério do motor legado.
 */
export async function resolverEnderecoFrete(
  supabase: SupabaseClient,
  idCliente: number,
): Promise<EnderecoFrete | null> {
  const { data } = await supabase.from('enderecos').select('*').eq('id_cliente', idCliente).limit(10);
  const utilizaveis = (data ?? []).filter(raw => {
    const e = raw as Record<string, unknown>;
    const cep = typeof e.cep === 'string' ? e.cep.replace(/\D/g, '') : '';
    return cep.length >= 8 && typeof e.cidade === 'string' && e.cidade.trim() && typeof e.uf === 'string' && e.uf.trim();
  });
  if (utilizaveis.length === 0) return null;
  const principal =
    utilizaveis.find(e =>
      String((e as Record<string, unknown>).tipo_endereco ?? '').toUpperCase().includes('PRINCIPAL'),
    ) ?? utilizaveis[0];
  const p = principal as Record<string, unknown>;
  const rua = [p.rua, p.logradouro, p.endereco].find(v => typeof v === 'string' && v) as string | undefined;
  const numero = p.numero != null ? String(p.numero) : '';
  return {
    id: p.id != null ? String(p.id) : '',
    cep: String(p.cep),
    bairro: typeof p.bairro === 'string' ? p.bairro.trim() : '',
    cidade: String(p.cidade).trim(),
    uf: String(p.uf).trim().toUpperCase(),
    enderecoFull: [rua, numero].filter(Boolean).join(', '),
  };
}

function mapearOpcao(f: PropostaFrete): OpcaoFrete | null {
  const valor = Number(f.valor);
  if (!Number.isFinite(valor) || valor <= 0) return null;
  return {
    id: f.id,
    transportadora: f.transportadora || 'Transportadora',
    servico: f.servico || '',
    valor: Number(valor.toFixed(2)),
    prazo: f.prazo || 'Sob consulta',
  };
}

/**
 * Cota as opções de frete para o cliente (endereço resolvido no servidor).
 * `valorTotal` (subtotal dos itens) alimenta seguro/valor declarado das
 * cotações que o exigem, como no fluxo de orçamentos.
 */
export async function cotarOpcoesFrete(
  supabase: SupabaseClient,
  idCliente: number,
  params: { pesoGramas: number; valorTotal: number },
): Promise<CotacaoFreteResult> {
  const pesoGramas = Math.max(0, Math.round(params.pesoGramas));
  const avisos: string[] = [];
  const opcoes: OpcaoFrete[] = [];
  const endereco = await resolverEnderecoFrete(supabase, idCliente);

  if (!endereco) {
    avisos.push(
      'Cliente sem endereço utilizável para cotação (CEP + cidade + UF). Apenas "Retira no Balcão" disponível — o endereço pode ser cadastrado no ERP.',
    );
  } else if (pesoGramas <= 0) {
    avisos.push('Itens sem peso cadastrado — não foi possível cotar frete por transportadora. Apenas "Retira no Balcão" disponível.');
  } else {
    const volumes = Math.max(1, Math.ceil(pesoGramas / GRAMAS_POR_VOLUME));
    const cotacoes: Promise<PropostaFrete[]>[] = [
      solicitarCotacaoSedex({ peso: pesoGramas, vol: volumes, cep: endereco.cep }),
    ];
    if (endereco.uf !== 'RS') {
      cotacoes.push(solicitarCotacaoAzulCargo({ peso: pesoGramas, cep: endereco.cep, valorTotal: params.valorTotal }));
    }
    cotacoes.push(solicitarCotacaoTransportadoras({ peso: pesoGramas, cidade: endereco.cidade, uf: endereco.uf }));
    cotacoes.push(solicitarCotacaoVeppo({ peso: pesoGramas, valor: params.valorTotal, cidade: endereco.cidade, uf: endereco.uf }));

    const resultados = await Promise.allSettled(cotacoes);
    for (const r of resultados) {
      if (r.status !== 'fulfilled') continue;
      for (const f of r.value) {
        const opcao = mapearOpcao(f);
        if (opcao) opcoes.push(opcao);
      }
    }
    if (opcoes.length === 0) {
      avisos.push('Nenhuma transportadora retornou cotação agora — apenas "Retira no Balcão" disponível (dá para tentar de novo em instantes).');
    }
  }

  opcoes.push(OPCAO_RETIRA_BALCAO);
  // Total pronto por opção (subtotal + frete) — o modelo nunca soma
  const comTotais = opcoes.map(o => ({
    ...o,
    totalComFrete: Number((params.valorTotal + o.valor).toFixed(2)),
  }));
  return {
    found: true,
    endereco,
    pesoGramas,
    opcoes: comTotais,
    avisos,
    source: 'frete.service (SEDEX/PAC, Azul Cargo, transportadoras, VEPPO) + Retira no Balcão',
  };
}

export type EscolhaFrete =
  | { ok: true; opcao: OpcaoFrete }
  | { ok: false; motivo: string };

/**
 * Resolve DETERMINISTICAMENTE a escolha de frete do usuário contra as opções
 * cotadas: vazio/"retira" → balcão; "mais barato" → menor valor calculado;
 * senão match por id/transportadora/serviço normalizados (ambíguo → erro).
 */
export function escolherOpcaoFrete(opcoes: OpcaoFrete[], escolha?: string): EscolhaFrete {
  const termo = normalizarTexto(escolha ?? '');
  if (!termo || /\b(retira|retirada|balcao|local)\b/.test(termo)) {
    return { ok: true, opcao: OPCAO_RETIRA_BALCAO };
  }

  const calculadas = opcoes.filter(o => o.id !== OPCAO_RETIRA_BALCAO.id);
  if (/(mais barat|menor (preco|valor)|econom)/.test(termo)) {
    if (calculadas.length === 0) return { ok: true, opcao: OPCAO_RETIRA_BALCAO };
    return { ok: true, opcao: [...calculadas].sort((a, b) => a.valor - b.valor)[0] };
  }

  const porId = calculadas.find(o => normalizarTexto(o.id) === termo);
  if (porId) return { ok: true, opcao: porId };

  const matches = calculadas.filter(o =>
    `${normalizarTexto(o.transportadora)} ${normalizarTexto(o.servico)}`.includes(termo),
  );
  if (matches.length === 1) return { ok: true, opcao: matches[0] };
  if (matches.length > 1) {
    return {
      ok: false,
      motivo: `Escolha de frete ambígua ("${escolha}"): ${matches.map(m => `${m.transportadora} ${m.servico} R$ ${m.valor.toFixed(2)}`).join('; ')}. Peça ao usuário para especificar.`,
    };
  }
  return {
    ok: false,
    motivo: `Nenhuma opção de frete corresponde a "${escolha}". Opções cotadas: ${opcoes.map(o => `${o.transportadora} ${o.servico} R$ ${o.valor.toFixed(2)}`).join('; ')}.`,
  };
}
