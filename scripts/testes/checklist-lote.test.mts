/**
 * O checklist do boletim aplicado ao LOTE — Etapas 6 e 6b. SEM BANCO.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/checklist-lote.test.mts
 *
 * O QUE PROVA
 *   A. A regra pura (lib/checklist-lote): o que é escondido, e o "sem checklist
 *      = sem regra".
 *   B. A rota lotes-em-massa: lote NOVO grava null na coluna escondida, mesmo
 *      com valor na requisição, inclusive tipo_numeracao (não vira
 *      "SEM_NUMERACAO"); lote EXISTENTE não leva a coluna no UPDATE.
 *   C. Etapa 6, prova pendente 1 — o lote novo do PCP nasce nulo: a montagem
 *      do payload e o INSERT de `salvarModelosBoletim`, com o cliente falso.
 *   D. Etapa 6, prova pendente 2 — lote existente intocado pelo PCP: a
 *      abertura da OS recusa sem escrever, a edição só grava `setor`, e o
 *      formulário não tem outra porta de escrita de lote.
 *
 * O `@/lib/supabase/client` dos serviços é trocado pelo `_supabase-falso.mts`:
 * nenhuma requisição sai daqui.
 */
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FALSO = pathToFileURL(path.join(AQUI, "_supabase-falso.mts")).href;

// Registrado DEPOIS do hook de alias, então roda ANTES dele: intercepta só o
// cliente e deixa o resto do `@/` com o hook de sempre.
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@/lib/supabase/client") return { url: FALSO, shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const regra = await import("../../src/features/orcamentos/lib/checklist-lote.ts");
const { falso } = await import("./_supabase-falso.mts");

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

/** O checklist do 301 com NUM, faixa e tipo desmarcados. */
const SEM_NUMERACAO_NO_BOLETIM = regra.checklistVisivel(["cor", "imagem", "impressao_fv"]);
const COMPLETO = regra.checklistVisivel([
  "cor", "imagem", "impressao_fv", "num_gabarito", "numeracao_faixa", "tipo_numeracao", "variacoes"
]);
const SEM_CHECKLIST = regra.checklistVisivel([]);

// ══ A. regra pura ═══════════════════════════════════════════════════════════
console.log("══ A. regra pura");
checar("lista vazia = sem regra", regra.checklistVisivel([]), null);
checar("null = sem regra", regra.checklistVisivel(null), null);
checar("undefined = sem regra", regra.checklistVisivel(undefined), null);
checar("sem regra mostra tudo", regra.mostraCampo(null, "numeracao_faixa"), true);
checar("com regra, campo marcado aparece", regra.mostraCampo(SEM_NUMERACAO_NO_BOLETIM, "cor"), true);
checar("com regra, campo desmarcado some", regra.mostraCampo(SEM_NUMERACAO_NO_BOLETIM, "numeracao_faixa"), false);
checar(
  "colunas escondidas com NUM, faixa e tipo desmarcados",
  regra.colunasEscondidas(SEM_NUMERACAO_NO_BOLETIM),
  ["tipo_numeracao", "gabarito_operacional", "numeracao_inicio", "numeracao_fim"]
);
checar("checklist completo nao esconde coluna", regra.colunasEscondidas(COMPLETO), []);
checar("sem checklist nao esconde coluna", regra.colunasEscondidas(SEM_CHECKLIST), []);

// ══ B. rota lotes-em-massa ══════════════════════════════════════════════════
console.log("\n══ B. rota lotes-em-massa");

/** A requisição traz valor em TODAS as colunas — inclusive as escondidas. */
const loteDaRequisicao = {
  nome_modelo: "Lote teste",
  quantidade: 40,
  padrao: "Azul",
  tipo_numeracao: "SEQUENCIAL",
  numeracao_inicio: 1,
  numeracao_fim: 40,
  verso_tipo: "FRENTE E VERSO",
  bloco: "50",
  gabarito_operacional: "Gabarito que nao deveria entrar",
  variacoes_texto: null
};

/** A MESMA montagem que a rota faz antes de aplicar a regra (passo 8). */
function linhaDeInsertDaRota(lote: typeof loteDaRequisicao) {
  return {
    id_int: 22552,
    id_produto_proposta_origem: 2770,
    nome_modelo: String(lote.nome_modelo).trim(),
    padrao: lote.padrao?.trim() || null,
    quantidade: Number(lote.quantidade),
    tipo_numeracao: lote.tipo_numeracao || "SEM_NUMERACAO",
    numeracao_inicio: lote.numeracao_inicio ?? null,
    numeracao_fim: lote.numeracao_fim ?? null,
    verso_tipo: lote.verso_tipo?.trim() || null,
    bloco: lote.bloco?.trim() || null,
    gabarito_operacional: lote.gabarito_operacional?.trim() || null,
    variacoes_texto: lote.variacoes_texto?.trim() || null
  };
}

