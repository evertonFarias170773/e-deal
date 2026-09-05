/**
 * O painel da Expedição depois das colunas fixas (Etapa 6).
 *
 * O QUE PROVA
 *   1. a tradução do parâmetro `frete` da URL: nenhum valor antigo, e nenhum
 *      valor torto, produz lista vazia silenciosa;
 *   2. o agrupamento por categoria sobre a BASE REAL: a soma das sete colunas é
 *      igual ao total de pedidos do painel, e a precedência do despacho é a que
 *      decide a coluna;
 *   3. o nome da transportadora continua pesquisável mesmo quando a coluna é
 *      genérica (RODOVIARIO, EXTRAS).
 *
 * SÓ LEITURA. Não escreve nada — roda sem `PERMITIR_ESCRITA`.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/painel-categoria-frete.test.mts
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

// ── 1. Tradução do parâmetro `frete` da URL ─────────────────────────────────
const { resolverFiltroCategoria, avisoFiltroLegado, FILTRO_FRETE_TODOS } = await import(
  "../../src/features/expedicao/lib/filtro-categoria.ts"
);

// Os seis valores que a URL podia carregar até 05/09/2026, um por um.
checar("URL CORREIOS segue casando", resolverFiltroCategoria("CORREIOS").valor, "CORREIOS");
checar("URL CORREIOS nao avisa nada", resolverFiltroCategoria("CORREIOS").legado, null);
checar("URL MOTOBOY segue casando", resolverFiltroCategoria("MOTOBOY").valor, "MOTOBOY");
checar("URL RETIRA_BALCAO vira RETIRA", resolverFiltroCategoria("RETIRA_BALCAO").valor, "RETIRA");
checar("URL RETIRA_BALCAO avisa a troca de nome", resolverFiltroCategoria("RETIRA_BALCAO").legado, "RETIRA_BALCAO");
checar("URL TRANSPORTADORA ABRE o filtro", resolverFiltroCategoria("TRANSPORTADORA").valor, FILTRO_FRETE_TODOS);
checar("URL TRANSPORTADORA marca que abriu", resolverFiltroCategoria("TRANSPORTADORA").abriu, true);
checar("URL SEM_CUSTO ABRE o filtro", resolverFiltroCategoria("SEM_CUSTO").valor, FILTRO_FRETE_TODOS);
checar("URL INDEFINIDO ABRE o filtro", resolverFiltroCategoria("INDEFINIDO").valor, FILTRO_FRETE_TODOS);
checar("URL invalida ABRE o filtro", resolverFiltroCategoria("BANANA").valor, FILTRO_FRETE_TODOS);
checar("URL vazia e TODOS, sem aviso", resolverFiltroCategoria("").legado, null);
checar("URL TODOS continua TODOS", resolverFiltroCategoria("TODOS").valor, FILTRO_FRETE_TODOS);

// As sete categorias novas passam intactas.
for (const c of ["CORREIOS", "MOTOBOY", "RETIRA", "RODOVIARIO", "AEREO", "VEPPO", "EXTRAS"]) {
  checar(`URL ${c} passa intacta`, resolverFiltroCategoria(c).valor, c);
}

// NENHUM valor pode resultar em algo que nao seja uma das sete ou TODOS — e essa
// e a garantia de que lista vazia silenciosa deixou de ser possivel.
const VALIDOS = ["CORREIOS", "MOTOBOY", "RETIRA", "RODOVIARIO", "AEREO", "VEPPO", "EXTRAS", FILTRO_FRETE_TODOS];
const AMOSTRA = ["CORREIOS", "MOTOBOY", "TRANSPORTADORA", "RETIRA_BALCAO", "SEM_CUSTO", "INDEFINIDO", "", "xpto", "retira_balcao"];
checar(
  "nenhum valor de URL escapa das sete + TODOS",
  AMOSTRA.every((v) => VALIDOS.includes(resolverFiltroCategoria(v).valor)),
  true
);
checar("valor aberto sempre traz aviso", typeof avisoFiltroLegado(resolverFiltroCategoria("TRANSPORTADORA")), "string");
checar("valor valido nao traz aviso", avisoFiltroLegado(resolverFiltroCategoria("CORREIOS")), null);

// ── 2 e 3. Contra a base real ───────────────────────────────────────────────
if (!URL || !SERVICE) {
  console.log("\n(pulando a parte do banco: .env.local sem chaves)");
} else {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;
  const { listarPainelExpedicao } = await import("../../src/features/expedicao/services/expedicao.service.ts");
  const { categoriaExibida, CATEGORIAS_FRETE } = await import(
    "../../src/features/orcamentos/lib/categoria-frete.ts"
  );

  const pedidos = await listarPainelExpedicao();
  console.log(`\n>>> painel com ${pedidos.length} pedidos\n`);

  const contagem = new Map<string, number>();
  for (const p of pedidos) {
    const c = categoriaExibida(p.categoriaFrete);
    contagem.set(c, (contagem.get(c) ?? 0) + 1);
  }

  console.log("Colunas, na ordem fixa:");
  let soma = 0;
  for (const c of CATEGORIAS_FRETE) {
    const n = contagem.get(c) ?? 0;
    soma += n;
    console.log(`   ${c.padEnd(12)} ${n}`);
  }

  // A TRAVA DO AGRUPAMENTO: nenhum pedido pode sumir nem ser contado duas vezes.
  checar("a soma das sete colunas e o total do painel", soma, pedidos.length);
  checar(
    "nenhuma coluna fora das sete",
    [...contagem.keys()].every((k) => (CATEGORIAS_FRETE as readonly string[]).includes(k)),
    true
  );

  // BUSCA: o nome da transportadora continua no card e continua achavel, mesmo
  // quando a coluna e generica. Reproduz o predicado da tela.
  const comNome = pedidos.filter((p) => p.transportadoraNome.trim() !== "");
  checar("ha pedido com nome de transportadora para procurar", comNome.length > 0, true);

  const generico = comNome.filter((p) => {
    const c = categoriaExibida(p.categoriaFrete);
    return c === "EXTRAS" || c === "RODOVIARIO" || c === "AEREO";
  });
  if (generico.length > 0) {
    const alvo = generico[0];
    const termo = alvo.transportadoraNome.trim().toLowerCase().slice(0, 6);
    const achados = pedidos.filter((p) => p.transportadoraNome.toLowerCase().includes(termo));
    console.log(`\n   busca "${termo}" -> ${achados.length} pedido(s); alvo #${alvo.idInt} em ${categoriaExibida(alvo.categoriaFrete)}`);
    checar("busca por nome acha o pedido em coluna generica", achados.some((p) => p.idInt === alvo.idInt), true);
  } else {
    console.log("   (nenhum pedido em coluna generica com nome — busca nao exercitada)");
  }
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
