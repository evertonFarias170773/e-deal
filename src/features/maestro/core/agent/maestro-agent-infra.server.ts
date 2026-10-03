/**
 * maestro-agent-infra.server.ts
 *
 * "Como está o banco?": a mesma leitura do painel "Saúde da infraestrutura" do
 * Dashboard, entregue ao Maestro já pronta para ser explicada em linguagem
 * simples. SÓ LEITURA e SÓ ADMINISTRADOR.
 *
 * MESMA FONTE DO PAINEL
 *   Os números não são recalculados aqui. A leitura vem da MESMA função que a
 *   rota /api/admin/infra-saude usa (métricas da Supabase + infra_saude_resumo),
 *   com o mesmo cache de 10 minutos, os mesmos limites de amarelo e vermelho
 *   (src/features/dashboard/infra-saude.ts) e os mesmos textos de cada cartão.
 *   Valor, limite e faixas saem formatados pelo MESMO formatador do painel: o
 *   modelo copia, não converte.
 *
 * QUEM RECEBE
 *   A regra é a da própria rota: usuarios.is_admin ou usuarios.is_super_adm.
 *   Quem não é recebe SO_ADMINISTRADOR e NENHUM dado. Quem decide é o servidor,
 *   na execução da ferramenta (flag soAdministrador) e na leitura da ficha do
 *   manual (linha "Acesso: somente administradores").
 *
 * O QUE É CALCULADO AQUI (e nunca pelo modelo)
 *   · o panorama (quantos cartões em cada cor);
 *   · a PREVISÃO DE ESPAÇO: em quantos meses os 100 GB acabam pelo ritmo dos
 *     últimos 30 dias, e quais pastas mais crescem.
 *
 * ⚠️ Roda apenas no servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ROTULO_DO_NIVEL,
  descreverFaixas,
  formatarBytes,
  formatarValorSaude,
  type InfraSaude,
  type MetricaSaude,
  type NivelSaude,
} from '../../../dashboard/infra-saude';
import { lerSaudeDaInfraDoAmbiente } from '../../../dashboard/infra-saude.server';

const FUSO = 'America/Sao_Paulo';
const DIAS_DO_RITMO = 30;
const MAX_PASTAS_NA_RESPOSTA = 8;
const MAX_PASTAS_QUE_CRESCEM = 5;

/** Slug da ficha do manual que explica cada cartão e diz o que fazer. */
export const FICHA_DA_SAUDE = 'saude-da-infraestrutura';

export const RECUSA_SAUDE_DA_INFRA =
  'SO_ADMINISTRADOR: a saúde da infraestrutura (banco, memória, disco, conexões e arquivos) é informação restrita a administradores. ' +
  'NENHUM dado foi consultado. Diga isso com naturalidade, em uma ou duas frases, e que quem precisa dessa informação deve pedir a um administrador. ' +
  'Não dê número, não faça diagnóstico, não explique o que cada indicador significa e não escreva linha de Fonte.';

// ─── Quem pode ───────────────────────────────────────────────────────────────

/**
 * A regra da rota /api/admin/infra-saude: usuarios.is_admin ou is_super_adm.
 * Falha na leitura NUNCA vira acesso.
 */
export async function ehAdministradorDoPainel(supabase: SupabaseClient, userId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('usuarios')
      .select('is_admin, is_super_adm')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return false;
    const linha = data as Record<string, unknown>;
    return linha.is_admin === true || linha.is_super_adm === true;
  } catch (err) {
    console.error('[MaestroInfra] Falha ao conferir se o usuario e administrador:', err);
    return false;
  }
}

// ─── De onde vem a leitura ───────────────────────────────────────────────────

export type LeitorDaSaude = () => Promise<InfraSaude>;

let leitorDeTeste: LeitorDaSaude | null = null;

/** SÓ PARA TESTE: troca a leitura do painel por uma falsa. `null` volta à leitura real. */
export function definirLeitorDaSaudeDaInfra(novo: LeitorDaSaude | null): void {
  leitorDeTeste = novo;
}

/** A MESMA função e o MESMO cache que a rota do painel usa (dashboard/infra-saude.server.ts). */
const lerDoPainel: LeitorDaSaude = () => (leitorDeTeste ?? lerSaudeDaInfraDoAmbiente)();

