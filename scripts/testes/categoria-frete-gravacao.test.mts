/**
 * Gravação de `propostas.categoria_frete` pelo saveProposta (Etapa 4).
 *
 * O QUE PROVA
 *   1. Cada um dos sete caminhos de escolha chega ao banco com a categoria
 *      certa — ou com NULL, onde ninguém declarou nada;
 *   2. a derivação VENCE a declaração do usuário: quem declarou aéreo e depois
 *      escolheu um card do SEDEX fica com CORREIOS;
 *   3. A TRAVA: nenhuma proposta fora das criadas aqui teve `valor_total`,
 *      `valor_frete`, `status_interno` ou `modalidade_frete` alterados. A
 *      verificação é sobre a base INTEIRA, antes e depois, por hash.
 *
 * ESCREVE NO BANCO DE PRODUÇÃO: cria propostas avulsas de teste, marcadas no
 * texto e com o id_int no console para cancelamento posterior. Só roda com a
 * trava explícita:
 *
 *   PERMITIR_ESCRITA=1 node --experimental-strip-types \
 *     --import ./scripts/testes/_alias-hook.mjs scripts/testes/categoria-frete-gravacao.test.mts
 */
import { createClient } from "@supabase/supabase-js";
import { config as carregarEnv } from "dotenv";
import { saveProposta } from "../../src/features/orcamentos/services/orcamentos.service.ts";
import type { PropostaFormState } from "../../src/features/orcamentos/types.ts";

if (process.env.PERMITIR_ESCRITA !== "1") {
  console.log("Pulado: defina PERMITIR_ESCRITA=1 (este teste cria propostas reais).");
  process.exit(0);
}

