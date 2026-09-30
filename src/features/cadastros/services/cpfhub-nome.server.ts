/**
 * Conferencia do nome de um CPF pela CPFHub — so o sinal, nunca o nome.
 *
 * Existe para o cadastro online (/c/<token>): a pessoa informa CPF e nome, e o
 * servidor pergunta a CPFHub se o nome bate. O que sai daqui e `true`, `false`
 * ou `null`; o nome que a API devolve morre nesta funcao. A pagina publica nao
 * recebe nada disto, e a fila grava so o sinal.
 *
 * POR QUE SO O SINAL
 *   A pagina e publica: qualquer um com o link chega ate ela. Se ela
 *   preenchesse ou confirmasse o nome, viraria um consultor de nome por CPF de
 *   graca. Comparar e devolver "bate / nao bate" para o ATENDENTE, e nao para
 *   quem digitou, e o que impede isso.
 *
 * O QUE E "CONFERE"
 *   Depois de normalizar os dois lados (maiusculas, sem acento, sem pontuacao,
 *   espacos unicos):
 *     - iguais; ou
 *     - o digitado tem ao menos duas palavras, a primeira e a ultima sao as
 *       mesmas da CPFHub, e todas as palavras digitadas existem no nome da
 *       CPFHub, na mesma ordem.
 *   Cobre "Maria Silva" para "MARIA DE SOUZA SILVA" e recusa nome de outra
 *   pessoa. Nao cobre apelido nem nome social — o atendente decide.
 *
 * CUSTO
 *   `api.cpfhub.io`, token em CPFHUB_TOKEN (o mesmo das rotas internas). Plano
 *   gratis: 50 consultas/mes. CPF nao encontrado nao consome credito. A
 *   chamada so acontece depois do honeypot, do rate limit, do token, do
 *   digito verificador e da duplicidade — como a Receita no CNPJ.
 */

export type ConferenciaNome = boolean | null;

const CPFHUB_TIMEOUT_MS = 6000;

export function normalizarNome(valor: string): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compara o nome digitado com o da CPFHub. Puro, sem rede: testavel. */
export function nomeConfere(digitado: string, daApi: string): boolean {
  const a = normalizarNome(digitado);
  const b = normalizarNome(daApi);
  if (!a || !b) return false;
  if (a === b) return true;

  const pa = a.split(" ");
  const pb = b.split(" ");
  if (pa.length < 2) return false;
  if (pa[0] !== pb[0] || pa[pa.length - 1] !== pb[pb.length - 1]) return false;

  // Todas as palavras digitadas, na ordem, dentro do nome da API.
  let i = 0;
  for (const palavra of pb) {
    if (i < pa.length && palavra === pa[i]) i += 1;
  }
  return i === pa.length;
}

function segredo(): string | null {
  const valor = process.env.CPFHUB_API_TOKEN ?? process.env.CPFHUB_TOKEN ?? process.env.CPFHUB_API_KEY;
  return valor && valor.trim() ? valor.trim() : null;
}

/**
 * Consulta a CPFHub e devolve so se o nome confere. `null` quando nao da para
 * afirmar: token ausente, API fora, 429, CPF nao encontrado, resposta sem nome.
 * Nunca lanca — falha aqui nao pode impedir o envio.
 */
export async function conferirNomeNaCpfHub(cpfDigitos: string, nomeDigitado: string): Promise<ConferenciaNome> {
  const token = segredo();
  if (!token) {
    console.warn("[cpfhub-nome] CPFHUB_TOKEN ausente; conferencia pulada.");
    return null;
  }
  if (!/^\d{11}$/.test(cpfDigitos) || !normalizarNome(nomeDigitado)) return null;

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), CPFHUB_TIMEOUT_MS);
  try {
    const resposta = await fetch(`https://api.cpfhub.io/cpf/${cpfDigitos}`, {
      method: "GET",
      headers: { "x-api-key": token },
      signal: controlador.signal,
      cache: "no-store"
    });
    if (!resposta.ok) {
      if (resposta.status !== 404) {
        console.warn(`[cpfhub-nome] CPFHub respondeu ${resposta.status}; conferencia pulada.`);
      }
      return null;
    }
    const corpo = (await resposta.json().catch(() => null)) as
      | { data?: { nameUpper?: string; name?: string; nome?: string } }
      | null;
    const nomeApi = String(corpo?.data?.nameUpper ?? corpo?.data?.name ?? corpo?.data?.nome ?? "").trim();
    if (!nomeApi) return null;
    return nomeConfere(nomeDigitado, nomeApi);
  } catch {
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}
