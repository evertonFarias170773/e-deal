/**
 * Teste de ponta a ponta da RECONSULTA DE CNPJ num cadastro que ja existe.
 *
 * O QUE PROVA
 *   1. o endereco marcado PRINCIPAL e SOBRESCRITO com o que a Receita devolveu
 *      — e o unico jeito de corrigir um cadastro que herdou endereco orfao de
 *      outro cliente (ver a investigacao de 26/08/2026);
 *   2. nenhum endereco e APAGADO: o conjunto de ids antes e depois e o mesmo,
 *      exceto por uma criacao quando nao havia principal;
 *   3. enderecos de OUTROS TIPOS (ENTREGA, COBRANCA, FISCAL) ficam byte a byte
 *      identicos;
 *   4. campo que a Receita devolveu VAZIO nao apaga o que estava gravado;
 *   5. `enderecos.obs` fica com a assinatura de quem fez e quando — a unica
 *      trilha possivel, porque `enderecos` nao esta em `audit.config_v2`.
 *
 * PRECISA DO SERVIDOR DE PRODUCAO LOCAL RODANDO, porque a consulta a Receita
 * passa pela rota `/api/cadastros/consultar-documento` — a MESMA que a tela
 * chama, nao uma copia:
 *
 *   npm run dev
 *
 * MODO SECO por padrao: sem `PERMITIR_ESCRITA=1` ele mostra o antes e o que a
 * consulta devolveu, imprime o que SERIA gravado e sai sem tocar no banco.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/reconsulta-cnpj.test.mts [idCliente]
 *
 *   PERMITIR_ESCRITA=1 node --experimental-strip-types \
 *        --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/reconsulta-cnpj.test.mts 663
 *
 * ESCREVE NO BANCO DE PRODUCAO quando a trava esta ligada. E uma CORRECAO real
 * de um cadastro real — nao cria lixo e nao apaga nada.
 *
 * Sai com codigo 1 se algo falhar.
 */
import { createClient } from "@supabase/supabase-js";
import { config as carregarEnv } from "dotenv";
import { montarPreviaReconsulta, formatarEnderecoLinha } from "../../src/features/cadastros/lib/reconsulta-cnpj.ts";
import { aplicarReconsultaCnpj } from "../../src/features/cadastros/services/cadastros.service.ts";
import type { CadastroEndereco } from "../../src/features/cadastros/types.ts";

carregarEnv({ path: ".env.local", quiet: true });

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

if (!URL_SUPABASE || !SERVICE) {
  console.log("FALHOU  .env.local sem NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

/**
 * 663 = EMPRESA BRASILEIRA DE CORREIOS E TELEGRAFOS, cadastrado em 26/08/2026.
 * Caiu num `id_cliente` que ja tinha endereco orfao da importacao de 20/12/2025
 * e ficou com "Rua Geraldo Jose Bernado, 30 — Belo Horizonte/MG", que nao e o
 * endereco deste CNPJ. E um dos 18 cadastros afetados.
 */
const ID_PADRAO = 663;
const idCliente = Number(process.argv[2] || ID_PADRAO);
const vaiEscrever = process.env.PERMITIR_ESCRITA === "1";

const leitor = createClient(URL_SUPABASE, SERVICE, { auth: { persistSession: false } });

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

type LinhaEndereco = {
  id: string;
  id_cliente: number;
  tipo_endereco: string | null;
  cep: string | null;
  endereco: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  obs: string | null;
  data_criacao: string | null;
};

const COLUNAS_ENDERECO =
  "id,id_cliente,tipo_endereco,cep,endereco,numero,complemento,bairro,cidade,uf,obs,data_criacao";

async function lerEnderecos(): Promise<LinhaEndereco[]> {
  const { data, error } = await leitor
    .from("enderecos")
    .select(COLUNAS_ENDERECO)
    .eq("id_cliente", idCliente)
    .order("id");
  if (error) throw new Error(`Erro ao ler enderecos: ${error.message}`);
  return (data ?? []) as LinhaEndereco[];
}

function ehPrincipal(linha: LinhaEndereco): boolean {
  return String(linha.tipo_endereco ?? "").trim().toLowerCase() === "principal";
}

// ── 1. O CADASTRO E O ESTADO ATUAL ──────────────────────────────────────────
const { data: clienteRow, error: erroCliente } = await leitor
  .from("clientes")
  .select("id_cliente,nome,fantasia,documento,tipo_pessoa,data_fundacao,email,email_contato,telefone_fixo,whatsapp_1,whatsapp_2,cidade_uf,ins_estadual,tipo_contribuinte")
  .eq("id_cliente", idCliente)
  .maybeSingle();

if (erroCliente || !clienteRow) {
  console.log(`FALHOU  cliente #${idCliente} nao encontrado. ${erroCliente?.message ?? ""}`);
  process.exit(1);
}

const cliente = clienteRow as Record<string, string | number | null>;
const documento = String(cliente.documento ?? "").replace(/\D/g, "");

if (documento.length !== 14) {
  console.log(`FALHOU  cliente #${idCliente} nao e CNPJ (documento com ${documento.length} digitos). A reconsulta so existe para CNPJ.`);
  process.exit(1);
}

const enderecosAntes = await lerEnderecos();
const principalAntes = enderecosAntes.find(ehPrincipal) ?? null;

console.log("=".repeat(78));
console.log(`CADASTRO  #${idCliente}  ${cliente.nome}`);
console.log(`CNPJ      ${documento}`);
console.log("=".repeat(78));
console.log("\n--- ANTES (o que esta gravado) ---");
console.log(`  enderecos do cliente: ${enderecosAntes.length}`);
for (const linha of enderecosAntes) {
  const marca = ehPrincipal(linha) ? ">> PRINCIPAL" : `   ${linha.tipo_endereco ?? "(sem tipo)"}`;
  console.log(`  ${marca}  ${formatarEnderecoLinha(linha)}`);
  console.log(`               criado em ${linha.data_criacao} | obs: ${linha.obs ?? "(vazia)"}`);
}
if (!principalAntes) console.log("  (nenhum endereco PRINCIPAL — a reconsulta vai CRIAR um)");

// ── 2. A CONSULTA, pela rota real ───────────────────────────────────────────
console.log("\n--- CONSULTA (o que a Receita devolveu) ---");

const resposta = await fetch(`${BASE_URL}/api/cadastros/consultar-documento`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ tipoPessoa: "JURIDICA", documento, idCliente, modo: "reconsulta" })
}).catch((erro) => {
  console.log(`FALHOU  nao foi possivel chamar ${BASE_URL}/api/cadastros/consultar-documento`);
  console.log(`        ${erro instanceof Error ? erro.message : String(erro)}`);
  console.log("        O servidor local esta rodando? (npm run dev)");
  return null;
});

