/**
 * A nota já foi autorizada na SEFAZ? Pergunte ao PAYLOAD, não às colunas.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 *   Todas as travas de duplicidade do sistema olham `numero_nf` e `chave_nfe`.
 *   E essas são exatamente as colunas que ficam VAZIAS quando o retorno da Focus
 *   é lido errado — o desfecho vem dentro de `protocolo_nota_fiscal`, ninguém
 *   desce um nível, e a nota congela sem número e sem chave.
 *
 *   A trava fica cega justamente no caso em que precisa enxergar: nota
 *   AUTORIZADA na SEFAZ que o ERP julga nunca emitida. Reenviar dali transmite
 *   de novo e produz uma SEGUNDA NF-e do mesmo documento. Em produção isso é
 *   número queimado, e número queimado não volta.
 *
 *   O payload, porém, GUARDA a verdade. Mesmo quando as colunas ficaram nulas,
 *   ele traz protocolo, chave e número. É nele que esta função olha.
 *
 * TRÊS REGRAS, E A TERCEIRA É DELIBERADAMENTE MAIS EXIGENTE
 *   R1  `status` = "autorizado" no primeiro nível.
 *   R2  `chave_nfe` presente no primeiro nível. Chave só existe depois que a
 *       SEFAZ autorizou; a Focus não a inventa antes.
 *   R3  `protocolo_nota_fiscal.status` = "100" E `numero_protocolo` E
 *       `chave_nfe` presentes — os TRÊS, não só o código.
 *
 *   R3 exige três porque é a regra que lê o segundo nível, onde o envelope
 *   ainda diz "processando_autorizacao". Ali o risco de afirmar cedo demais é
 *   real, e um "100" solto não é prova suficiente: protocolo e chave só
 *   aparecem quando a SEFAZ já respondeu.
 *
 * ISTO É UMA RECUSA, NUNCA UMA AFIRMAÇÃO DE ESTADO
 *   A função não grava nada, não promove nota a AUTORIZADA e não corrige
 *   coluna nenhuma. Ela só responde "não transmita isto de novo". Reconciliar
 *   as colunas de quem ficou para trás é outro assunto, com outra autorização.
 *
 * NOTA CANCELADA TAMBÉM É BARRADA, e está certo: cancelada é nota que foi
 *   autorizada e depois baixada. Reenviar a mesma `ref` duplicaria na SEFAZ.
 *   Quem precisa emitir de novo cria nota nova, não ressuscita a antiga.
 *
 * O QUE ELA NÃO ALCANÇA — e isto precisa estar escrito
 *   Nota cujo `payload_retorno` foi SOBRESCRITO por um retorno de erro. A
 *   NFE-20370-002 é o caso: foi autorizada como NF 1002 em 22/08, e em 11/09
 *   uma consulta que falhou trocou o payload por `{codigo, mensagem}`. A prova
 *   sumiu, e nenhuma leitura do payload pode recuperá-la. Esta trava protege as
 *   notas seguintes; a 20370-002 continua reenviável.
 */

/** O que foi encontrado no payload, para a mensagem que o operador lê. */
export type EvidenciaAutorizacao = {
  /** Qual regra disparou — entra na mensagem e nos testes. */
  regra: "STATUS_NIVEL_1" | "CHAVE_NIVEL_1" | "PROTOCOLO_NIVEL_2";
  numero: string | null;
  serie: string | null;
  chave: string | null;
  protocolo: string | null;
};

export type DeteccaoAutorizacao =
  | { jaAutorizada: true; evidencia: EvidenciaAutorizacao }
  | { jaAutorizada: false };

type Bruto = Record<string, unknown>;

/** Objeto, primeiro item de array, ou JSON em string. Qualquer outra coisa: null. */
function comoObjeto(valor: unknown): Bruto | null {
  if (!valor) return null;
  if (Array.isArray(valor)) return comoObjeto(valor[0]);
  if (typeof valor === "string") {
    try {
      return comoObjeto(JSON.parse(valor));
    } catch {
      return null;
    }
  }
  if (typeof valor === "object") return valor as Bruto;
  return null;
}

