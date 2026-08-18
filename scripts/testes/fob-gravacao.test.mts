/**
 * Teste de ponta a ponta da GRAVAÇÃO da modalidade (camada A do eixo FOB).
 *
 * O QUE PROVA
 *   1. Uma proposta declarada FOB com transportadora chega ao banco com
 *      `modalidade_frete` e `id_transportadora_cliente` PREENCHIDOS — era isso
 *      que não acontecia em nenhuma das 8.182 propostas.
 *   2. Sob FOB, `valor_frete` grava zero e `frete_escolhido` grava o nome da
 *      transportadora do cadastro, não o serviço cotado.
 *   3. Com a proposta já fora da fase de orçamento, uma NOVA declaração é
 *      recusada pelo gate — que agora lê o `status_interno` do BANCO, não o que
 *      a tela carregou — e a recusa volta em `avisoModalidade` em vez de sumir
 *      em silêncio. O que já estava gravado permanece.
 *
 * ESCREVE NO BANCO DE PRODUÇÃO: cria uma proposta avulsa de teste. Por isso só
 * roda com a trava explícita:
 *
 *   PERMITIR_ESCRITA=1 node --experimental-strip-types \
 *     --import ./scripts/testes/_alias-hook.mjs scripts/testes/fob-gravacao.test.mts
 *
 * A proposta criada fica identificada no texto e o id_int sai no console para
 * cancelamento posterior. Sai com código 1 se algo falhar.
 */
import { createClient } from "@supabase/supabase-js";
import { config as carregarEnv } from "dotenv";
import { saveProposta } from "../../src/features/orcamentos/services/orcamentos.service.ts";
import type { PropostaFormState } from "../../src/features/orcamentos/types.ts";

if (process.env.PERMITIR_ESCRITA !== "1") {
  console.log("Pulado: defina PERMITIR_ESCRITA=1 (este teste cria uma proposta real).");
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

/** AVI AZUL TRANSPORTES DE CARGAS LTDA — categoria TRANSPORTADORA, ativa. */
const ID_TRANSPORTADORA = 120006;
const NOME_TRANSPORTADORA = "AVI AZUL";
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

const base: PropostaFormState = {
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
  modalidadeFrete: "FOB",
  idTransportadoraCliente: ID_TRANSPORTADORA,
  descontoGeralTipo: "VALOR",
  descontoGeralValor: "0",
  formaPagamento: "A combinar",
  observacoes: "TESTE AUTOMATIZADO — eixo FOB (modalidade ponta a ponta). Pode cancelar.",
  isAvulso: true,
  valorProdutosManual: "100,00",
  valorFreteManual: "28,84",
  observacoesFreteManual: "SEDEX",
  clienteNaoCadastrado: true,
  nomeClienteLivre: "TESTE FOB - eixo modalidade",
  cepLivre: "90620130",
  cidadeLivre: "Porto Alegre",
  ufLivre: "RS"
};

// ── 1. Criação declarando FOB ────────────────────────────────────────────────
const criacao = await saveProposta(base, client, USER_ID);
if (!criacao.success || !criacao.id_int) {
  console.log(`FALHOU  criação da proposta de teste: ${criacao.errorMessage}`);
  process.exit(1);
}
const idInt = criacao.id_int;
console.log(`\n>>> proposta de teste criada: id_int ${idInt}\n`);

const { data: apos } = await client
  .from("propostas")
  .select("modalidade_frete, id_transportadora_cliente, frete_escolhido, valor_frete, valor_total, status_interno")
  .eq("id_int", idInt)
  .single();

checar("modalidade_frete gravada", apos?.modalidade_frete, "FOB");
checar("id_transportadora_cliente gravada", apos?.id_transportadora_cliente, ID_TRANSPORTADORA);
checar("frete_escolhido usa a transportadora, não o cotado", apos?.frete_escolhido, NOME_TRANSPORTADORA);
checar("valor_frete zerado em FOB", Number(apos?.valor_frete), 0);
checar("valor_total sem frete", Number(apos?.valor_total), 100);
checar("criação sem aviso de recusa", criacao.avisoModalidade, undefined);

// A cotação continua existindo, escolhida — a Expedição lê daqui.
const { data: cot } = await client
  .from("cotacao_frete")
  .select("servico, valor, escolhido")
  .eq("id_int", idInt);
checar("cotacao_frete preservada, uma linha escolhida", cot?.map((c) => c.escolhido), [true]);
checar("cotacao_frete sem modalidade escrita nela", Object.keys(cot?.[0] ?? {}).includes("modalidade_frete"), false);

// ── 2. Gate: proposta fora da fase de orçamento recusa NOVA declaração ───────
// O status é avançado direto no banco, sem passar pela tela — é exatamente o
// cenário que produzia o descarte silencioso: o formulário continua achando que
// está em NOVO.
await client.from("propostas").update({ status_interno: "EXPEDICAO" }).eq("id_int", idInt);

const telaDesatualizada: PropostaFormState = {
  ...base,
  id_int: String(idInt),
  status: "NOVO", // <- o que a tela carregou na abertura, já obsoleto
  modalidadeFrete: "CIF",
  idTransportadoraCliente: null
};
const segundoSave = await saveProposta(telaDesatualizada, client, USER_ID);

checar("segundo salvamento continua dando certo", segundoSave.success, true);
checar("recusa foi DITA (avisoModalidade preenchido)", typeof segundoSave.avisoModalidade, "string");

const { data: depois } = await client
  .from("propostas")
  .select("modalidade_frete, id_transportadora_cliente, frete_escolhido, valor_frete")
  .eq("id_int", idInt)
  .single();

checar("declaração anterior preservada (travado = não altera)", depois?.modalidade_frete, "FOB");
checar("transportadora anterior preservada", depois?.id_transportadora_cliente, ID_TRANSPORTADORA);

// E o cálculo segue a declaração GRAVADA, não a da tela recusada: sem isto o
// salvamento reescrevia valor_frete e frete_escolhido de uma proposta FOB com o
// valor cotado e o nome do serviço — a incoerência do eixo pela porta dos fundos.
checar("recusa não reescreve o valor do frete", Number(depois?.valor_frete), 0);
checar("recusa não reescreve o rótulo do transporte", depois?.frete_escolhido, NOME_TRANSPORTADORA);

console.log(`\nproposta de teste: id_int ${idInt}`);
console.log(falhas === 0 ? "TUDO OK" : `${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
