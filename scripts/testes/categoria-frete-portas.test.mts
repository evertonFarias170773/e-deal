/**
 * As três portas da Etapa 5, contra o banco de verdade.
 *
 * O QUE PROVA
 *   1. CORREÇÃO DE FRETE pós-liberação grava `propostas.categoria_frete`, usa a
 *      declaração do operador onde a derivação não resolve, e deixa a derivação
 *      vencer quando ela resolve;
 *   2. DESPACHO grava `expedicoes.categoria_frete` a partir do que o expedidor
 *      registrou — é assim que o pedido recotado entra na coluna certa sem
 *      ninguém reescrever a proposta;
 *   3. a PRECEDÊNCIA lê as duas colunas na ordem certa depois do despacho.
 *
 * A porta 3 (rota admin da transportadora) NÃO é exercida aqui: ela é uma rota
 * HTTP que exige JWT de usuário. A lógica dela está coberta por asserção pura em
 * `categoria-frete.test.mts`.
 *
 * ESCREVE NO BANCO DE PRODUÇÃO: cria uma proposta de teste e a despacha. Só roda
 * com a trava explícita:
 *
 *   PERMITIR_ESCRITA=1 node --experimental-strip-types \
 *     --import ./scripts/testes/_alias-hook.mjs scripts/testes/categoria-frete-portas.test.mts
 */
import { createClient } from "@supabase/supabase-js";
import { config as carregarEnv } from "dotenv";

if (process.env.PERMITIR_ESCRITA !== "1") {
  console.log("Pulado: defina PERMITIR_ESCRITA=1 (este teste cria e despacha uma proposta real).");
  process.exit(0);
}

