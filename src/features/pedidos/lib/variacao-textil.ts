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
 * PVC (21/10/2026): as linhas de Acabamento (ex.: "Brilho") e Furacao (ex.: "Ovoide")
 * tambem saem em 10 pt, mas com o rotulo INTEIRO, como ja aparecem ("Acabamento:
 * Brilho", "Furação: Ovóide"). Grupo no catalogo: "Furação". Os outros grupos do PVC
 * (ex.: "Tecnologia", "Impressão") ficam em 6 pt.
 *
 * Sem imports de proposito: roda no PDF e no teste do Node, igual.
 */

const ACABAMENTO = /^\s*acabamentos?\s*:\s*/i;
const ACESSORIO = /^\s*acess[oó]rios?\s*:\s*/i;
// Furação, Furacao, Furações, Furacoes.
const FURACAO = /^\s*fura[cç](?:[aã]o|[oõ]es)\s*:/i;

export type LinhaDeVariacaoDoCard = { texto: string; destaque: boolean };

export function linhaDeVariacaoNoCard(linha: string, setor: string | null | undefined): LinhaDeVariacaoDoCard {
  const setorNormalizado = String(setor ?? "").trim().toUpperCase();
  if (setorNormalizado === "PVC" && (ACABAMENTO.test(linha) || FURACAO.test(linha))) {
    return { texto: linha, destaque: true };
  }
  const ehTextil = setorNormalizado === "TEXTIL";
  if (ehTextil) {
    if (ACABAMENTO.test(linha)) return { texto: `Acb: ${linha.replace(ACABAMENTO, "").trim()}`, destaque: true };
    if (ACESSORIO.test(linha)) return { texto: `Ace: ${linha.replace(ACESSORIO, "").trim()}`, destaque: true };
  }
  return { texto: linha, destaque: false };
}