// ─── Datas em Brasília ───────────────────────────────────────────────────────

function partesEmBrasilia(data: Date) {
  const f = new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const p = Object.fromEntries(f.formatToParts(data).map(x => [x.type, x.value]));
  return { dia: p.day, mes: p.month, ano: p.year, hora: p.hour === '24' ? '00' : p.hour, minuto: p.minute };
}

export function dataHoraBrasilia(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = partesEmBrasilia(d);
  return `${p.dia}/${p.mes}/${p.ano} às ${p.hora}:${p.minuto}`;
}

export function horaBrasilia(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = partesEmBrasilia(d);
  return `${p.hora}:${p.minuto}`;
}

function mesPorExtenso(data: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, month: 'long', year: 'numeric' }).format(data);
}

function decimal(n: number, casas = 1): string {
  return n.toFixed(casas).replace('.', ',');
}

// ─── Previsão de espaço ──────────────────────────────────────────────────────

export interface PastaQueCresce {
  pasta: string;
  aberta: boolean;
  novos_em_30_dias: string;
  parte_do_crescimento: string;
  tamanho_atual: string;
}

export interface PrevisaoDeEspaco {
  situacao: 'projetado' | 'sem_crescimento' | 'limite_atingido' | 'sem_leitura';
  usado: string | null;
  limite_do_plano: string | null;
  livre: string | null;
  ritmo_dos_ultimos_30_dias: string | null;
  /** Meses (de 30 dias) até os 100 GB acabarem no ritmo atual; null quando não dá para projetar. */
  meses_ate_encher: number | null;
  previsao_do_mes: string | null;
  meses_ate_o_amarelo: string | null;
  meses_ate_o_vermelho: string | null;
  /** A frase pronta, para o modelo copiar. */
  leitura: string;
  ressalvas: string[];
  pastas_que_mais_crescem: PastaQueCresce[];
}

const RESSALVAS_DO_ESPACO = [
  'Projeção simples: assume que o ritmo dos últimos 30 dias continua igual. Se o ritmo mudar, a data muda.',
  'O ritmo é a soma dos arquivos criados nos últimos 30 dias, sem descontar o que foi apagado.',
  'Os 100 GB do plano valem para a conta toda e aqui só entram os arquivos deste sistema: se algo mais da conta ocupar espaço, acaba antes.',
];

function acharMetrica(saude: InfraSaude, chave: string): MetricaSaude | undefined {
  return saude.metricas.find(m => m.chave === chave);
}

/**
 * Em quantos meses os 100 GB acabam pelo ritmo dos últimos 30 dias, e quais
 * pastas mais crescem. Tudo calculado aqui, a partir dos MESMOS números do
 * painel (cartões "Arquivos guardados" e "Arquivos novos em 30 dias" e a tabela
 * "Onde estão os arquivos").
 */
