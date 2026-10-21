/**
 * ACABAMENTO E ACESSORIO NO BOLETIM DO TEXTIL (21/10/2026).
 *
 * No card do modelo, as variacoes escolhidas na venda saem uma por linha,
 * "GRUPO: opcao", em 6 pt. No TEXTIL (cordao) duas delas sao o que a bancada mais
 * precisa ler — o acabamento (ex.: "Mosquete Metal Ponta Dupla") e o acessorio
 * (ex.: "Chapinha Metalica") —, entao so essas duas, so nesse setor, saem com
 * rotulo abreviado ("Acb:" e "Ace:") e em 10 pt (ver `modeloVariacaoTextil` no PDF).
 * O resto do card, as outras variacoes e os outros setores ficam como estavam.
 *
 * Grupos no catalogo (`variacoes.nome`, medido em 21/10/2026): "Acabamento" e
 * "Acessórios". Aceita singular/plural e sem acento.
 *
 * Sem imports de proposito: roda no PDF e no teste do Node, igual.
 */

const ACABAMENTO = /^\s*acabamentos?\s*:\s*/i;
const ACESSORIO = /^\s*acess[oó]rios?\s*:\s*/i;

export type LinhaDeVariacaoDoCard = { texto: string; destaque: boolean };

export function linhaDeVariacaoNoCard(linha: string, setor: string | null | undefined): LinhaDeVariacaoDoCard {
  const ehTextil = String(setor ?? "").trim().toUpperCase() === "TEXTIL";
  if (ehTextil) {
    if (ACABAMENTO.test(linha)) return { texto: `Acb: ${linha.replace(ACABAMENTO, "").trim()}`, destaque: true };
    if (ACESSORIO.test(linha)) return { texto: `Ace: ${linha.replace(ACESSORIO, "").trim()}`, destaque: true };
  }
  return { texto: linha, destaque: false };
}
