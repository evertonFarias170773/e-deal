/**
 * maestro-agent-manual.server.ts
 *
 * Leitura do manual de uso do Vibe (docs/manual/) pelo Maestro.
 *
 * O manual e escrito e mantido FORA daqui: uma pagina por tela ou fluxo, no
 * formato de docs/manual/_MODELO.md, atualizada no mesmo commit de cada mudanca
 * visivel (regra no AGENTS.md). Este modulo so LE:
 *
 *   - `indiceDoManual()`  → uma linha por pagina (titulo, onde fica, assuntos).
 *     Entra no system prompt para o modelo escolher a pagina certa.
 *   - `lerPaginasDoManual()` → o texto inteiro das paginas escolhidas, devolvido
 *     pela tool `consultar_manual`.
 *
 * O indice sai dos ARQUIVOS que existem, nunca do README: pagina listada la e
 * ainda nao escrita nao aparece, e pagina nova aparece sozinha.
 *
 * Em producao (Vercel) os .md so chegam a funcao porque next.config.ts os
 * declara em `outputFileTracingIncludes` para a rota /api/maestro/simple. Sem a
 * pasta, o indice fica vazio e o Maestro diz que nao tem o passo a passo — nunca
 * inventa.
 *
 * ⚠️ Roda apenas no servidor.
 */

import fs from 'fs';
import path from 'path';

export interface PaginaDoManual {
  /** Nome do arquivo sem .md — e o identificador que a tool recebe */
  slug: string;
  titulo: string;
  ondeFica: string | null;
  ultimaRevisao: string | null;
  paraQueServe: string | null;
  /** Titulos "###" da pagina: as tarefas e regras que ela cobre */
  assuntos: string[];
  /** Outras páginas do manual que esta cita por link: por onde o fluxo continua */
  ligadas: string[];
  /**
   * A página traz a linha `> **Acesso:** somente administradores`. Quem não é
   * administrador recebe só um aviso no lugar do conteúdo (ver `lerPaginasDoManual`).
   */
  somenteAdministradores: boolean;
  conteudo: string;
}

/** O que o Maestro devolve no lugar de uma página restrita a quem não é administrador. */
export const TEXTO_DE_PAGINA_RESTRITA =
  'Esta página do manual é restrita a administradores e NÃO foi liberada para quem está perguntando. ' +
  'Diga apenas que é informação restrita a administradores e que deve pedir a um administrador. ' +
  'Não descreva o conteúdo, não dê números e não explique o assunto de memória.';

const TTL_MS = 30_000;
// A maior página hoje tem ~42 mil caracteres (notas-fiscais). O corte é só um teto de segurança.
const MAX_CHARS_POR_PAGINA = 60_000;
/** Assuntos por página no índice do prompt (o índice inteiro vai em TODO turno). */
const MAX_ASSUNTOS_NO_INDICE = 14;
export const MAX_PAGINAS_POR_CONSULTA = 3;

let cache: { em: number; paginas: PaginaDoManual[] } | null = null;

function pastaDoManual(): string | null {
  const candidatas = [
    path.join(process.cwd(), 'docs', 'manual'),
    path.join(process.cwd(), '..', 'docs', 'manual'),
  ];
  for (const pasta of candidatas) {
    try {
      if (fs.statSync(pasta).isDirectory()) return pasta;
    } catch {
      // tenta a proxima
    }
  }
  return null;
}

