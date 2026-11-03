/**
 * maestro-imagem.ts
 *
 * Contrato da imagem de um turno do Maestro (print de tela que o usuário cola
 * ou anexa no chat). Funções puras — sem banco, sem modelo, sem API de
 * navegador: este arquivo é importado pelo servidor (rota e loop) E pelo
 * cliente (input do chat).
 *
 * REGRAS QUE ESTE MÓDULO GARANTE
 *   - uma imagem por turno, só PNG, JPEG ou WebP;
 *   - o tipo declarado tem de bater com os primeiros bytes do arquivo
 *     (assinatura), senão um .exe renomeado passaria pela validação;
 *   - teto de bytes, conferido no servidor pelo tamanho real do base64;
 *   - a imagem vive SÓ no contexto da conversa: nada aqui grava, sobe para
 *     bucket ou registra log com o conteúdo dela.
 *
 * O QUE ESTE MÓDULO NÃO FAZ, DE PROPÓSITO
 *   - não extrai texto da imagem e não devolve nada que alimente
 *     `fontesDoTurno` no loop. A trava do nome de botão continua comparando a
 *     resposta só com a pergunta, o índice e as páginas lidas do manual: um
 *     print não pode legitimar botão que não existe no manual.
 */

/** Imagem de um turno, no formato que trafega no corpo da requisição. */
export interface ImagemDoTurno {
  /** `image/png`, `image/jpeg` ou `image/webp`. */
  mime: string;
  /** Conteúdo do arquivo em base64 puro (sem o prefixo `data:`). */
  base64: string;
}

/** Tipos aceitos. Qualquer outro é recusado na rota. */
export const MIMES_DE_IMAGEM_ACEITOS = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * Teto de bytes do arquivo já reduzido (900 KB).
 *
 * Em base64 isto vira ~1,2 MB no corpo da requisição — bem abaixo do limite de
 * 4,5 MB da função da Vercel, com folga para o texto da pergunta e para o
 * histórico reenviado (até 2 turnos com imagem).
 */
export const MAX_BYTES_IMAGEM = 900_000;

/**
 * Maior lado da imagem depois da redução no navegador (px).
 *
 * 1600 px mantém legível o texto de um print de tela cheia em monitor comum —
 * é o que o modelo precisa ler para dizer o que é a tela.
 */
export const MAX_LADO_IMAGEM_PX = 1600;

/**
 * Quantos turnos do histórico podem carregar imagem (os mais recentes).
 *
 * A imagem é reenviada pelo navegador a cada pergunta: sem este teto, uma
 * conversa longa multiplicaria bytes e tokens por turno.
 */
export const MAX_TURNOS_COM_IMAGEM = 2;

/** Assinatura dos primeiros bytes de cada tipo aceito. */
const ASSINATURAS: Record<string, readonly number[][]> = {
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  // WebP: "RIFF" .... "WEBP" — os 4 bytes do meio são o tamanho e variam.
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
};

const ALFABETO_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decodifica os primeiros `quantos` bytes de um base64, em JavaScript puro.
 * Sem `Buffer` (não existe no navegador) e sem `atob` (não existe no Node
 * antigo): o módulo tem de rodar nos dois lados.
 */
function primeirosBytes(base64: string, quantos: number): number[] {
  const bytes: number[] = [];
  let acumulador = 0;
  let bits = 0;
  for (const caractere of base64) {
    const valor = ALFABETO_B64.indexOf(caractere);
    if (valor < 0) continue;
    acumulador = (acumulador << 6) | valor;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acumulador >> bits) & 0xff);
      if (bytes.length >= quantos) break;
    }
  }
  return bytes;
}

/** Tamanho real do arquivo (bytes) a partir do comprimento do base64. */
export function bytesDoBase64(base64: string): number {
  const limpo = base64.replace(/=+$/, '');
  return Math.floor((limpo.length * 3) / 4);
}