/** Texto aparado, ou null. Número vira texto — a Focus mistura os dois. */
function texto(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return String(valor);
  if (typeof valor !== "string") return null;
  const limpo = valor.trim();
  return limpo === "" ? null : limpo;
}

/**
 * Lê o payload de retorno e diz se aquela nota já foi autorizada na SEFAZ.
 *
 * Função pura: sem I/O, sem relógio, sem banco. Recebe o `payload_retorno` como
 * ele sai da coluna e devolve a resposta com a evidência que a sustenta.
 */
export function detectarNotaJaAutorizada(payloadRetorno: unknown): DeteccaoAutorizacao {
  const raiz = comoObjeto(payloadRetorno);
  if (!raiz) return { jaAutorizada: false };

  const protocoloNf = comoObjeto(raiz.protocolo_nota_fiscal) ?? {};
  const requisicao = comoObjeto(raiz.requisicao_nota_fiscal) ?? {};

  // A chave chega às vezes com o prefixo "NFe" e às vezes sem. Para efeito de
  // prova de existência isso não importa — e normalizar aqui seria inventar
  // formato. Guarda-se como veio.
  const chave = texto(raiz.chave_nfe) ?? texto(protocoloNf.chave_nfe) ?? texto(requisicao.chave_nfe);
  const protocolo = texto(raiz.protocolo) ?? texto(protocoloNf.numero_protocolo);
  const numero = texto(raiz.numero) ?? texto(requisicao.numero);
  const serie = texto(raiz.serie) ?? texto(requisicao.serie);

  const achado = (regra: EvidenciaAutorizacao["regra"]): DeteccaoAutorizacao => ({
    jaAutorizada: true,
    evidencia: { regra, numero, serie, chave, protocolo }
  });

  // R1 — o envelope já se declara autorizado.
  if (texto(raiz.status)?.toLowerCase() === "autorizado") return achado("STATUS_NIVEL_1");

  // R2 — chave no primeiro nível. Só existe depois da autorização.
  if (texto(raiz.chave_nfe)) return achado("CHAVE_NIVEL_1");

  // R3 — o desfecho escondido no segundo nível. Exige os TRÊS.
  if (
    texto(protocoloNf.status) === "100" &&
    texto(protocoloNf.numero_protocolo) &&
    texto(protocoloNf.chave_nfe)
  ) {
    return achado("PROTOCOLO_NIVEL_2");
  }

  return { jaAutorizada: false };
}

/**
 * A mensagem que o operador lê. Diz O QUE FOI ENCONTRADO, não só "bloqueado".
 *
 * Um "não permitido" genérico faz o operador tentar de novo por outro caminho.
 * Número, chave e protocolo na tela fazem ele conferir na SEFAZ — que é
 * exatamente o gesto certo.
 */
export function mensagemNotaJaAutorizada(evidencia: EvidenciaAutorizacao): string {
  const achados = [
    evidencia.numero ? `número ${evidencia.numero}` : null,
    evidencia.serie ? `série ${evidencia.serie}` : null,
    evidencia.chave ? `chave ${evidencia.chave}` : null,
    evidencia.protocolo ? `protocolo ${evidencia.protocolo}` : null
  ].filter(Boolean);

  const lista = achados.length > 0 ? achados.join(", ") : "sem número nem chave legíveis";

  const ondeEstava =
    evidencia.regra === "PROTOCOLO_NIVEL_2"
      ? "O desfecho estava dentro de `protocolo_nota_fiscal`, por isso as colunas da nota ficaram vazias. "
      : "";

  return (
    `Esta nota JÁ PARECE AUTORIZADA na SEFAZ, embora o cadastro esteja sem número e sem chave. ` +
    `O retorno da Focus guardado nela traz: ${lista}. ` +
    ondeEstava +
    `Transmitir de novo criaria uma SEGUNDA NF-e para o mesmo documento. ` +
    `Confira na SEFAZ ou no painel da Focus antes de qualquer coisa; se a nota realmente existe, ` +
    `o caso é reconciliar o cadastro, não emitir.`
  );
}