/** Tira a marcacao de negrito, link e codigo — para as linhas curtas do indice. */
function semMarcacao(texto: string): string {
  return texto
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A seção "Arquivos de origem" lista os arquivos de código de onde a página
 * saiu. Serve a quem mantém o manual (scripts/checar-manual.mjs), não a quem
 * usa o sistema: fica fora do que o modelo lê.
 */
function semArquivosDeOrigem(texto: string): string {
  const linhas = texto.split('\n');
  const inicio = linhas.findIndex(l => /^##\s+Arquivos de origem\s*$/i.test(l));
  if (inicio < 0) return texto;
  let fim = linhas.findIndex((l, i) => i > inicio && /^##\s/.test(l));
  if (fim < 0) fim = linhas.length;
  return [...linhas.slice(0, inicio), ...linhas.slice(fim)].join('\n');
}

/** Extrai os campos do formato de docs/manual/_MODELO.md. Tolerante: o que faltar fica null. */
export function interpretarPagina(slug: string, bruto: string): PaginaDoManual {
  const conteudo = semArquivosDeOrigem(bruto.replace(/\r\n/g, '\n')).trim();
  const linhas = conteudo.split('\n');

  const titulo = semMarcacao((linhas.find(l => l.startsWith('# ')) ?? `# ${slug}`).slice(2));
  const campo = (rotulo: string): string | null => {
    const linha = linhas.find(l => l.startsWith('>') && l.includes(`**${rotulo}:**`));
    return linha ? semMarcacao(linha.slice(linha.indexOf(':**') + 3)) || null : null;
  };

  let paraQueServe: string | null = null;
  const iServe = linhas.findIndex(l => /^##\s+Para que serve/i.test(l));
  if (iServe >= 0) {
    const paragrafo: string[] = [];
    for (let i = iServe + 1; i < linhas.length; i++) {
      const l = linhas[i];
      if (l.startsWith('#')) break;
      if (l.trim() === '') {
        if (paragrafo.length > 0) break;
        continue;
      }
      paragrafo.push(l.trim());
    }
    paraQueServe = paragrafo.length > 0 ? semMarcacao(paragrafo.join(' ')).slice(0, 260) : null;
  }

  const assuntos = linhas
    .filter(l => l.startsWith('### '))
    .map(l => semMarcacao(l.slice(4)))
    .filter(Boolean);

  return {
    slug,
    titulo,
    // Formato atual: "Caminho no menu" + "Endereço". O antigo "Onde fica" ainda é aceito.
    ondeFica:
      [campo('Caminho no menu'), campo('Endereço') ? `endereço ${campo('Endereço')}` : null].filter(Boolean).join(', ') ||
      campo('Onde fica'),
    ultimaRevisao: campo('Última revisão'),
    paraQueServe,
    assuntos,
    ligadas: [...new Set([...conteudo.matchAll(/\]\(([a-z0-9-]+)\.md(?:#[^)]*)?\)/g)].map(m => m[1]))].filter(s => s !== slug),
    somenteAdministradores: /^somente administrador/.test(
      (campo('Acesso') ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
    ),
    conteudo,
  };
}

/** Todas as paginas publicadas do manual (cache curto: em dev as paginas mudam). */
export function carregarManual(): PaginaDoManual[] {
  if (cache && Date.now() - cache.em < TTL_MS) return cache.paginas;

  const paginas: PaginaDoManual[] = [];
  const pasta = pastaDoManual();
  if (pasta) {
    let arquivos: string[] = [];
    try {
      arquivos = fs.readdirSync(pasta);
    } catch {
      arquivos = [];
    }
    for (const arquivo of arquivos.sort()) {
      // README e o indice humano; arquivos com "_" na frente sao modelos.
      if (!arquivo.endsWith('.md') || arquivo.startsWith('_') || arquivo.toLowerCase() === 'readme.md') continue;
      try {
        const bruto = fs.readFileSync(path.join(pasta, arquivo), 'utf-8');
        if (bruto.trim().length < 40) continue;
        paginas.push(interpretarPagina(arquivo.slice(0, -3), bruto));
      } catch {
        // pagina ilegivel nao derruba as outras
      }
    }
  }

  cache = { em: Date.now(), paginas };
  return paginas;
}

/** Bloco do system prompt: o que o manual cobre. Vazio = o manual nao esta disponivel. */
export function indiceDoManual(): string {
  const paginas = carregarManual();
  if (paginas.length === 0) {
    return 'MANUAL DE USO DO VIBE — PÁGINAS DISPONÍVEIS: nenhuma. O manual não está disponível agora.';
  }
  const linhas = paginas.map(p => {
    const partes = [`- ${p.slug} — ${p.titulo}`];
    if (p.ondeFica) partes.push(`onde fica: ${p.ondeFica.length > 110 ? `${p.ondeFica.slice(0, 110)}…` : p.ondeFica}`);
    if (p.assuntos.length > 0) {
      const mostrados = p.assuntos.slice(0, MAX_ASSUNTOS_NO_INDICE);
      const resto = p.assuntos.length - mostrados.length;
      partes.push(`cobre: ${mostrados.join('; ')}${resto > 0 ? `; e mais ${resto}` : ''}`);
    }
    else if (p.paraQueServe) partes.push(`serve para: ${p.paraQueServe}`);
    const ligadas = p.ligadas.filter(s => paginas.some(o => o.slug === s));
    if (ligadas.length > 0) partes.push(`o fluxo continua em: ${ligadas.join(', ')}`);
    if (p.somenteAdministradores) partes.push('acesso: SÓ ADMINISTRADORES (quem não é administrador não recebe o conteúdo)');
    return partes.join(' | ');
  });
  return ['MANUAL DE USO DO VIBE — PÁGINAS DISPONÍVEIS (identificador — título | onde fica | o que cobre | páginas vizinhas do fluxo):', ...linhas].join('\n');
}

export interface LeituraDoManual {
  encontradas: Array<{
    pagina: string;
    titulo: string;
    onde_fica: string | null;
    ultima_revisao: string | null;
    conteudo: string;
    cortada: boolean;
    /** Página restrita a administradores lida por quem não é: o conteúdo NÃO veio. */
    restrita?: boolean;
  }>;
  nao_encontradas: string[];
  paginas_disponiveis: string[];
  /** Páginas do manual que as páginas lidas citam por link e que NÃO foram lidas nesta chamada */
  citadas_e_nao_lidas: string[];
}

function chave(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.md$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function acharPagina(paginas: readonly PaginaDoManual[], pedida: string): PaginaDoManual | undefined {
  const alvo = chave(pedida);
  return paginas.find(p => chave(p.slug) === alvo) ?? paginas.find(p => chave(p.titulo) === alvo);
}

/** Alguma das páginas pedidas é restrita a administradores? (decide se vale checar quem pergunta) */
export function pedeAlgumaPaginaRestrita(pedidas: readonly string[]): boolean {
  const paginas = carregarManual();
  return pedidas.slice(0, MAX_PAGINAS_POR_CONSULTA).some(p => acharPagina(paginas, p)?.somenteAdministradores === true);
}

/**
 * Le as paginas pedidas pelo identificador (aceita o titulo, com ou sem acento).
 * Página restrita a administradores só entrega o conteúdo com `podeVerRestritas`
 * (negado por padrão): sem ele, volta o aviso e `restrita: true`.
 */
export function lerPaginasDoManual(
  pedidas: readonly string[],
  opcoes: { podeVerRestritas?: boolean } = {},
): LeituraDoManual {
  const paginas = carregarManual();
  const encontradas: LeituraDoManual['encontradas'] = [];
  const naoEncontradas: string[] = [];

  for (const pedida of pedidas.slice(0, MAX_PAGINAS_POR_CONSULTA)) {
    const pagina = acharPagina(paginas, pedida);
    if (!pagina) {
      naoEncontradas.push(pedida);
      continue;
    }
    if (encontradas.some(e => e.pagina === pagina.slug)) continue;
    if (pagina.somenteAdministradores && opcoes.podeVerRestritas !== true) {
      encontradas.push({
        pagina: pagina.slug,
        titulo: pagina.titulo,
        onde_fica: null,
        ultima_revisao: null,
        conteudo: TEXTO_DE_PAGINA_RESTRITA,
        cortada: false,
        restrita: true,
      });
      continue;
    }
    const cortada = pagina.conteudo.length > MAX_CHARS_POR_PAGINA;
    encontradas.push({
      pagina: pagina.slug,
      titulo: pagina.titulo,
      onde_fica: pagina.ondeFica,
      ultima_revisao: pagina.ultimaRevisao,
      conteudo: cortada ? pagina.conteudo.slice(0, MAX_CHARS_POR_PAGINA) : pagina.conteudo,
      cortada,
    });
  }

  // Links "(outra-pagina.md)" dentro do que foi lido: e por onde o fluxo continua.
  const existentes = new Set(paginas.map(p => p.slug));
  const lidas = new Set(encontradas.map(e => e.pagina));
  const citadas = new Set<string>();
  for (const e of encontradas) {
    for (const m of e.conteudo.matchAll(/\]\(([a-z0-9-]+)\.md(?:#[^)]*)?\)/g)) {
      if (existentes.has(m[1]) && !lidas.has(m[1])) citadas.add(m[1]);
    }
  }

  return {
    encontradas,
    nao_encontradas: naoEncontradas,
    paginas_disponiveis: paginas.map(p => p.slug),
    citadas_e_nao_lidas: [...citadas],
  };
}

/** So para teste: descarta o cache em memoria. */
export function limparCacheDoManual(): void {
  cache = null;
}
