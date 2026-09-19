/**
 * A nota de SERVIÇO já saiu? Pergunte ao PAYLOAD, não às colunas.
 *
 * O IRMÃO DESTE ARQUIVO
 *   `ja-autorizada.ts` faz o mesmo para a NF-e, e a razão de existir é a mesma:
 *   toda trava de duplicidade olha as colunas, e são justamente elas que ficam
 *   VAZIAS quando o retorno da integração é lido errado. A trava fica cega no
 *   caso em que precisa enxergar — documento já emitido que o ERP julga nunca
 *   enviado —, e reenviar dali produz um SEGUNDO documento do mesmo serviço.
 *
 * POR QUE NÃO REUSAR O DA NF-e
 *   Porque o vocabulário é outro. A NFS-e não tem chave de 44 dígitos nem
 *   protocolo da SEFAZ; as três regras de lá procuram `chave_nfe` e
 *   `protocolo_nota_fiscal.status = "100"`, que aqui nunca aparecem. O que a
 *   Focus devolve — e as quatro notas de maio com retorno guardado confirmam —
 *   é isto, tudo no primeiro nível:
 *
 *     status: "autorizado" | numero | codigo_verificacao
 *     numero_rps | serie_rps | url_danfse | caminho_xml_nota_fiscal
 *
 * DUAS REGRAS
 *   R1  `status` = "autorizado" ou "cancelado". `cancelado` barra de propósito:
 *       cancelada é nota que foi autorizada e depois baixada na prefeitura, e
 *       reenviar a mesma `ref` duplicaria o documento. Quem precisa emitir de
 *       novo cria nota nova, não ressuscita a antiga.
 *   R2  `numero` ou `codigo_verificacao` presentes. A prefeitura só devolve os
 *       dois depois de gerar a NFS-e; a Focus não os inventa antes.
 *
 * ISTO É UMA RECUSA, NUNCA UMA AFIRMAÇÃO DE ESTADO
 *   A função não grava nada, não promove nota a AUTORIZADA e não corrige coluna
 *   nenhuma. Ela só responde "não transmita isto de novo".
 *
 * O QUE ELA NÃO ALCANÇA
 *   Nota cujo `payload_retorno` foi SOBRESCRITO por um retorno de erro — o
 *   mesmo limite do lado da NF-e, onde a NFE-20370-002 perdeu a prova quando
 *   uma consulta que falhou trocou o payload. Nenhuma leitura recupera o que o
 *   banco não guarda mais.
 */

/** O que foi encontrado no payload, para a mensagem que o operador lê. */
export type EvidenciaNfseEmitida = {
  /** Qual regra disparou — entra na mensagem e nos testes. */
  regra: "STATUS_FOCUS" | "NUMERO_NO_PAYLOAD";
  numero: string | null;
  codigoVerificacao: string | null;
};

export function detectarNfseJaEmitida(payloadRetorno: unknown): EvidenciaNfseEmitida | null {
  if (!payloadRetorno || typeof payloadRetorno !== "object" || Array.isArray(payloadRetorno)) {
    return null;
  }

  const raiz = payloadRetorno as Record<string, unknown>;
  const texto = (valor: unknown): string | null => {
    const limpo = String(valor ?? "").trim();
    return limpo && limpo.toLowerCase() !== "null" ? limpo : null;
  };

  const numero = texto(raiz.numero);
  const codigoVerificacao = texto(raiz.codigo_verificacao);
  const status = (texto(raiz.status) ?? "").toLowerCase();

  if (status === "autorizado" || status === "cancelado") {
    return { regra: "STATUS_FOCUS", numero, codigoVerificacao };
  }
  if (numero || codigoVerificacao) {
    return { regra: "NUMERO_NO_PAYLOAD", numero, codigoVerificacao };
  }
  return null;
}

/** A mensagem que o operador lê quando o payload barra o reenvio. */
export function mensagemNfseJaEmitida(evidencia: EvidenciaNfseEmitida): string {
  const partes: string[] = [];
  if (evidencia.numero) partes.push(`número ${evidencia.numero}`);
  if (evidencia.codigoVerificacao) {
    partes.push(`código de verificação ${evidencia.codigoVerificacao}`);
  }
  const detalhe = partes.length ? ` (${partes.join(", ")})` : "";
  const origem =
    evidencia.regra === "STATUS_FOCUS"
      ? "o retorno guardado da Focus diz que ela já foi processada pela prefeitura"
      : "o retorno guardado da Focus já traz número da NFS-e";
  return (
    `Esta NFS-e não pode ser enviada de novo: ${origem}${detalhe}. ` +
    `Use "Consultar status" para trazer o desfecho, ou emita uma nota nova.`
  );
}
