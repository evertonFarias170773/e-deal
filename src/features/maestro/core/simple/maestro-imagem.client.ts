'use client';

/**
 * maestro-imagem.client.ts
 *
 * Redução do print NO NAVEGADOR, antes de enviar.
 *
 * Por que no navegador: o corpo da requisição da função da Vercel tem limite de
 * 4,5 MB, e um print de monitor em PNG passa de 1 MB com facilidade (em base64,
 * +33%). Reduzir aqui é o que mantém o corpo pequeno sem tocar em configuração
 * de deploy.
 *
 * O teto é duplo: lado máximo em pixel (legibilidade do texto da tela) e teto
 * de bytes (tamanho do corpo). A qualidade cai em degraus até caber; se nem no
 * degrau mais baixo couber, a imagem é reduzida de novo em pixel.
 *
 * O arquivo original NUNCA é enviado: o que sai daqui é sempre o reduzido.
 * Nada é gravado, em nenhum lugar — a imagem existe só na memória da aba.
 *
 * ⚠️ Só roda no navegador (usa canvas e FileReader).
 */

import {
  MAX_BYTES_IMAGEM,
  MAX_LADO_IMAGEM_PX,
  MIMES_DE_IMAGEM_ACEITOS,
  bytesDoBase64,
  type ImagemDoTurno,
} from './maestro-imagem';

export interface ImagemPreparada {
  imagem: ImagemDoTurno;
  /** `data:` URL para a miniatura no input (mesma imagem já reduzida). */
  preview: string;
  largura: number;
  altura: number;
}

/** Degraus de qualidade tentados, do melhor para o pior. */
const QUALIDADES = [0.92, 0.85, 0.75, 0.62, 0.5];

/** Lados tentados quando nem a pior qualidade cabe no teto de bytes. */
const LADOS = [MAX_LADO_IMAGEM_PX, 1280, 1024];

/** O arquivo escolhido é de um tipo que sabemos tratar? */
export function tipoDeImagemAceito(tipo: string): boolean {
  return (MIMES_DE_IMAGEM_ACEITOS as readonly string[]).includes((tipo || '').toLowerCase());
}

async function bitmapDoArquivo(arquivo: Blob): Promise<{ bitmap: ImageBitmap | HTMLImageElement; largura: number; altura: number }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(arquivo);
    return { bitmap, largura: bitmap.width, altura: bitmap.height };
  }
  // Navegador sem createImageBitmap: caminho do <img> com object URL.
  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, falhou) => {
      const el = new Image();
      el.onload = () => ok(el);
      el.onerror = () => falhou(new Error('Não foi possível ler a imagem.'));
      el.src = url;
    });
    return { bitmap: img, largura: img.naturalWidth, altura: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function desenhar(
  bitmap: ImageBitmap | HTMLImageElement,
  largura: number,
  altura: number,
  ladoMaximo: number
): { canvas: HTMLCanvasElement; largura: number; altura: number } {
  const escala = Math.min(1, ladoMaximo / Math.max(largura, altura));
  const w = Math.max(1, Math.round(largura * escala));
  const h = Math.max(1, Math.round(altura * escala));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível preparar a imagem neste navegador.');
  // Fundo branco: print em PNG com transparência ficaria preto em JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, w, h);
  return { canvas, largura: w, altura: h };
}

function codificar(canvas: HTMLCanvasElement, tipo: string, qualidade: number): Promise<Blob | null> {
  return new Promise(ok => canvas.toBlob(blob => ok(blob), tipo, qualidade));
}

function base64DoBlob(blob: Blob): Promise<string> {
  return new Promise((ok, falhou) => {
    const leitor = new FileReader();
    leitor.onload = () => {
      const texto = String(leitor.result ?? '');
      const virgula = texto.indexOf(',');
      ok(virgula >= 0 ? texto.slice(virgula + 1) : '');
    };
    leitor.onerror = () => falhou(new Error('Não foi possível ler a imagem.'));
    leitor.readAsDataURL(blob);
  });
}

/**
 * Prepara o print para envio: reduz, codifica e devolve o base64 e a miniatura.
 *
 * Erro aqui é mensagem para o usuário (arquivo que não é imagem, navegador sem
 * canvas) — nunca uma exceção solta na tela do chat.
 */
export async function prepararImagemParaEnvio(arquivo: Blob): Promise<ImagemPreparada> {
  const { bitmap, largura, altura } = await bitmapDoArquivo(arquivo);
  try {
    for (const lado of LADOS) {
      const desenho = desenhar(bitmap, largura, altura, lado);
      for (const qualidade of QUALIDADES) {
        // WebP primeiro (menor para print com texto); navegador que não
        // codifica WebP devolve outro tipo — aí vale o JPEG.
        let blob = await codificar(desenho.canvas, 'image/webp', qualidade);
        if (!blob || blob.type !== 'image/webp') {
          blob = await codificar(desenho.canvas, 'image/jpeg', qualidade);
        }
        if (!blob) continue;
        const base64 = await base64DoBlob(blob);
        if (!base64) continue;
        if (bytesDoBase64(base64) <= MAX_BYTES_IMAGEM) {
          const mime = blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
          return {
            imagem: { mime, base64 },
            preview: `data:${mime};base64,${base64}`,
            largura: desenho.largura,
            altura: desenho.altura,
          };
        }
      }
    }
  } finally {
    if (typeof ImageBitmap !== 'undefined' && bitmap instanceof ImageBitmap) bitmap.close();
  }
  throw new Error(
    `Não consegui deixar a imagem abaixo de ${Math.round(MAX_BYTES_IMAGEM / 1000)} KB. Recorte a área da tela que interessa e tente de novo.`
  );
}

/** Primeira imagem de um evento de colar (Ctrl+V), se houver. */
export function imagemDaAreaDeTransferencia(itens: DataTransferItemList | null): File | null {
  if (!itens) return null;
  for (let i = 0; i < itens.length; i++) {
    const item = itens[i];
    if (item.kind !== 'file') continue;
    const arquivo = item.getAsFile();
    if (arquivo && arquivo.type.startsWith('image/')) return arquivo;
  }
  return null;
}
