/**
 * Valor do item da NF-e com o bônus de tabela especial do cliente.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/valor-item-nfe.test.mts [id_int ...]
 *
 * Parte 1 prova a regra com a função REAL (`valoresDosItensDaNota`). Parte 2
 * simula, SEM GRAVAR, o rascunho que `createOrReuseNfeDraft` montaria: carrega a
 * proposta pelo mesmo `getPropostaDetailById`, aplica a regra, reproduz o
 * `round(quantidade * valor_unitario, 2)` do trigger do item e a conta de
 * `fn_recalcular_totais_nfe` (itens + frete - desconto), e compara com o total
 * da proposta. Todo `fetch` que não seja leitura é barrado: se algo tentar
 * gravar, o teste falha.
 */
import { config as carregarEnv } from "dotenv";

carregarEnv({ path: ".env.local", quiet: true });

const escritas: string[] = [];
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
  const metodo = String(init?.method ?? (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const url = String(entrada instanceof Request ? entrada.url : entrada);
  if (!["GET", "HEAD", "OPTIONS"].includes(metodo)) {
    escritas.push(`${metodo} ${url.split("?")[0]}`);
    throw new Error(`escrita barrada no teste: ${metodo} ${url.split("?")[0]}`);
  }
  return fetchOriginal(entrada, init);
}) as typeof fetch;

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

const { valoresDosItensDaNota } = await import("../../src/features/nfe/lib/valor-item-nfe.ts");

/** A conta de antes, copiada do nfe.service.ts do HEAD, para provar que "sem bônus" não mudou. */
function valoresDeAntes(itens: Array<{ quantidade?: number | null; subtotalBruto?: number | null; subtotal?: number | null; valorUnitario?: number | null }>) {
  return itens.map((item) => {
    const quantidade = Number(item.quantidade) || 0;
    const subtotalItem = Number(item.subtotalBruto ?? item.subtotal ?? quantidade * Number(item.valorUnitario ?? 0));
    return { valorBruto: subtotalItem, valorUnitario: quantidade > 0 ? Number((subtotalItem / quantidade).toFixed(10)) : 0 };
  });
}
const centavos = (v: number) => Math.round(Number((v * 100).toFixed(6)));
/** `round(quantidade * valor_unitario, 2)` de `fn_calcular_valor_bruto_nfe_item`. */
const brutoDoTrigger = (quantidade: number, unitario: number) => centavos(quantidade * unitario) / 100;

// ── 1. A regra ──────────────────────────────────────────────────────────────
checar("22066 com 10%: 88,00 e 63,00 viram 79,20 e 56,70",
  valoresDosItensDaNota([{ quantidade: 300, subtotalBruto: 88 }, { quantidade: 100, subtotalBruto: 63 }], 10),
  [{ valorBruto: 79.2, valorUnitario: 0.264 }, { valorBruto: 56.7, valorUnitario: 0.567 }]);

const semBonus = [{ quantidade: 300, subtotalBruto: 88 }, { quantidade: 7, subtotalBruto: 100 }, { quantidade: 3, subtotal: 10.01 }, { quantidade: 0, valorUnitario: 5 }];
checar("percentual 0: identico a conta de antes", valoresDosItensDaNota(semBonus, 0), valoresDeAntes(semBonus));
checar("percentual negativo ou NaN: identico a conta de antes", [valoresDosItensDaNota(semBonus, -5), valoresDosItensDaNota(semBonus, Number.NaN)], [valoresDeAntes(semBonus), valoresDeAntes(semBonus)]);

// Três itens de 0,05 com 10%: 0,045 cada. Item a item dá 0,05 x 3 = 0,15, mas a
// soma exata é 0,135 -> 0,14. O centavo a mais sai do item de maior valor (o primeiro, no empate).
const residuo = valoresDosItensDaNota([{ quantidade: 1, subtotalBruto: 0.05 }, { quantidade: 1, subtotalBruto: 0.05 }, { quantidade: 1, subtotalBruto: 0.05 }], 10);
checar("residuo de centavo vai para o item de maior valor", residuo.map((r) => r.valorBruto), [0.04, 0.05, 0.05]);
checar("e a soma fecha com a soma exata arredondada", centavos(residuo.reduce((s, r) => s + r.valorBruto, 0)), 14);
checar("arredonda no centavo: 1,1167 x 0,9 = 1,00503 -> 1,01",
  valoresDosItensDaNota([{ quantidade: 1, subtotalBruto: 1.1167 }], 10)[0].valorBruto, 1.01);

