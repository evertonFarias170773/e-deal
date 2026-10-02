/**
 * Os SERVIÇOS de uma transportadora, para o vendedor escolher na aba Fretes.
 *
 * POR QUE ESTE ARQUIVO EXISTE (02/10/2026)
 *   A cotação automática da Azul pede sempre o serviço ECOMM
 *   (`frete.service.ts`, `SiglaServico: "ECOMM"`) e grava esse código em
 *   `cotacao_frete.servico`. Relido do banco, o código vira o NOME do frete: o
 *   cartão aparece como "MANUAL / TRANSP. — ECOMM", `propostas.frete_escolhido`
 *   fica "ECOMM", e a lista de Pedidos e a Expedição repetem. Só que a SVT
 *   (loja parceira da Azul) vende mais de um serviço — na proposta 23027 o
 *   contratado era o AZUL PREMIUM —, e não havia onde dizer isso.
 *
 * "ECOMM" GRAVADO É O AZUL ECOMM DA LISTA (decisão do dono, 02/10/2026)
 *   A lista da SVT chama o serviço de AZUL ECOMM, mas a cotação automática
 *   continua gravando o código cru "ECOMM", e há propostas antigas com ele.
 *   `SINONIMOS` diz que os dois são o mesmo serviço: a proposta gravada com
 *   "ECOMM" abre com AZUL ECOMM selecionado, e nada é regravado por causa
 *   disso — o texto do banco só muda se alguém escolher outro serviço.
 *
 * NÃO HAVIA CADASTRO DE SERVIÇO
 *   Nenhuma tabela guarda os serviços de uma transportadora: `clientes` tem só
 *   o cadastro dela e `transportadoras` é a tabela de tarifa por cidade. A
 *   lista mora AQUI, num lugar só, pelo mesmo motivo de
 *   `transportadoras-parceiras.ts`: espalhar faria cada tela ter a sua.
 *
 * COMO ELA É USADA
 *   Transportadora com MAIS DE UM serviço ganha uma lista ao lado do drop, no
 *   quadro do valor cobrado em CIF. Escolher um serviço põe o frete nesse
 *   serviço: o cartão que já existe com ele (a cotação automática, para o
 *   AZUL ECOMM), ou um frete manual com o nome do serviço. Quem não escolhe
 *   nada fica exatamente como sempre foi.
 *
 * A REGRA QUE TODO SERVIÇO DAQUI PRECISA CUMPRIR
 *   O nome do serviço é o que vai para `cotacao_frete.servico` e para
 *   `propostas.frete_escolhido`, e é por esse texto que o resto do sistema
 *   reconhece o transporte: `resolverTransportadoraParceira` (vínculo e NF-e),
 *   `categoriaDoServico` (painel da Expedição), `normalizarTipoFrete` e, no
 *   banco, `exp__tipo_frete_do_texto` (trava de frete do despacho). Por isso o
 *   nome de um serviço da Azul tem de conter AZUL ou ECOMM. O teste
 *   `servicos-transportadora.test.mts` cobra isso de cada linha da lista.
 *
 * O QUE ELA NÃO FAZ
 *   Não cota, não muda valor e não toca nas cotações automáticas: o valor do
 *   frete manual é o "Valor cobrado" que o vendedor digita.
 */
import { TRANSPORTADORAS_PARCEIRAS } from "./transportadoras-parceiras";

/**
 * Serviços por cadastro de transportadora (`clientes.id_cliente`).
 *
 * A ordem é a da tela. Só entra aqui serviço que o dono confirmou; não se
 * inventa nome.
 */
const SERVICOS_POR_TRANSPORTADORA: Readonly<Record<number, readonly string[]>> = {
  /** SVT TRANSPORTES, loja parceira da Azul Cargo (lista do dono, 02/10/2026). */
  [TRANSPORTADORAS_PARCEIRAS.AZUL]: ["AZUL ECOMM", "AZUL STANDARD", "AZUL EXPRESSO", "AZUL PREMIUM"]
};

/**
 * Textos que já estão gravados e SÃO um serviço da lista com outro nome.
 * Chave e valor já normalizados (maiúsculas, sem acento).
 */
const SINONIMOS: Readonly<Record<number, Readonly<Record<string, string>>>> = {
  /** O código que a cotação automática da Azul devolve e grava. */
  [TRANSPORTADORAS_PARCEIRAS.AZUL]: { ECOMM: "AZUL ECOMM" }
};

/** Sem acento, maiúsculas, espaços colapsados — a mesma redução dos vizinhos. */
function normalizar(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Os serviços cadastrados para a transportadora; vazio quando não há lista. */
export function servicosDaTransportadora(idTransportadora: number | null | undefined): readonly string[] {
  if (idTransportadora === null || idTransportadora === undefined) return [];
  return SERVICOS_POR_TRANSPORTADORA[Number(idTransportadora)] ?? [];
}

/** A lista só aparece quando há o que escolher: mais de um serviço. */
export function transportadoraTemEscolhaDeServico(idTransportadora: number | null | undefined): boolean {
  return servicosDaTransportadora(idTransportadora).length > 1;
}

/**
 * Qual serviço da lista o frete escolhido é — ou `null` quando não é nenhum
 * (frete manual com o nome do cadastro, texto antigo digitado à mão).
 *
 * Compara o `servico` INTEIRO, nunca por pedaço, depois de trocar o sinônimo
 * pelo nome da lista ("ECOMM" → "AZUL ECOMM"). Texto parecido não conta: dizer
 * que "AZUL ECOM" ou "AEREO EXPRESSO" é um serviço da lista faria a tela
 * afirmar uma escolha que ninguém fez.
 */
export function servicoDoFrete(
  idTransportadora: number | null | undefined,
  frete: { servico?: string | null } | null | undefined
): string | null {
  if (!frete || idTransportadora === null || idTransportadora === undefined) return null;
  const gravado = normalizar(frete.servico);
  if (!gravado) return null;
  const alvo = SINONIMOS[Number(idTransportadora)]?.[gravado] ?? gravado;
  return servicosDaTransportadora(idTransportadora).find((s) => normalizar(s) === alvo) ?? null;
}

/**
 * O frete é deste serviço da transportadora? Mesma leitura de `servicoDoFrete`,
 * sinônimo incluído: o cartão "ECOMM" da cotação automática É o AZUL ECOMM.
 */
export function freteEhDoServico(
  idTransportadora: number | null | undefined,
  frete: { servico?: string | null } | null | undefined,
  servico: string
): boolean {
  const doFrete = servicoDoFrete(idTransportadora, frete);
  return doFrete !== null && normalizar(doFrete) === normalizar(servico);
}
