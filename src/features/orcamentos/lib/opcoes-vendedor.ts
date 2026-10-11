/**
 * Opções do filtro "Vendedor" da lista de Pedidos (11/10/2026).
 *
 * ANTES: os nomes das linhas carregadas (no máximo 100, a página 1). Faltava
 * quem não tinha pedido naquela página, e as opções mudavam com status, filtro e
 * página. AGORA: os usuários com `is_vendedor = true` (`usuarios.nome_usuario`),
 * em ordem alfabética, sempre os mesmos.
 *
 * O texto que o filtro compara com `propostas.vendedor` é o `nome_usuario`: é o
 * valor que o formulário da proposta grava ao escolher o vendedor.
 *
 * REGRAS
 *   - Escopo restrito (o usuário só vê o que é dele): só o próprio nome, como já
 *     era. Nada do cadastro é mostrado a ele.
 *   - O valor já escolhido (link antigo com `?vend=...`) continua como opção,
 *     mesmo fora do cadastro, para o select não quebrar.
 *   - Se a leitura do cadastro falhar, valem os nomes das linhas carregadas (o
 *     comportamento de antes) em vez de um filtro vazio. Enquanto a leitura não
 *     termina, só o valor escolhido (se houver).
 */
export const VENDEDOR_TODOS = "TODOS";

export function montarOpcoesDeVendedor(entrada: {
  /** `usuarios.nome_usuario` de quem tem `is_vendedor`; `null` enquanto não chegou. */
  nomesDoCadastro: string[] | null;
  /** Só usados se a leitura do cadastro falhou. */
  nomesDasLinhas: string[];
  leituraFalhou: boolean;
  escopoRestrito: boolean;
  meuNome: string;
  /** Valor do filtro; "TODOS" quando nenhum vendedor foi escolhido. */
  selecionado: string;
}): string[] {
  const { nomesDoCadastro, nomesDasLinhas, leituraFalhou, escopoRestrito, selecionado } = entrada;
  const meuNome = entrada.meuNome.trim();

  let nomes: string[];
  if (escopoRestrito && meuNome) {
    nomes = [meuNome];
  } else if (nomesDoCadastro) {
    nomes = nomesDoCadastro;
  } else if (leituraFalhou) {
    nomes = nomesDasLinhas;
  } else {
    nomes = [];
  }

  if (selecionado && selecionado !== VENDEDOR_TODOS) nomes = [...nomes, selecionado];

  const limpos = nomes.map((nome) => String(nome ?? "").trim()).filter(Boolean);
  return Array.from(new Set(limpos)).sort((a, b) => a.localeCompare(b, "pt-BR"));
}