if (!resposta) process.exit(1);

const corpo = await resposta.json().catch(() => null);
if (!resposta.ok || !corpo?.success || !corpo.payload) {
  console.log(`FALHOU  consulta sem payload (HTTP ${resposta.status}): ${corpo?.message ?? ""}`);
  process.exit(1);
}

const payload = corpo.payload;
console.log(`  razao social ....... ${payload.nome}`);
console.log(`  fantasia ........... ${payload.fantasia}`);
console.log(`  cidade/uf .......... ${payload.cidadeUf}`);
console.log(`  ins. estadual ...... ${payload.insEstadual || "(vazia)"}`);
console.log(`  tipo contribuinte .. ${payload.tipoContribuinte}`);
console.log(`  endereco ........... ${payload.enderecoPreparado ? formatarEnderecoLinha(payload.enderecoPreparado) : "(nao devolvido)"}`);

// ── 3. A COMPARACAO — a MESMA funcao que a tela usa no modal ────────────────
const formAtual = {
  nome: String(cliente.nome ?? ""),
  fantasia: String(cliente.fantasia ?? ""),
  dataFundacao: String(cliente.data_fundacao ?? ""),
  email: String(cliente.email ?? ""),
  telefoneFixo: String(cliente.telefone_fixo ?? ""),
  cidadeUf: String(cliente.cidade_uf ?? ""),
  inscricaoEstadual: String(cliente.ins_estadual ?? ""),
  tipoContribuinte: String(cliente.tipo_contribuinte ?? ""),
  enderecos: enderecosAntes.map<CadastroEndereco>((linha) => ({
    id: linha.id,
    tipo: ehPrincipal(linha) ? "principal" : "entrega",
    cep: linha.cep ?? "",
    endereco: linha.endereco ?? "",
    numero: linha.numero ?? "",
    complemento: linha.complemento ?? "",
    bairro: linha.bairro ?? "",
    cidade: linha.cidade ?? "",
    uf: linha.uf ?? "",
    obs: linha.obs ?? ""
  }))
};

const previa = montarPreviaReconsulta(formAtual, payload);

console.log("\n--- COMPARACAO (o que o modal mostraria) ---");
for (const linha of previa.campos) {
  const marca = linha.mudou ? "MUDA " : "igual";
  console.log(`  [${marca}] ${linha.rotulo}: "${linha.atual}"  ->  "${linha.novo}"`);
}
console.log(`  [${previa.enderecoMudou ? "MUDA " : "igual"}] Endereco principal:`);
console.log(`           antes: ${previa.enderecoAtualTexto ?? "(nenhum)"}`);
console.log(`           novo:  ${previa.enderecoNovoTexto ?? "(nao devolvido)"}`);
console.log(`  colunas de clientes no UPDATE: ${JSON.stringify(Object.keys(previa.camposParaGravar))}`);