const insertEscondido = regra.anularColunasEscondidas(linhaDeInsertDaRota(loteDaRequisicao), SEM_NUMERACAO_NO_BOLETIM);
checar(
  "INSERT: tipo, faixa e gabarito vao null mesmo com valor na requisicao",
  [insertEscondido.tipo_numeracao, insertEscondido.numeracao_inicio, insertEscondido.numeracao_fim, insertEscondido.gabarito_operacional],
  [null, null, null, null]
);
checar(
  "INSERT: o que o produto imprime passa intacto",
  [insertEscondido.padrao, insertEscondido.verso_tipo, insertEscondido.bloco, insertEscondido.nome_modelo, insertEscondido.quantidade],
  ["Azul", "FRENTE E VERSO", "50", "Lote teste", 40]
);

const semTipoNaRequisicao = { ...loteDaRequisicao, tipo_numeracao: "" };
checar(
  "INSERT: tipo escondido NAO vira SEM_NUMERACAO",
  regra.anularColunasEscondidas(linhaDeInsertDaRota(semTipoNaRequisicao), SEM_NUMERACAO_NO_BOLETIM).tipo_numeracao,
  null
);
checar(
  "INSERT sem checklist: exatamente como antes, default SEM_NUMERACAO incluido",
  regra.anularColunasEscondidas(linhaDeInsertDaRota(semTipoNaRequisicao), SEM_CHECKLIST),
  linhaDeInsertDaRota(semTipoNaRequisicao)
);
checar(
  "INSERT com checklist completo: exatamente como antes",
  regra.anularColunasEscondidas(linhaDeInsertDaRota(loteDaRequisicao), COMPLETO),
  linhaDeInsertDaRota(loteDaRequisicao)
);

/** A MESMA montagem do UPDATE da rota (passo 7). */
const patchDaRota = {
  nome_modelo: "Lote existente",
  quantidade: 90,
  padrao: "Azul",
  tipo_numeracao: "SEM_NUMERACAO",
  numeracao_inicio: 5,
  numeracao_fim: 6,
  verso_tipo: "FRENTE E VERSO",
  bloco: "50",
  gabarito_operacional: null,
  variacoes_texto: null,
  updated_at: "2026-09-22T00:00:00.000Z"
};
const updateEscondido = regra.omitirColunasEscondidas(patchDaRota, SEM_NUMERACAO_NO_BOLETIM);
checar(
  "UPDATE: coluna escondida SAI do patch (o banco fica com o que tinha)",
  ["tipo_numeracao", "numeracao_inicio", "numeracao_fim", "gabarito_operacional"].filter((c) => c in updateEscondido),
  []
);
checar(
  "UPDATE: o resto do patch continua",
  Object.keys(updateEscondido).sort(),
  ["bloco", "nome_modelo", "padrao", "quantidade", "updated_at", "variacoes_texto", "verso_tipo"]
);
checar("UPDATE sem checklist: patch inteiro, como antes", regra.omitirColunasEscondidas(patchDaRota, SEM_CHECKLIST), patchDaRota);

// ══ C. Etapa 6 — lote novo do PCP nasce nulo ════════════════════════════════
console.log("\n══ C. PCP: lote novo nasce nulo (prova pendente 1 da Etapa 6)");

/** A montagem que o formulário do PCP fazia ANTES da extração, literal. */
function montagemAntigaDoPcp(
  m: { tipoNumeracao?: string | null; gabaritoNumeracao?: string | null; numeracaoInicial?: number | null; numeracaoFinal?: number | null },
  mostra: (campo: string) => boolean
) {
  return {
    tipo_numeracao: mostra("tipo_numeracao") ? m.tipoNumeracao || null : null,
    gabarito_operacional:
      mostra("num_gabarito") && m.gabaritoNumeracao && m.gabaritoNumeracao !== "Sem gabarito" ? m.gabaritoNumeracao : null,
    numeracao_inicio:
      mostra("numeracao_faixa") && m.numeracaoInicial !== undefined && m.numeracaoInicial !== null ? Number(m.numeracaoInicial) : null,
    numeracao_fim:
      mostra("numeracao_faixa") && m.numeracaoFinal !== undefined && m.numeracaoFinal !== null ? Number(m.numeracaoFinal) : null
  };
}

const modeloDaTela = {
  tipoNumeracao: "SEQUENCIAL",
  gabaritoNumeracao: "Cordão Plus 105cm - A",
  numeracaoInicial: 1,
  numeracaoFinal: 65
};
checar(
  "PCP com NUM, faixa e tipo escondidos: os quatro campos vao null",
  regra.camposOpcionaisDoLotePcp(modeloDaTela, SEM_NUMERACAO_NO_BOLETIM),
  { tipo_numeracao: null, gabarito_operacional: null, numeracao_inicio: null, numeracao_fim: null }
);

