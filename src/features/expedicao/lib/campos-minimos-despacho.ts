import type { DespachoInput } from "../services/expedicao-acoes.service";

/**
 * O que precisa estar preenchido para DESPACHAR de fato.
 *
 * POR QUE EXISTE
 *   Até 20/08/2026 o botao "Confirmar despacho" so era desabilitado enquanto
 *   salvava, e `handleConfirmar` validava FORMATO, nunca PRESENCA: peso e
 *   volumes eram conferidos apenas "se informados", e transportadora, endereco
 *   e rastreio passavam em branco. A unica guarda de campo obrigatorio era a
 *   modalidade — e ela deixou de barrar qualquer coisa em 19/08/2026, quando
 *   CIF virou o padrao de toda proposta nova e passou a chegar pre-selecionada
 *   no modal. Resultado: clicar sem definir nada mandava o pedido para
 *   EM TRANSITO com `transportadora_nome`, `id_endereco_entrega`, `peso_kg` e
 *   `qtd_volumes` nulos.
 *
 *   O modal preenche quase tudo a partir do pedido e da cotacao, entao "sem
 *   alterar nada" produz um despacho de aparencia plausivel. Esta funcao existe
 *   para separar o que o sistema chutou do que alguem de fato confirmou.
 *
 * FUNCAO PURA, DOIS CONSUMIDORES
 *   A tela (para desabilitar o botao e dizer o que falta) e `despachar()` (para
 *   recusar antes de tocar o banco). Nao ha rota de API no caminho do despacho:
 *   e PostgREST direto do browser, e a RLS de `propostas` e permissiva. Ou seja,
 *   esta funcao E a validacao — por isso ela precisa rodar nos dois lados.
 */

export type ModoDespacho = "DESPACHO" | "EDICAO";

/**
 * Devolve a lista do que falta, em linguagem de tela. Vazia = pode despachar.
 *
 * `modo`:
 *   - `DESPACHO`: primeiro despacho, exige os campos minimos;
 *   - `EDICAO`: "Editar dados de expedicao" num pedido JA despachado. Nao
 *     herda a exigencia de proposito — o pedido ja saiu, e obrigar o campo
 *     agora impediria corrigir o que existe. Sempre devolve lista vazia.
 */
export function camposMinimosDespacho(
  input: Pick<
    DespachoInput,
    "tipoEntrega" | "modalidadeFrete" | "transportadoraNome" | "idTransportadoraCliente" | "qtdVolumes" | "idEnderecoEntrega"
  >,
  modo: ModoDespacho
): string[] {
  if (modo === "EDICAO") return [];

  const faltantes: string[] = [];

  // Vale para os dois tipos de entrega: sem saber quem paga, nao ha despacho.
  if (!input.modalidadeFrete) faltantes.push("a modalidade do frete");

  // Retirada no balcao nao tem transportadora nem endereco de entrega: o
  // cliente vem buscar. O submit ja forca RETIRA_BALCAO, "Retira balcao" e
  // id_transportadora_cliente null — exigir os campos aqui contradiria isso.
  if (input.tipoEntrega === "RETIRADA") return faltantes;

  const temTransportadora =
    Boolean(input.transportadoraNome && input.transportadoraNome.trim()) || input.idTransportadoraCliente !== null;
  if (!temTransportadora) faltantes.push("a transportadora");

  if (!input.idEnderecoEntrega) faltantes.push("o endereço de entrega");

  // O campo nasce com "1" na tela; o que se impede aqui e esvaziar. Peso e
  // rastreio seguem OPCIONAIS: o peso tem precedencia propria com fallback
  // teorico (lib/peso.ts), e o codigo dos Correios so existe depois da
  // prepostagem — exigi-lo impediria o despacho que o gera.
  if (input.qtdVolumes === null || !Number.isFinite(input.qtdVolumes) || input.qtdVolumes < 1) {
    faltantes.push("a quantidade de volumes");
  }

  return faltantes;
}

/** "a transportadora e o endereço de entrega" — para caber numa frase. */
export function frasearFaltantes(faltantes: string[]): string {
  if (faltantes.length === 0) return "";
  if (faltantes.length === 1) return faltantes[0];
  return `${faltantes.slice(0, -1).join(", ")} e ${faltantes[faltantes.length - 1]}`;
}
