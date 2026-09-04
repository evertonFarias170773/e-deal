import { formatPhoneBR } from "@/lib/formatters/phone";

/**
 * TELEFONE DO DESTINATARIO — o primeiro candidato que E um telefone (04/09/2026).
 *
 * O PROBLEMA
 *   A regra era `whatsapp_1 || telefone_fixo`: pega o primeiro campo
 *   PREENCHIDO, sem olhar o conteudo. So que `clientes.whatsapp_1` guarda
 *   lixo em escala — 4.144 cadastros tem o campo sem NENHUM digito (nomes de
 *   pessoa, razoes sociais, "NULL", espaco em branco), medido em 04/09/2026. O
 *   cadastro 248, pagador do pedido 21000, tem o proprio nome ali, e a etiqueta
 *   10x15 saiu com "Fone: FELIPE FAUTH PROBST" enquanto `telefone_fixo` tinha o
 *   numero certo.
 *
 * A REGRA
 *   Percorre os candidatos NA ORDEM (whatsapp antes do fixo, como sempre) e
 *   devolve o primeiro com pelo menos 8 digitos, ja formatado. Nenhum serve →
 *   vazio, e a linha "Fone:" nao e impressa: melhor sem telefone do que com um
 *   nome no lugar dele.
 *
 *   8 digitos e o piso de um fixo sem DDD. Um nome com numero de casa dentro
 *   ("43.937.312 MANUELA...") tem 8 e passa — e caso raro (1 na amostra) e o
 *   formatador devolve o texto cru, legivel. A alternativa, exigir 10 ou 11,
 *   apagaria os 331 cadastros com DDI 55 na frente (12 e 13 digitos), que sao
 *   telefones de verdade.
 *
 * UMA FUNCAO, TRES CONSUMIDORES: a etiqueta 10x15, o box de conferencia do
 * modal Despachar (que le o mesmo view model) e a prepostagem dos Correios.
 * Os tres precisam concordar sobre qual e "o telefone".
 *
 * O TELEFONE VEM SEMPRE DO CADASTRO (04/09/2026). Houve um campo editavel por
 * remessa, gravado em `expedicoes.telefone_etiqueta`; ele saiu por decisao do
 * dono, e a coluna ficou no banco sem leitura nem escrita.
 */
const MINIMO_DIGITOS_TELEFONE = 8;

export function telefoneDestinatario(...candidatos: Array<string | null | undefined>): string {
  for (const candidato of candidatos) {
    if (pareceTelefone(candidato)) return formatPhoneBR(candidato);
  }
  return "";
}

/**
 * O texto tem digitos suficientes para ser telefone?
 *
 * Privada desde 04/09/2026: era exportada para o campo de telefone editavel do
 * modal recusar valor invalido antes de gravar, e esse campo saiu junto com
 * `expedicoes.telefone_etiqueta` — a coluna continua no banco, sem leitura nem
 * escrita. O criterio segue aqui porque e ELE que define a regra acima.
 */
function pareceTelefone(bruto: string | null | undefined): boolean {
  return String(bruto ?? "").replace(/\D/g, "").length >= MINIMO_DIGITOS_TELEFONE;
}