// ── 2. Simulacao do rascunho, sem gravar ────────────────────────────────────
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ids = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !SERVICE || ids.length === 0) {
  console.log("\n(pulando a simulacao: sem chaves no .env.local ou sem id_int na linha de comando)");
} else {
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;
  const { getPropostaDetailById } = await import("../../src/features/orcamentos/services/orcamentos.service.ts");
  const { getClienteBonusPercent } = await import("../../src/features/orcamentos/orcamento-utils.ts");
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE);

  for (const idInt of ids) {
    const proposta = await getPropostaDetailById(idInt);
    if (!proposta) { console.log(`\n#${idInt}: proposta nao encontrada`); falhas += 1; continue; }
    const { data: linha } = await sb.from("propostas").select("valor_total").eq("id_int", idInt).single();
    const bonus = getClienteBonusPercent(proposta.cliente);
    const itens = proposta.itens ?? [];
    const agora = valoresDosItensDaNota(itens, bonus);
    const antes = valoresDeAntes(itens);

    console.log(`\n#${idInt} | cliente ${proposta.cliente?.idCliente ?? "?"} | bonus ${bonus}% | itens ${itens.length}`);
    let somaItens = 0;
    itens.forEach((it, i) => {
      const q = Number(it.quantidade) || 0;
      const trigger = brutoDoTrigger(q, agora[i].valorUnitario);
      somaItens += trigger;
      console.log(`  ${i + 1}. ${String(it.nome).slice(0, 28).padEnd(28)} qtd ${String(q).padStart(6)} | bruto ${antes[i].valorBruto.toFixed(2).padStart(9)} | nota ${agora[i].valorBruto.toFixed(2).padStart(9)} | unit ${agora[i].valorUnitario.toFixed(10)} | trigger ${trigger.toFixed(2)}${it.statusItem === "CANCELADO" ? " | CANCELADO" : ""}`);
      if (trigger !== agora[i].valorBruto) { falhas += 1; console.log("     FALHOU: o trigger mudaria o centavo do item"); }
    });
    const frete = centavos(Number(proposta.resumo?.frete ?? 0)) / 100;
    const desconto = centavos(Number(proposta.resumo?.descontoGeral ?? 0)) / 100;
    const produtos = centavos(somaItens) / 100;
    const totalNota = centavos(produtos + frete - desconto) / 100;
    const totalApp = centavos(Number(proposta.resumo?.valorTotal ?? 0)) / 100;
    const totalGravado = centavos(Number(linha?.valor_total ?? 0)) / 100;
    const totalAntes = centavos(antes.reduce((s, v, i) => s + brutoDoTrigger(Number(itens[i].quantidade) || 0, v.valorUnitario), 0) + frete - desconto) / 100;
    console.log(`  produtos ${produtos.toFixed(2)} + frete ${frete.toFixed(2)} - desconto geral ${desconto.toFixed(2)} = NOTA ${totalNota.toFixed(2)} | antes da mudanca ${totalAntes.toFixed(2)} | proposta na tela ${totalApp.toFixed(2)} | propostas.valor_total ${totalGravado.toFixed(2)}`);
    if (bonus > 0) {
      checar(`#${idInt}: nota fecha com o total da proposta na tela`, totalNota, totalApp);
      checar(`#${idInt}: nota fecha com propostas.valor_total`, totalNota, totalGravado);
    } else {
      checar(`#${idInt}: sem bonus, itens identicos aos de antes`, agora, antes);
    }
  }
}

checar("nenhuma escrita tentada", escritas, []);
console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