carregarEnv({ path: ".env.local", quiet: true });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.log("FALHOU  .env.local sem NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const client = createClient(URL, SERVICE, { auth: { persistSession: false } });

/** SVT PROVEDOR LOGISTICO — cadastro sem meio declarado. E o caso da pergunta. */
const ID_TRANSPORTADORA = 808;
const USER_ID = "e35d85ac-fc0f-422d-bb24-98ddf2c4eb3e";

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

/**
 * A TRAVA. Retrato dos quatro campos que esta etapa NAO pode mexer, em TODAS as
 * propostas. Comparado no fim, ignorando as que o teste criou.
 */
async function retratoFinanceiro(): Promise<Map<number, string>> {
  const mapa = new Map<number, string>();
  const passo = 1000;
  for (let inicio = 0; ; inicio += passo) {
    const { data, error } = await client
      .from("propostas")
      .select("id_int, valor_total, valor_frete, status_interno, modalidade_frete")
      .order("id_int", { ascending: true })
      .range(inicio, inicio + passo - 1);
    if (error) throw new Error(`retrato falhou: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const p of data) {
      mapa.set(
        Number(p.id_int),
        [p.valor_total, p.valor_frete, p.status_interno, p.modalidade_frete].join("|")
      );
    }
    if (data.length < passo) break;
  }
  return mapa;
}

const base: Omit<PropostaFormState, "observacoes"> = {
  id_int: "NOVO",
  empresa: "Ideal Biro",
  vendedor: "TESTE AUTOMATIZADO",
  status: "NOVO",
  clienteId: "",
  contatoId: "",
  enderecoId: "",
  compradorId: "",
  itens: [],
  deletedProdutoPropostaIds: [],
  pedidosModelos: [],
  fretes: [],
  freteEscolhidoId: "",
  modalidadeFrete: "CIF",
  transporteCategoria: null,
  idTransportadoraCliente: null,
  descontoGeralTipo: "VALOR",
  descontoGeralValor: "0",
  formaPagamento: "A combinar",
  obsTecnica: "",
  isAvulso: true,
  valorProdutosManual: "100,00",
  valorFreteManual: "0,00",
  observacoesFreteManual: "",
  clienteNaoCadastrado: true,
  nomeClienteLivre: "TESTE categoria_frete",
  cepLivre: "90620130",
  cidadeLivre: "Porto Alegre",
  ufLivre: "RS"
};

/** Os sete caminhos do enunciado, um por linha. */
const CASOS: Array<{ nome: string; esperado: string | null; form: Partial<PropostaFormState> }> = [
  {
    nome: "1 Correios (SEDEX cotado, CIF)",
    esperado: "CORREIOS",
    form: { modalidadeFrete: "CIF", observacoesFreteManual: "SEDEX", valorFreteManual: "28,84" }
  },
  {
    nome: "2 Motoboy (FOB por motoboy)",
    esperado: "MOTOBOY",
    form: { modalidadeFrete: "FOB", transporteCategoria: "MOTOBOY", observacoesFreteManual: "Motoboy" }
  },
  {
    nome: "3 RETIRA (modalidade vence o SEDEX cotado)",
    esperado: "RETIRA",
    form: { modalidadeFrete: "RETIRA", observacoesFreteManual: "SEDEX" }
  },
  {
    nome: "4 FOB com transportadora, declarado RODOVIARIO",
    esperado: "RODOVIARIO",
    form: {
      modalidadeFrete: "FOB",
      idTransportadoraCliente: ID_TRANSPORTADORA,
      observacoesFreteManual: "SVT TRANSPORTES",
      categoriaFreteDeclarada: "RODOVIARIO"
    }
  },
  {
    nome: "5 FOB com transportadora, declarado AEREO",
    esperado: "AEREO",
    form: {
      modalidadeFrete: "FOB",
      idTransportadoraCliente: ID_TRANSPORTADORA,
      observacoesFreteManual: "SVT TRANSPORTES",
      categoriaFreteDeclarada: "AEREO"
    }
  },
  {
    nome: "6 frete manual sem declaracao (fica NULL)",
    esperado: null,
    form: { modalidadeFrete: "CIF", observacoesFreteManual: "Braspress", valorFreteManual: "70,00" }
  },
  {
    nome: "7 Frete Incluso (avulsa) vira EXTRAS",
    esperado: "EXTRAS",
    form: { modalidadeFrete: "CIF", observacoesFreteManual: "Frete Incluso" }
  },
  {
    nome: "8 derivacao VENCE a declaracao: SEDEX com aereo declarado",
    esperado: "CORREIOS",
    form: {
      modalidadeFrete: "CIF",
      observacoesFreteManual: "SEDEX",
      categoriaFreteDeclarada: "AEREO"
    }
  }
];

console.log("Tirando o retrato financeiro da base ANTES...");
const antes = await retratoFinanceiro();
console.log(`   ${antes.size} propostas no retrato.\n`);

const criados: Array<{ idInt: number; nome: string; categoria: string | null }> = [];

/** `CASOS=4,5` roda so esses — reexecutar tudo criaria proposta de teste a toa. */
const filtro = (process.env.CASOS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const casosAtivos = filtro.length === 0 ? CASOS : CASOS.filter((c) => filtro.includes(c.nome.split(" ")[0]));

for (const caso of casosAtivos) {
  const form = {
    ...base,
    ...caso.form,
    observacoes: `TESTE AUTOMATIZADO — categoria_frete, caso ${caso.nome}. Pode cancelar.`
  } as PropostaFormState;

  const r = await saveProposta(form, client, USER_ID);
  if (!r.success || !r.id_int) {
    falhas += 1;
    console.log(`FALHOU  ${caso.nome}: ${r.errorMessage}`);
    continue;
  }

  const { data: linha } = await client
    .from("propostas")
    .select("categoria_frete, modalidade_frete, frete_escolhido, valor_frete, valor_total, status_interno")
    .eq("id_int", r.id_int)
    .single();

  const gravado = (linha?.categoria_frete as string | null) ?? null;
  criados.push({ idInt: r.id_int, nome: caso.nome, categoria: gravado });
  checar(`${caso.nome} -> categoria_frete`, gravado, caso.esperado);
}

// ── O GATE: proposta fora da fase de orcamento NAO e reclassificada ──────
// `categoria_frete` fica no MESMO `if (modalidadeEditavel)` da modalidade, entao
// herda a trava dela. Aqui o status e avancado direto no banco, sem passar pela
// tela — o cenario real em que o `formState` que chega ao save esta velho.
if (criados.length > 0) {
  const alvo = criados[0];
  await client.from("propostas").update({ status_interno: "EXPEDICAO" }).eq("id_int", alvo.idInt);

  const telaVelha = {
    ...base,
    ...CASOS[0].form,
    id_int: String(alvo.idInt),
    status: "NOVO",
    modalidadeFrete: "FOB",
    idTransportadoraCliente: ID_TRANSPORTADORA,
    observacoesFreteManual: "SVT TRANSPORTES",
    categoriaFreteDeclarada: "AEREO",
    observacoes: "TESTE AUTOMATIZADO — gate pos-liberacao. Pode cancelar."
  } as PropostaFormState;

  const r = await saveProposta(telaVelha, client, USER_ID);
  checar("gate: segundo salvamento continua dando certo", r.success, true);

  const { data: pos } = await client
    .from("propostas")
    .select("categoria_frete, modalidade_frete")
    .eq("id_int", alvo.idInt)
    .single();

  checar("gate: categoria_frete NAO foi reclassificada", pos?.categoria_frete, alvo.categoria);
  checar("gate: modalidade tambem preservada", pos?.modalidade_frete, "CIF");

  await client.from("propostas").update({ status_interno: "NOVO" }).eq("id_int", alvo.idInt);
}

console.log("\nTirando o retrato financeiro da base DEPOIS...");
const depois = await retratoFinanceiro();
const idsCriados = new Set(criados.map((c) => c.idInt));

const divergentes: string[] = [];
for (const [idInt, valorAntes] of antes) {
  if (idsCriados.has(idInt)) continue;
  const valorDepois = depois.get(idInt);
  if (valorDepois === undefined) {
    divergentes.push(`#${idInt} SUMIU`);
  } else if (valorDepois !== valorAntes) {
    divergentes.push(`#${idInt} ${valorAntes} -> ${valorDepois}`);
  }
}

checar("TRAVA: zero propostas divergentes fora das criadas", divergentes.length, 0);
if (divergentes.length > 0) {
  for (const d of divergentes.slice(0, 20)) console.log(`   ${d}`);
}

console.log("\n>>> propostas de teste criadas (para cancelar):");
for (const c of criados) {
  console.log(`    id_int ${c.idInt}  categoria_frete=${c.categoria ?? "NULL"}  ${c.nome}`);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