export function projetarEspaco(saude: InfraSaude, agora: Date = new Date()): PrevisaoDeEspaco {
  const guardados = acharMetrica(saude, 'storage');
  const novos = acharMetrica(saude, 'storage30d');
  const usadoBytes = guardados?.valor ?? null;
  const limiteBytes = guardados?.limite ?? null;
  const ritmoBytes = novos?.valor ?? null;

  const vazio = (situacao: PrevisaoDeEspaco['situacao'], leitura: string): PrevisaoDeEspaco => ({
    situacao,
    usado: usadoBytes !== null ? formatarBytes(usadoBytes) : null,
    limite_do_plano: limiteBytes !== null ? formatarBytes(limiteBytes) : null,
    livre: usadoBytes !== null && limiteBytes !== null ? formatarBytes(Math.max(0, limiteBytes - usadoBytes)) : null,
    ritmo_dos_ultimos_30_dias: ritmoBytes !== null ? formatarBytes(ritmoBytes) : null,
    meses_ate_encher: null,
    previsao_do_mes: null,
    meses_ate_o_amarelo: null,
    meses_ate_o_vermelho: null,
    leitura,
    ressalvas: RESSALVAS_DO_ESPACO,
    pastas_que_mais_crescem: pastasQueCrescem(saude),
  });

  if (usadoBytes === null || limiteBytes === null || ritmoBytes === null || !Number.isFinite(usadoBytes + limiteBytes + ritmoBytes)) {
    return vazio('sem_leitura', 'Não foi possível ler o espaço dos arquivos agora, então não dá para projetar.');
  }

  const livreBytes = limiteBytes - usadoBytes;
  if (livreBytes <= 0) {
    return vazio('limite_atingido', `Os arquivos já ocupam ${formatarBytes(usadoBytes)}, no limite de ${formatarBytes(limiteBytes)} do plano.`);
  }
  if (ritmoBytes <= 0) {
    return vazio(
      'sem_crescimento',
      `Os arquivos ocupam ${formatarBytes(usadoBytes)} dos ${formatarBytes(limiteBytes)} do plano e não cresceram nos últimos 30 dias, então não dá para projetar quando acabam.`,
    );
  }

  const meses = livreBytes / ritmoBytes;
  const dataFim = new Date(agora.getTime() + meses * DIAS_DO_RITMO * 24 * 3600 * 1000);
  const ate = (alvo: number | undefined): string | null => {
    if (alvo === undefined) return null;
    if (usadoBytes >= alvo) return 'já passou';
    return `${decimal((alvo - usadoBytes) / ritmoBytes)} meses`;
  };
  const mesesTexto = decimal(meses);
  const leitura =
    `No ritmo dos últimos 30 dias (${formatarBytes(ritmoBytes)} por mês), os ${formatarBytes(limiteBytes)} do plano acabam em cerca de ${mesesTexto} meses, ` +
    `por volta de ${mesPorExtenso(dataFim)}. Hoje há ${formatarBytes(usadoBytes)} usados e ${formatarBytes(livreBytes)} livres.`;

  return {
    situacao: 'projetado',
    usado: formatarBytes(usadoBytes),
    limite_do_plano: formatarBytes(limiteBytes),
    livre: formatarBytes(livreBytes),
    ritmo_dos_ultimos_30_dias: formatarBytes(ritmoBytes),
    meses_ate_encher: Number(meses.toFixed(1)),
    previsao_do_mes: mesPorExtenso(dataFim),
    meses_ate_o_amarelo: ate(guardados?.amarelo),
    meses_ate_o_vermelho: ate(guardados?.vermelho),
    leitura,
    ressalvas: RESSALVAS_DO_ESPACO,
    pastas_que_mais_crescem: pastasQueCrescem(saude),
  };
}

/** As pastas com arquivos novos nos últimos 30 dias, da que mais cresce para a que menos. */
function pastasQueCrescem(saude: InfraSaude): PastaQueCresce[] {
  const comCrescimento = saude.buckets.filter(b => b.bytes30d > 0).sort((a, b) => b.bytes30d - a.bytes30d);
  const total = comCrescimento.reduce((t, b) => t + b.bytes30d, 0);
  return comCrescimento.slice(0, MAX_PASTAS_QUE_CRESCEM).map(b => ({
    pasta: b.bucket,
    aberta: b.publico,
    novos_em_30_dias: formatarBytes(b.bytes30d),
    parte_do_crescimento: `${Math.round((100 * b.bytes30d) / total)}%`,
    tamanho_atual: formatarBytes(b.bytes),
  }));
}

// ─── A resposta da ferramenta ────────────────────────────────────────────────

const ORDEM_DA_GRAVIDADE: NivelSaude[] = ['critico', 'atencao', 'ok'];

function cartao(m: MetricaSaude): Record<string, unknown> {
  // Como no painel: o "de <limite>" só aparece quando a unidade não é percentual nem taxa.
  const mostraLimite = m.unidade !== 'pct' && m.unidade !== 'taxa';
  const detalhe = m.detalhe?.trim() || null;
  return {
    id: m.chave,
    titulo: m.titulo,
    situacao: ROTULO_DO_NIVEL[m.nivel],
    valor: formatarValorSaude(m.valor, m.unidade),
    ...(mostraLimite ? { limite: m.limite !== null ? `de ${formatarValorSaude(m.limite, m.unidade)}` : 'sem limite fixo' } : {}),
    faixas: descreverFaixas(m),
    explicacao_do_painel: m.explicacao,
    ...(detalhe ? { detalhe_do_painel: detalhe } : {}),
  };
}

