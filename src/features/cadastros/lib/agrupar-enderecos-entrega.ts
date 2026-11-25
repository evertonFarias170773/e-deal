/**
 * ENDERECOS DE ENTREGA IGUAIS, AGRUPADOS NA TELA DO CADASTRO (25/11/2026).
 *
 * O CASO: cadastro 12460. Ate o commit e276b6ef, o portal do link do cliente
 * (`link_cliente_salvar_entrega`) gravava um endereco ENTREGA novo a cada
 * pedido, mesmo identico, com a obs tecnica "portal-entrega-pedido:<id_int>".
 * A origem foi corrigida; as linhas antigas ficam no banco (decisao do dono:
 * nao apagar). Esta regra so muda a TELA: as iguais viram um cartao so.
 *
 * O CRITERIO e o mesmo da funcao do portal: tipo ENTREGA e todos os campos de
 * endereco e recebedor iguais (recebedor, documento, CEP, logradouro, numero,
 * complemento, bairro, cidade e UF), com complemento vazio igual a ausente.
 * Obs, IE e datas nao contam. A comparacao e exata, como no banco.
 *
 * NADA aqui grava, nem muda como o pedido escolhe o endereco: o pedido segue
 * apontando para a linha dele (`propostas.id_endereco_ent`), e a edicao segue
 * por linha.
 */
import type { CadastroEndereco } from "@/features/cadastros/types";

/** Uma linha que aparece sozinha, ou um grupo de linhas iguais (2 ou mais). */
export type ItemDaListaDeEnderecos =
  | { tipo: "linha"; id: string }
  | { tipo: "grupo"; chave: string; ids: string[] };

const OBS_TECNICA_DO_PORTAL = /^portal-entrega-pedido:/i;

/** A obs "portal-entrega-pedido:..." e marca tecnica do portal, nao recado para a equipe. */
export function ehObsTecnicaDoPortal(obs: string | null | undefined): boolean {
  return OBS_TECNICA_DO_PORTAL.test((obs || "").trim());
}

function ehEntrega(endereco: Pick<CadastroEndereco, "tipo">): boolean {
  return (endereco.tipo || "").trim().toLowerCase() === "entrega";
}

/** A chave do grupo. So endereco ENTREGA tem chave; os outros tipos nunca agrupam. */
export function chaveDoEnderecoDeEntrega(endereco: CadastroEndereco): string | null {
  if (!ehEntrega(endereco)) return null;
  return JSON.stringify([
    endereco.recebedor ?? "",
    endereco.cpfRecebedor ?? "",
    endereco.cep ?? "",
    endereco.endereco ?? "",
    endereco.numero ?? "",
    endereco.complemento ?? "",
    endereco.bairro ?? "",
    endereco.cidade ?? "",
    endereco.uf ?? ""
  ]);
}

/**
 * Monta a lista da tela na ordem de hoje: cada grupo ocupa o lugar da sua
 * primeira linha. Endereco sem par aparece como sempre apareceu.
 */
export function agruparEnderecosDeEntrega(enderecos: CadastroEndereco[]): ItemDaListaDeEnderecos[] {
  const idsPorChave = new Map<string, string[]>();
  for (const endereco of enderecos) {
    const chave = chaveDoEnderecoDeEntrega(endereco);
    if (!chave) continue;
    const ids = idsPorChave.get(chave);
    if (ids) ids.push(endereco.id);
    else idsPorChave.set(chave, [endereco.id]);
  }

  const itens: ItemDaListaDeEnderecos[] = [];
  const chavesJaListadas = new Set<string>();
  for (const endereco of enderecos) {
    const chave = chaveDoEnderecoDeEntrega(endereco);
    const ids = chave ? idsPorChave.get(chave) : undefined;
    if (!chave || !ids || ids.length < 2) {
      itens.push({ tipo: "linha", id: endereco.id });
      continue;
    }
    if (chavesJaListadas.has(chave)) continue;
    chavesJaListadas.add(chave);
    itens.push({ tipo: "grupo", chave, ids: [...ids] });
  }
  return itens;
}

/** Os pedidos de um grupo, sem repeticao e em ordem crescente. */
export function pedidosDoGrupo(ids: string[], pedidosPorEndereco: Record<string, number[]>): number[] {
  const todos = new Set<number>();
  for (const id of ids) for (const pedido of pedidosPorEndereco[id] ?? []) todos.add(pedido);
  return [...todos].sort((a, b) => a - b);
}

/** "usado em 1 pedido", "usado em 3 pedidos", "sem pedido". */
export function textoUsadoEmPedidos(quantidade: number): string {
  if (quantidade === 0) return "sem pedido";
  return quantidade === 1 ? "usado em 1 pedido" : `usado em ${quantidade} pedidos`;
}
