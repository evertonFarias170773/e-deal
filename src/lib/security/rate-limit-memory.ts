/**
 * Rate limit in-memory simples por chave (janela fixa), POR INSTÂNCIA do Next.
 * Uso no fluxo QR: apenas anti-flood de tokens inexistentes nas rotas públicas —
 * o limite oficial por token é PERSISTENTE no banco (os_qr_tokens, via RPC).
 */

type Janela = { inicio: number; contagem: number };

const janelas = new Map<string, Janela>();
const MAX_CHAVES = 10_000;

export function rateLimitCheck(chave: string, limite: number, janelaMs: number): boolean {
  const agora = Date.now();
  const atual = janelas.get(chave);

  if (!atual || agora - atual.inicio > janelaMs) {
    if (janelas.size >= MAX_CHAVES) {
      // Proteção de memória: descarta janelas expiradas; se nada expirou, reseta tudo.
      for (const [k, v] of janelas) {
        if (agora - v.inicio > janelaMs) janelas.delete(k);
      }
      if (janelas.size >= MAX_CHAVES) janelas.clear();
    }
    janelas.set(chave, { inicio: agora, contagem: 1 });
    return true;
  }

  atual.contagem += 1;
  return atual.contagem <= limite;
}