// A regra 1 vale sempre, escrevendo ou nao: nada que a Receita devolveu vazio
// pode entrar na gravacao.
const gravaVazio = Object.entries(previa.camposParaGravar).filter(([, valor]) => !String(valor ?? "").trim());
checar("nenhum campo vazio entra no UPDATE", gravaVazio, []);

if (!vaiEscrever) {
  console.log("\nMODO SECO: nada foi gravado. Rode com PERMITIR_ESCRITA=1 para aplicar.");
  console.log(falhas === 0 ? "\nTUDO OK (modo seco)" : `\n${falhas} FALHA(S)`);
  process.exitCode = falhas === 0 ? 0 : 1;
} else {
  // ── 4. APLICAR ────────────────────────────────────────────────────────────
  const resultado = await aplicarReconsultaCnpj({
    idCliente,
    campos: previa.camposParaGravar,
    endereco: previa.enderecoParaGravar,
    autor: "Teste automatizado — reconsulta-cnpj.test.mts",
    quandoIso: new Date().toISOString()
  });

  checar("aplicacao concluiu com sucesso", resultado.success, true);
  if (!resultado.success) {
    console.log(`  erro: ${resultado.errorMessage}`);
  }

  // ── 5. DEPOIS ─────────────────────────────────────────────────────────────
  const enderecosDepois = await lerEnderecos();
  const principalDepois = enderecosDepois.find(ehPrincipal) ?? null;

  console.log("\n--- DEPOIS (o que ficou gravado) ---");
  console.log(`  enderecos do cliente: ${enderecosDepois.length}`);
  for (const linha of enderecosDepois) {
    const marca = ehPrincipal(linha) ? ">> PRINCIPAL" : `   ${linha.tipo_endereco ?? "(sem tipo)"}`;
    console.log(`  ${marca}  ${formatarEnderecoLinha(linha)}`);
    console.log(`               obs: ${linha.obs ?? "(vazia)"}`);
  }

  // O principal ficou igual ao que a consulta devolveu.
  checar(
    "endereco PRINCIPAL agora e o da Receita",
    principalDepois ? formatarEnderecoLinha(principalDepois) : null,
    previa.enderecoNovoTexto
  );

  // Nenhuma linha sumiu.
  const idsAntes = enderecosAntes.map((l) => l.id).sort();
  const idsDepois = enderecosDepois.map((l) => l.id).sort();
  const sumiram = idsAntes.filter((id) => !idsDepois.includes(id));
  checar("nenhum endereco foi apagado", sumiram, []);

  // Se havia principal, nao nasceu linha nova; se nao havia, nasceu exatamente uma.
  checar(
    "quantidade de enderecos",
    enderecosDepois.length,
    principalAntes ? enderecosAntes.length : enderecosAntes.length + 1
  );

  // Os outros tipos ficaram intocados, campo a campo.
  const outrosAntes = enderecosAntes.filter((l) => !ehPrincipal(l));
  const outrosDepois = enderecosDepois.filter((l) => !ehPrincipal(l));
  checar(
    "enderecos de outros tipos intocados",
    outrosDepois.map((l) => ({ ...l })),
    outrosAntes.map((l) => ({ ...l }))
  );

  // A assinatura de quem fez e quando.
  const temAssinatura = String(principalDepois?.obs ?? "").includes("reconsulta do CNPJ");
  checar("obs do principal registra quem fez e quando", temAssinatura, true);
  console.log(`  assinatura: ${principalDepois?.obs ?? "(vazia)"}`);

  // Os campos do cadastro que mudaram foram mesmo gravados.
  const { data: depoisCliente } = await leitor
    .from("clientes")
    .select("nome,fantasia,cidade_uf,ins_estadual,tipo_contribuinte,telefone_fixo,email,email_contato,data_fundacao,whatsapp_1,whatsapp_2")
    .eq("id_cliente", idCliente)
    .maybeSingle();
  const gravado = (depoisCliente ?? {}) as Record<string, string | null>;
  for (const [coluna, valor] of Object.entries(previa.camposParaGravar)) {
    checar(`clientes.${coluna} gravado`, String(gravado[coluna] ?? ""), String(valor));
  }

  // A Receita nao conhece WhatsApp: as duas colunas tem de estar como estavam.
  checar("whatsapp_1 preservado", String(gravado.whatsapp_1 ?? ""), String(cliente.whatsapp_1 ?? ""));
  checar("whatsapp_2 preservado", String(gravado.whatsapp_2 ?? ""), String(cliente.whatsapp_2 ?? ""));

  console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
  process.exitCode = falhas === 0 ? 0 : 1;
}