carregarEnv({ path: ".env.local", quiet: true });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.log("FALHOU  .env.local sem NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

/**
 * `despachar` e `salvarDadosExpedicao` usam `getSupabaseClient()`, o client do
 * NAVEGADOR, que num script fala como `anon` — e `anon` perdeu tudo na revogação
 * de 01/09. Trocar a chave publica pela de servico ANTES do import faz o mesmo
 * codigo de producao rodar aqui com permissao. Nada no app muda: e so o
 * ambiente deste processo.
 */
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SERVICE;

const { saveProposta } = await import("../../src/features/orcamentos/services/orcamentos.service.ts");
const { confirmarCorrecaoFrete } = await import(
  "../../src/features/expedicao/services/corrigir-frete-gravacao.ts"
);
const { despachar } = await import("../../src/features/expedicao/services/expedicao-acoes.service.ts");
const { categoriaFreteVigente } = await import("../../src/features/orcamentos/lib/categoria-frete.ts");
type PropostaFormState = import("../../src/features/orcamentos/types.ts").PropostaFormState;

const client = createClient(URL, SERVICE, { auth: { persistSession: false } });

/** SVT PROVEDOR LOGISTICO — transportadora sem meio conhecido. */
const ID_TRANSPORTADORA = 808;
const ID_CLIENTE = "8469";
const ID_CONTATO = "4911";
const ID_ENDERECO = "fcd6c97d-7a43-4f30-98f9-878b248a8480";
/** O proprio cliente e o faturado — `compradorId` guarda o uuid de `clientes`. */
const ID_COMPRADOR = "25165027-1ca3-4723-b503-00c78dc71169";
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

async function retratoFinanceiro(): Promise<Map<number, string>> {
  const mapa = new Map<number, string>();
  for (let inicio = 0; ; inicio += 1000) {
    const { data, error } = await client
      .from("propostas")
      .select("id_int, valor_total, valor_frete, status_interno, modalidade_frete")
      .order("id_int", { ascending: true })
      .range(inicio, inicio + 999);
    if (error) throw new Error(`retrato falhou: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const p of data) {
      mapa.set(Number(p.id_int), [p.valor_total, p.valor_frete, p.status_interno, p.modalidade_frete].join("|"));
    }
    if (data.length < 1000) break;
  }
  return mapa;
}

async function categoriaProposta(idInt: number) {
  const { data } = await client.from("propostas").select("categoria_frete").eq("id_int", idInt).single();
  return (data?.categoria_frete as string | null) ?? null;
}

console.log("Retrato financeiro ANTES...");
const antes = await retratoFinanceiro();
console.log(`   ${antes.size} propostas.\n`);

// ── Proposta de teste, FOB com transportadora sem meio conhecido ────────────
const form: PropostaFormState = {
  id_int: "NOVO",
  empresa: "Ideal Biro",
  vendedor: "TESTE AUTOMATIZADO",
  status: "NOVO",
  clienteId: ID_CLIENTE,
  contatoId: ID_CONTATO,
  enderecoId: ID_ENDERECO,
  compradorId: ID_COMPRADOR,
  itens: [],
  deletedProdutoPropostaIds: [],
  pedidosModelos: [],
  fretes: [],
  freteEscolhidoId: "",
  modalidadeFrete: "FOB",
  transporteCategoria: null,
  idTransportadoraCliente: ID_TRANSPORTADORA,
  descontoGeralTipo: "VALOR",
  descontoGeralValor: "0",
  formaPagamento: "A combinar",
  observacoes: "TESTE AUTOMATIZADO — categoria_frete portas (Etapa 5). Pode cancelar.",
  obsTecnica: "",
  isAvulso: true,
  valorProdutosManual: "100,00",
  valorFreteManual: "0,00",
  observacoesFreteManual: "SVT TRANSPORTES",
  clienteNaoCadastrado: false
};

const criacao = await saveProposta(form, client, USER_ID);
if (!criacao.success || !criacao.id_int) {
  console.log(`FALHOU  criacao da proposta de teste: ${criacao.errorMessage}`);
  process.exit(1);
}
const idInt = criacao.id_int;
console.log(`\n>>> proposta de teste criada: id_int ${idInt}\n`);

checar("nasce sem categoria (ninguem declarou)", await categoriaProposta(idInt), null);

// ── PORTA 1: correcao de frete pos-liberacao ────────────────────────────────
await client.from("propostas").update({ status_interno: "EXPEDICAO" }).eq("id_int", idInt);

const ator = { uid: USER_ID, nome: "TESTE", email: "teste@ideal" };

const corrigeComDeclaracao = await confirmarCorrecaoFrete(client, {
  idInt,
  modalidade: "FOB",
  transportadoraId: ID_TRANSPORTADORA,
  temPermissaoEditarPaga: true,
  acaoFinanceira: null,
  categoriaFreteDeclarada: "AEREO",
  chaveEvento: null,
  ator
});
checar("porta 1: correcao aceita", corrigeComDeclaracao.ok, true);
checar("porta 1: declaracao do operador gravada", await categoriaProposta(idInt), "AEREO");

// E agora a derivacao vencendo: corrigido para RETIRA, a modalidade responde
// sozinha e a declaracao anterior nao sobrevive.
const corrigeParaRetira = await confirmarCorrecaoFrete(client, {
  idInt,
  modalidade: "RETIRA",
  transportadoraId: null,
  temPermissaoEditarPaga: true,
  acaoFinanceira: null,
  categoriaFreteDeclarada: "AEREO",
  chaveEvento: null,
  ator
});
checar("porta 1: segunda correcao aceita", corrigeParaRetira.ok, true);
checar("porta 1: derivacao VENCE a declaracao", await categoriaProposta(idInt), "RETIRA");

// ── PORTA 2: despacho grava em expedicoes ───────────────────────────────────
// O pedido foi vendido como retirada e o expedidor despacha por VEPPO — o caso
// da recotacao, em que a transportadora real so aparece aqui.
await client.from("propostas").update({ status_interno: "EXPEDICAO" }).eq("id_int", idInt);
const { data: endereco } = await client
  .from("enderecos")
  .select("id")
  .eq("id_cliente", Number(ID_CLIENTE))
  .limit(1)
  .maybeSingle();

const despacho = await despachar(
  idInt,
  {
    tipoEntrega: "TRANSPORTE",
    modalidadeFrete: "CIF",
    tipoFrete: "TRANSPORTADORA",
    transportadoraNome: "VEPPO",
    idTransportadoraCliente: null,
    pesoKg: 1,
    qtdVolumes: 1,
    tipoVolume: "Caixa",
    idEnderecoEntrega: (endereco?.id as string | undefined) ?? ID_ENDERECO,
    idClienteDestinatarioEtiqueta: null,
    codigoRastreamento: "",
    obsEtiqueta: "",
    nfNumeroManual: ""
  } as Parameters<typeof despachar>[1],
  { uid: USER_ID, nome: "TESTE AUTOMATIZADO" }
);
checar("porta 2: despacho aceito", despacho.success, true);

const { data: exp } = await client
  .from("expedicoes")
  .select("categoria_frete, tipo_frete, transportadora_nome, data_despacho")
  .eq("id_int", idInt)
  .single();

checar("porta 2: expedicoes.categoria_frete derivada do despacho", exp?.categoria_frete, "VEPPO");
checar("porta 2: proposta NAO foi retroalimentada", await categoriaProposta(idInt), "RETIRA");

// ── PRECEDENCIA sobre os dois valores reais ─────────────────────────────────
checar(
  "precedencia: despachado, vence a expedicao",
  categoriaFreteVigente(
    (await categoriaProposta(idInt)) as never,
    exp?.categoria_frete as never,
    Boolean(exp?.data_despacho)
  ),
  "VEPPO"
);
checar(
  "precedencia: se nao estivesse despachado, valeria a proposta",
  categoriaFreteVigente((await categoriaProposta(idInt)) as never, exp?.categoria_frete as never, false),
  "RETIRA"
);

// ── TRAVA ───────────────────────────────────────────────────────────────────
console.log("\nRetrato financeiro DEPOIS...");
const depois = await retratoFinanceiro();
const divergentes: string[] = [];
for (const [id, valorAntes] of antes) {
  if (id === idInt) continue;
  const valorDepois = depois.get(id);
  if (valorDepois === undefined) divergentes.push(`#${id} SUMIU`);
  else if (valorDepois !== valorAntes) divergentes.push(`#${id} ${valorAntes} -> ${valorDepois}`);
}
checar("TRAVA: zero propostas divergentes fora da criada", divergentes.length, 0);
for (const d of divergentes.slice(0, 20)) console.log(`   ${d}`);

console.log(`\n>>> proposta de teste desta rodada: id_int ${idInt}`);
console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