// A extracao nao muda o comportamento: mesma saida da montagem antiga numa
// matriz de modelos x checklists.
const modelos = [
  modeloDaTela,
  { tipoNumeracao: "SEM_NUMERACAO", gabaritoNumeracao: "Sem gabarito", numeracaoInicial: null, numeracaoFinal: null },
  { tipoNumeracao: "", gabaritoNumeracao: undefined, numeracaoInicial: 0, numeracaoFinal: undefined },
  { tipoNumeracao: "CUSTOMIZADA", gabaritoNumeracao: "VIP-0001", numeracaoInicial: 10, numeracaoFinal: 20 }
];
const checklists = [
  SEM_CHECKLIST,
  COMPLETO,
  SEM_NUMERACAO_NO_BOLETIM,
  regra.checklistVisivel(["numeracao_faixa"]),
  regra.checklistVisivel(["num_gabarito", "tipo_numeracao"])
];
let divergencias = 0;
for (const m of modelos) {
  for (const c of checklists) {
    const nova = regra.camposOpcionaisDoLotePcp(m, c);
    const antiga = montagemAntigaDoPcp(m, (campo) => regra.mostraCampo(c, campo));
    if (JSON.stringify(nova) !== JSON.stringify(antiga)) divergencias += 1;
  }
}
checar(`extracao identica a montagem antiga (${modelos.length * checklists.length} combinacoes)`, divergencias, 0);

// Pelo servico de verdade: o INSERT que a abertura da OS manda ao banco.
const boletim = await import("../../src/features/pedidos/services/boletim-propostas.service.ts");

falso.zerar();
falso.responder("pedidos_modelos:select", { data: [], error: null }); // setor ainda sem lote
const campos = regra.camposOpcionaisDoLotePcp(modeloDaTela, SEM_NUMERACAO_NO_BOLETIM);
const aberturaNova = await boletim.salvarModelosBoletim(
  22552,
  "os-de-teste",
  [
    {
      id_produto_proposta_origem: 2770,
      nome_modelo: "Lote Principal",
      descricao: null,
      quantidade: 90,
      ...campos,
      obs_impressao: null,
      bloco: "Bloco A",
      setor: "TEXTIL"
    }
  ],
  "TEXTIL"
);
const inserts = falso.chamadas.filter((c) => c.tabela === "pedidos_modelos" && c.op === "insert");
const linhaInserida = (inserts[0]?.payload as Record<string, unknown>[] | undefined)?.[0] ?? {};
checar("abertura da OS gravou", aberturaNova.success, true);
checar("um INSERT em pedidos_modelos", inserts.length, 1);
checar(
  "o lote nasceu com tipo e faixa NULOS",
  [linhaInserida.tipo_numeracao, linhaInserida.numeracao_inicio, linhaInserida.numeracao_fim],
  [null, null, null]
);

// ══ D. Etapa 6 — lote existente intocado pelo PCP ═══════════════════════════
console.log("\n══ D. PCP: lote existente intocado (prova pendente 2 da Etapa 6)");

falso.zerar();
falso.responder("pedidos_modelos:select", { data: [{ id: 1001152 }], error: null }); // setor JA tem lote
const aberturaRepetida = await boletim.salvarModelosBoletim(
  22384,
  "os-de-teste",
  [
    {
      id_produto_proposta_origem: 99,
      nome_modelo: "65 UNIDADES",
      descricao: null,
      quantidade: 65,
      tipo_numeracao: null,
      numeracao_inicio: null,
      numeracao_fim: null,
      obs_impressao: null,
      setor: "TEXTIL"
    }
  ],
  "TEXTIL"
);
const escritasNoLote = falso.chamadas.filter((c) => c.tabela === "pedidos_modelos" && c.op !== "select");
checar("abertura com lote ja existente e recusada", aberturaRepetida.success, false);
checar("e nao escreve NADA em pedidos_modelos", escritasNoLote.length, 0);

const artes = await import("../../src/features/pedidos/services/pedidos-artes.service.ts");
falso.zerar();
const edicao = await artes.atribuirSetorAosModelos([
  { id: 1001151, setor: "TEXTIL" },
  { id: 1001152, setor: "TEXTIL" }
]);
const updates = falso.chamadas.filter((c) => c.tabela === "pedidos_modelos" && c.op === "update");
checar("edicao do boletim gravou", edicao.success, true);
checar("um UPDATE por lote", updates.length, 2);
checar(
  "cada UPDATE da edicao leva SO a coluna setor",
  updates.map((u) => Object.keys(u.payload as Record<string, unknown>)),
  [["setor"], ["setor"]]
);

// O formulario do PCP nao tem outra porta de escrita de lote alem destas duas.
const fonteDoPcp = readFileSync(path.join(AQUI, "..", "..", "src", "features", "pedidos", "BoletimFormPage.tsx"), "utf8");
checar(
  "o formulario nao escreve em pedidos_modelos direto",
  /from\(\s*["']pedidos_modelos["']\s*\)/.test(fonteDoPcp),
  false
);
checar(
  "as unicas chamadas que gravam lote sao a abertura e a atribuicao de setor",
  {
    abertura: (fonteDoPcp.match(/salvarModelosBoletim\(/g) || []).length,
    setor: (fonteDoPcp.match(/atribuirSetorAosModelos\(/g) || []).length,
    outras: (fonteDoPcp.match(/\b(criarModelo|atualizarModelo|excluirModelo)\(/g) || []).length
  },
  { abertura: 1, setor: 1, outras: 0 }
);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