/** O conteúdo começa com a assinatura do tipo que ele diz ter? */
function assinaturaConfere(mime: string, base64: string): boolean {
  const esperadas = ASSINATURAS[mime];
  if (!esperadas) return false;
  const maior = Math.max(...esperadas.map(a => a.length));
  const lidos = primeirosBytes(base64, maior);
  const bate = esperadas.some(a => a.every((b, i) => lidos[i] === b));
  if (!bate) return false;
  // WebP: além do "RIFF" inicial, os bytes 8..11 têm de ser "WEBP".
  if (mime === 'image/webp') {
    const doze = primeirosBytes(base64, 12);
    return doze[8] === 0x57 && doze[9] === 0x45 && doze[10] === 0x42 && doze[11] === 0x50;
  }
  return true;
}

/** Motivo pelo qual a imagem foi recusada — texto que a rota devolve ao usuário. */
export type RecusaDeImagem =
  | 'formato'
  | 'tipo_nao_aceito'
  | 'assinatura'
  | 'tamanho';

export const MOTIVO_DA_RECUSA: Record<RecusaDeImagem, string> = {
  formato: 'A imagem não chegou em formato válido. Anexe ou cole o print novamente.',
  tipo_nao_aceito: 'A imagem precisa ser PNG, JPEG ou WebP.',
  assinatura: 'O arquivo não parece ser uma imagem PNG, JPEG ou WebP. Anexe ou cole o print novamente.',
  tamanho: `A imagem passou de ${Math.round(MAX_BYTES_IMAGEM / 1000)} KB depois da redução. Recorte a área da tela que interessa e tente de novo.`,
};

export interface ResultadoDaValidacao {
  imagem?: ImagemDoTurno;
  recusa?: RecusaDeImagem;
}

/**
 * Valida a imagem recebida do navegador. NUNCA confiar no cliente: tipo,
 * assinatura e tamanho são conferidos aqui, no servidor.
 *
 * Ausência de imagem (null/undefined) não é erro: devolve `{}`, e o turno segue
 * exatamente como sempre foi.
 */
export function validarImagemDoTurno(bruta: unknown): ResultadoDaValidacao {
  if (bruta == null) return {};
  if (typeof bruta !== 'object') return { recusa: 'formato' };

  const mime = String((bruta as { mime?: unknown }).mime ?? '').trim().toLowerCase();
  const base64 = String((bruta as { base64?: unknown }).base64 ?? '').trim();
  if (!mime || !base64) return { recusa: 'formato' };
  // Base64 puro: o prefixo `data:` fica fora do contrato (o cliente o remove).
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { recusa: 'formato' };

  if (!(MIMES_DE_IMAGEM_ACEITOS as readonly string[]).includes(mime)) return { recusa: 'tipo_nao_aceito' };
  if (bytesDoBase64(base64) > MAX_BYTES_IMAGEM) return { recusa: 'tamanho' };
  if (!assinaturaConfere(mime, base64)) return { recusa: 'assinatura' };

  return { imagem: { mime, base64 } };
}

/** `data:` URL da imagem — formato que a API do modelo recebe em `image_url`. */
export function dataUrlDaImagem(imagem: ImagemDoTurno): string {
  return `data:${imagem.mime};base64,${imagem.base64}`;
}

/**
 * `content` do turno do usuário quando há imagem: array de partes (texto +
 * imagem), como a API de chat espera.
 *
 * `detail: 'high'` é deliberado: a pergunta é sobre o que está ESCRITO na tela
 * (nome de botão, aviso, número do pedido). Em `low` o modelo recebe uma
 * miniatura e não lê o texto do print.
 *
 * Sem imagem ninguém chama esta função — o `content` continua sendo a string
 * de hoje, byte a byte.
 */
export function conteudoComImagem(texto: string, imagem: ImagemDoTurno): unknown[] {
  return [
    { type: 'text', text: texto },
    { type: 'image_url', image_url: { url: dataUrlDaImagem(imagem), detail: 'high' } },
  ];
}

/**
 * Resumo da imagem para log e auditoria: tipo e tamanho, NUNCA o conteúdo.
 * Print de tela carrega CPF, valor e nome de cliente — isso não vai para log.
 */
export function resumoDaImagem(imagem: ImagemDoTurno): string {
  return `${imagem.mime} ${Math.round(bytesDoBase64(imagem.base64) / 1000)}KB`;
}
