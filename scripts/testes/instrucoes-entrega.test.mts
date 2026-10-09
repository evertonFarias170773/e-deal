/**
 * Instruções de entrega (`propostas.obs_entrega`, 09/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/instrucoes-entrega.test.mts
 *
 * O QUE PROVA
 *   1. A regra de "tem texto" (uma só para PDF, ícone e Despachar): espaço e
 *      quebra de linha soltos não contam; as quebras do meio ficam.
 *   2. O mapa da Expedição só guarda pedido com texto, e aguenta linha ruim.
 *   3. O boletim grava SÓ `obs_entrega`, na proposta do pedido, e devolve o erro
 *      do banco em vez de lançar.
 *   4. A proposta lê e grava o campo nos dois caminhos do Salvar (completo e
 *      parcial com cobrança ativa), ao lado da orientação técnica.
 *   5. Os dois PDFs da OS têm o bloco "Instruções de entrega" condicionado ao
 *      texto, logo depois da orientação técnica — e o maço usa a mesma página.
 *   6. Expedição: a consulta compartilhada do painel não conhece o campo; a
 *      leitura é a do hook à parte (`id_int, obs_entrega`), que não derruba a
 *      tela quando falha; card e cartão do celular mostram ícone, lista e
 *      Despachar mostram o texto.
 *
 * Sem banco e sem tela: cliente falso e leitura do fonte.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  mapaDeInstrucoesDeEntrega,
  temInstrucaoDeEntrega,
  textoDeEntrega
} from "../../src/features/pedidos/lib/instrucoes-entrega.ts";
import { atualizarObsEntregaProposta } from "../../src/features/pedidos/services/boletim-propostas.service.ts";
import { falso, getSupabaseClient } from "./_supabase-falso.mts";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fonte = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

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

// ── 1. Tem texto? ───────────────────────────────────────────────────────────
checar("texto normal", textoDeEntrega("entregar na quinta pela manhã"), "entregar na quinta pela manhã");
checar("pontas aparadas, quebras do meio ficam", textoDeEntrega("  linha 1\nlinha 2\n\n"), "linha 1\nlinha 2");
checar("vazio, espaços, nulo e não-texto viram vazio", ["", "   ", "\n\t ", null, undefined, 0, {}].map(textoDeEntrega), ["", "", "", "", "", "", ""]);
checar("temInstrucaoDeEntrega", ["quinta", " ", null, "\n"].map(temInstrucaoDeEntrega), [true, false, false, false]);

// ── 2. Mapa da Expedição ────────────────────────────────────────────────────
const mapa = mapaDeInstrucoesDeEntrega([
  { id_int: 23380, obs_entrega: " quinta pela manhã " },
  { id_int: "23381", obs_entrega: "ligar antes\nportaria" },
  { id_int: 23382, obs_entrega: "   " },
  { id_int: 23383, obs_entrega: null },
  { id_int: null, obs_entrega: "sem pedido" },
  { id_int: 0, obs_entrega: "zero" },
  {}
]);
checar("mapa só com quem tem texto", [...mapa.entries()], [
  [23380, "quinta pela manhã"],
  [23381, "ligar antes\nportaria"]
]);
checar("mapa de nada", [mapaDeInstrucoesDeEntrega(null).size, mapaDeInstrucoesDeEntrega(undefined).size, mapaDeInstrucoesDeEntrega([]).size], [0, 0, 0]);

// ── 3. Gravação pelo boletim ────────────────────────────────────────────────
falso.zerar();
const gravou = await atualizarObsEntregaProposta(23380, "quinta pela manhã\nligar antes", getSupabaseClient() as never);
checar("boletim: grava com sucesso", gravou, { success: true });
checar("boletim: uma chamada, UPDATE em propostas, só obs_entrega, no pedido certo", falso.chamadas, [
  { tabela: "propostas", op: "update", filtros: [["eq", ["id_int", 23380]]], payload: { obs_entrega: "quinta pela manhã\nligar antes" } }
]);
falso.zerar();
falso.responder("propostas:update", { data: null, error: { message: "permission denied" } });
checar("boletim: erro do banco volta como resultado, sem lançar", await atualizarObsEntregaProposta(23380, "x", getSupabaseClient() as never), {
  success: false,
  error: "permission denied"
});

// ── 4. Proposta ─────────────────────────────────────────────────────────────
const servico = fonte("src/features/orcamentos/services/orcamentos.service.ts");
checar("proposta: lê obs_entrega", servico.includes('obsEntrega: proposalRow.obs_entrega || ""'), true);
checar("proposta: Salvar completo grava", servico.includes("obs_tecnica: formState.obsTecnica,\n      obs_entrega: formState.obsEntrega,"), true);
checar("proposta: Salvar parcial (cobrança ativa) grava", /obs_tecnica: formState\.obsTecnica,\n[\s\S]{0,200}obs_entrega: formState\.obsEntrega\n\s+\}\)\n\s+\.eq\("id_int", id_int\)/.test(servico), true);
checar("proposta: obs_entrega gravada em exatamente dois lugares", servico.split("obs_entrega: formState.obsEntrega").length - 1, 2);
const form = fonte("src/features/orcamentos/OrcamentoFormPage.tsx");
checar("aba: campo Instruções de entrega na aba producao", /activeFormTab === "producao" && shouldShowRest && \(\n\s+<FormSection\n\s+title="Instruções de entrega"/.test(form), true);
checar("aba: textarea sem limite de tamanho", /value=\{form\.obsEntrega\}[\s\S]{0,300}/.exec(form)?.[0].includes("maxLength") ?? true, false);
checar("aba: a orientação técnica continua lá", form.includes('title="Orientação técnica de produção"'), true);

// ── 5. PDFs da OS ───────────────────────────────────────────────────────────
for (const arquivo of ["OsPdfDocument.tsx", "OsPdfResumoDocument.tsx"]) {
  const pdf = fonte(`src/features/pedidos/pdf/${arquivo}`);
  const tecnica = pdf.indexOf("<Text style={styles.obsTitulo}>Orientação técnica de produção:</Text>");
  const entrega = pdf.indexOf("<Text style={styles.obsTitulo}>Instruções de entrega:</Text>");
  const observacoes = pdf.indexOf("<Text style={styles.obsTitulo}>Observações:</Text>");
  checar(`${arquivo}: bloco logo depois da orientação técnica e antes das Observações`, tecnica > 0 && tecnica < entrega && entrega < observacoes, true);
  checar(`${arquivo}: bloco só existe com texto`, pdf.includes("{textoDeEntrega(vm.obsEntrega) ? (\n          <View style={styles.obsBox}>"), true);
  checar(`${arquivo}: um bloco só`, pdf.split("Instruções de entrega:").length - 1, 1);
}
const maco = fonte("src/features/pedidos/pdf/OsPdfMacoDocument.tsx");
checar("maço usa a página do boletim (herda o bloco)", maco.includes("OsPdfPaginaBoletim"), true);
const vm = fonte("src/features/pedidos/services/os-viewmodel.service.ts");
checar("view model leva obsEntrega", vm.includes('obsEntrega: pedido.obsEntrega || ""'), true);
const detalhe = fonte("src/features/pedidos/services/pedidos-detalhe.service.ts");
checar("leitura da proposta inclui obs_entrega na MESMA consulta", detalhe.includes("is_prd_aprovado, obs_tecnica, obs_entrega, liberado_producao_em"), true);

// ── 6. Expedição ────────────────────────────────────────────────────────────
checar("consulta compartilhada do painel não conhece o campo", fonte("src/features/expedicao/services/expedicao.service.ts").includes("obs_entrega"), false);
const hook = fonte("src/features/expedicao/hooks/useInstrucoesDeEntrega.ts");
checar("hook lê só id_int e obs_entrega", hook.includes('.select("id_int, obs_entrega")'), true);
checar("hook lê só os pedidos carregados, em lote", hook.includes('.in("id_int", ids.slice(i, i + TAMANHO_DO_LOTE))'), true);
checar("hook: falha vira mapa vazio (duas saídas)", hook.split("setLido(SEM_INSTRUCOES)").length - 1, 2);
checar("hook não lança: tudo dentro de try/catch", /try \{[\s\S]+\} catch \(e\) \{[\s\S]+setLido\(SEM_INSTRUCOES\)/.test(hook), true);
const kanban = fonte("src/features/expedicao/components/KanbanTransportadoras.tsx");
checar("Kanban: ícone no card", kanban.includes('<AvisoInstrucaoEntrega texto={instrucoesPorPedido?.get(p.idInt)} formato="icone" />'), true);
const pagina = fonte("src/features/expedicao/ExpedicaoPage.tsx");
checar("celular: ícone no cartão", pagina.includes('<AvisoInstrucaoEntrega texto={instrucoesPorPedido.get(p.idInt)} formato="icone" />'), true);
checar("lista: texto inteiro", pagina.includes('<AvisoInstrucaoEntrega texto={instrucoesPorPedido.get(p.idInt)} formato="texto"'), true);
checar("Despachar recebe a instrução", pagina.includes("instrucaoEntrega={instrucoesPorPedido.get(pedidoDespacho.pedido.idInt)}"), true);
checar("Despachar: texto inteiro", fonte("src/features/expedicao/components/DespacharModal.tsx").includes('<AvisoInstrucaoEntrega texto={instrucaoEntrega} formato="texto"'), true);
const aviso = fonte("src/features/expedicao/components/AvisoInstrucaoEntrega.tsx");
checar("aviso: sem texto não renderiza nada", aviso.includes("if (!instrucao) return null;"), true);
checar("aviso: texto na dica e quebra de linha preservada", [aviso.includes("title={dica}"), aviso.includes("whitespace-pre-line")], [true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} verificacao(oes) falharam.`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