export const COMO_RESPONDER_SAUDE =
  'Explique em linguagem simples, como para quem não é da área, e comece pelo panorama em uma frase (quantos cartões estão em cada cor). ' +
  'Use SOMENTE os números e os textos deste retorno: não calcule, não arredonde, não troque de unidade e não invente causa. Cite o horário da leitura (lido_em). ' +
  'Para cada cartão em "Atenção" ou "Agir agora": diga o nome, o valor, a faixa, o que significa (explicacao_do_painel) e O QUE FAZER. ' +
  `O "o que fazer" está na ficha do manual "${FICHA_DA_SAUDE}": chame consultar_manual com essa página NO MESMO turno e use só o que ela diz. ` +
  'Em "como está o banco?" NÃO liste um por um os cartões em "Tudo certo": diga em uma frase quantos estão certos e detalhe só os que não estão. Pergunta sobre um cartão específico → só esse. ' +
  'Cartão "Sem leitura": diga que não foi possível ler agora e não suponha valor. ' +
  'Pergunta sobre UM cartão ("por que a memória de emergência está vermelha?") → explique só esse, com valor, faixa, explicação, detalhe (se houver) e o que fazer. ' +
  'Pergunta sobre ESPAÇO ("quanto espaço ainda temos", "quando acabam os 100 GB") → use o bloco "espaco": copie a frase "leitura", cite as "ressalvas" em uma linha e liste as pastas que mais crescem. ' +
  'Se avisos_do_painel não estiver vazio, diga que parte da leitura falhou e repita o aviso. Você só mostra a leitura e orienta: quem age é o administrador. ' +
  'Quem recebe esta leitura já é administrador: NÃO escreva frase sobre permissão do usuário, NÃO mande recarregar a página (a leitura vale até relida_depois_das) e NÃO termine com oferta ou despedida.';

export function montarRespostaDaSaude(saude: InfraSaude, agora: Date = new Date()): Record<string, unknown> {
  const porNivel = (nivel: NivelSaude) => saude.metricas.filter(m => m.nivel === nivel);
  const piorNivel = ORDEM_DA_GRAVIDADE.find(n => porNivel(n).length > 0) ?? 'indisponivel';

  return {
    found: true,
    fonte: 'Painel "Saúde da infraestrutura" (Dashboard > seção para administradores): mesma leitura e mesmos limites',
    lido_em: dataHoraBrasilia(saude.geradoEm),
    relida_depois_das: horaBrasilia(saude.validoAte),
    panorama: {
      situacao_geral: ROTULO_DO_NIVEL[piorNivel],
      cartoes: saude.metricas.length,
      agir_agora: porNivel('critico').map(m => m.titulo),
      atencao: porNivel('atencao').map(m => m.titulo),
      sem_leitura: porNivel('indisponivel').map(m => m.titulo),
      tudo_certo: porNivel('ok').length,
    },
    avisos_do_painel: saude.avisos,
    cartoes: saude.metricas.map(cartao),
    espaco: projetarEspaco(saude, agora),
    onde_estao_os_arquivos: saude.buckets.slice(0, MAX_PASTAS_NA_RESPOSTA).map(b => ({
      pasta: b.bucket,
      aberta: b.publico,
      arquivos: b.arquivos.toLocaleString('pt-BR'),
      tamanho: formatarBytes(b.bytes),
      novos_em_30_dias: formatarBytes(b.bytes30d),
    })),
    historico_de_alteracoes_por_mes: saude.historicoMeses.map(m => ({
      mes: `${m.mes.slice(5)}/${m.mes.slice(2, 4)}`,
      tamanho: formatarBytes(m.bytes),
    })),
    ficha_do_manual: FICHA_DA_SAUDE,
    como_responder: COMO_RESPONDER_SAUDE,
  };
}

/** Handler da ferramenta consultar_saude_infra. A conferência de administrador já foi feita pelo executor. */
export async function consultarSaudeDaInfra(): Promise<Record<string, unknown>> {
  try {
    return montarRespostaDaSaude(await lerDoPainel());
  } catch (err) {
    console.error('[MaestroInfra] Falha ao ler a saude da infraestrutura:', err);
    return {
      found: false,
      motivo: 'LEITURA_FALHOU',
      orientacao:
        'Não foi possível ler a saúde da infraestrutura agora. Diga isso e sugira tentar de novo em um minuto ou olhar a seção no Dashboard. Não suponha números.',
    };
  }
}
