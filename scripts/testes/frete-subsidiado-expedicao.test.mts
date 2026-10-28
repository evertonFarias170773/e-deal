/**
 * Frete subsidiado na Expedicao (28/10/2026): "Aplicar recotacao" e "Corrigir frete"
 * pedem confirmacao para cliente com clientes.pode_editar_frete = true.
 *
 *   node --experimental-strip-types --no-warnings --import ./scripts/testes/_alias-hook.mjs scripts/testes/frete-subsidiado-expedicao.test.mts
 *
 * Nada vai ao banco: o cliente do Supabase e falso.
 */
import { readFileSync } from "node:fs";
import {
  conferirFreteSubsidiado,
  mensagemFreteSubsidiado,
  MENSAGEM_FALHA_CONFERENCIA
} from "@/features/expedicao/lib/frete-subsidiado";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok" : "FALHOU"} - ${nome}${ok ? "" : `\n   esperado ${JSON.stringify(esperado)}\n   veio     ${JSON.stringify(real)}`}`);
}
const ler = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

type Linhas = Record<string, { data: unknown; error: unknown }>;
/** Cliente falso: devolve a linha da tabela e registra o que foi pedido (so select). */
function clienteFalso(linhas: Linhas) {
  const chamadas: string[] = [];
  return {
    chamadas,
    from(tabela: string) {
      const q = {
        select(cols: string) { chamadas.push(`${tabela}:select:${cols}`); return q; },
        eq(col: string, v: unknown) { chamadas.push(`${tabela}:eq:${col}=${v}`); return q; },
        async maybeSingle() { return linhas[tabela] ?? { data: null, error: null }; },
        update() { chamadas.push(`${tabela}:UPDATE`); return q; },
        insert() { chamadas.push(`${tabela}:INSERT`); return q; },
        delete() { chamadas.push(`${tabela}:DELETE`); return q; }
      };
      return q;
    }
  };
}

const ligado = clienteFalso({
  propostas: { data: { id_cliente: 7, valor_frete: 0 }, error: null },
  clientes: { data: { pode_editar_frete: true }, error: null }
});
checar("cliente com o checkbox: subsidiado, valor atual do banco (R$ 0,00)", await conferirFreteSubsidiado(ligado as never, 123), { ok: true, subsidiado: true, valorAtual: 0 });
checar("le id_cliente/valor_frete da proposta e pode_editar_frete do cadastro, sem escrita", ligado.chamadas, [
  "propostas:select:id_cliente, valor_frete", "propostas:eq:id_int=123",
  "clientes:select:pode_editar_frete", "clientes:eq:id_cliente=7"
]);

for (const [rotulo, valor] of [["null", null], ["false", false]] as const) {
  const c = clienteFalso({
    propostas: { data: { id_cliente: 7, valor_frete: "45.9" }, error: null },
    clientes: { data: { pode_editar_frete: valor }, error: null }
  });
  checar(`checkbox ${rotulo}: sem aviso`, await conferirFreteSubsidiado(c as never, 1), { ok: true, subsidiado: false, valorAtual: 45.9 });
}
const semCliente = clienteFalso({ propostas: { data: { id_cliente: null, valor_frete: 10 }, error: null } });
checar("pedido sem cliente: sem aviso, sem ler cadastro", [await conferirFreteSubsidiado(semCliente as never, 1), semCliente.chamadas.some((c) => c.startsWith("clientes"))], [{ ok: true, subsidiado: false, valorAtual: 10 }, false]);

const falhaProposta = clienteFalso({ propostas: { data: null, error: { message: "x" } } });
checar("falha de leitura: nao grava, mostra o motivo", await conferirFreteSubsidiado(falhaProposta as never, 1), { ok: false, mensagem: MENSAGEM_FALHA_CONFERENCIA });
const falhaCadastro = clienteFalso({ propostas: { data: { id_cliente: 7, valor_frete: 1 }, error: null }, clientes: { data: null, error: { message: "x" } } });
checar("falha no cadastro: nao grava", (await conferirFreteSubsidiado(falhaCadastro as never, 1)).ok, false);
checar("sem cliente do Supabase: nao grava", (await conferirFreteSubsidiado(null, 1)).ok, false);

const msg = mensagemFreteSubsidiado(0, 52.3).replace(/ /g, " ");
checar("mensagem com valor atual e novo", msg, "Este cliente tem frete subsidiado (valor atual: R$ 0,00). Confirma que quer regravar para R$ 52,30?");

// As duas telas: a conferencia vem antes da gravacao; confirmar chama o fluxo de sempre.
const despachar = ler("src/features/expedicao/components/DespacharModal.tsx");
const corrigir = ler("src/features/expedicao/components/CorrigirFreteModal.tsx");
const antes = (txt: string, a: string, b: string) => txt.indexOf(a) >= 0 && txt.indexOf(a) < txt.indexOf(b);
checar("Despachar: confere antes de aplicar; aplicarRecotacao so dentro de gravarAplicacao", [
  antes(despachar, "conferirFreteSubsidiado(getSupabaseClient(), pedido.idInt)", "async function gravarAplicacao("),
  (despachar.match(/await aplicarRecotacao\(/g) || []).length,
  antes(despachar, "async function gravarAplicacao(", "await aplicarRecotacao(")
], [true, 1, true]);
checar("Corrigir: confere antes de gravar; confirmarCorrecaoFrete so dentro de gravarCorrecao", [
  antes(corrigir, "conferirFreteSubsidiado(getSupabaseClient(), pedido.idInt)", "async function gravarCorrecao("),
  (corrigir.match(/await confirmarCorrecaoFrete\(/g) || []).length,
  antes(corrigir, "async function gravarCorrecao(", "await confirmarCorrecaoFrete(")
], [true, 1, true]);
checar("as duas telas mostram a mensagem com o valor atual e o novo", [
  despachar.includes("mensagemFreteSubsidiado(confirmarSubsidio.valorAtual, confirmarSubsidio.opcao.valor)"),
  corrigir.includes("mensagemFreteSubsidiado(confirmarSubsidio.valorAtual, confirmarSubsidio.valorNovo)")
], [true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
