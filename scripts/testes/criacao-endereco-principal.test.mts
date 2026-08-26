/**
 * Teste da regra do ENDERECO PRINCIPAL UNICO na CRIACAO de cadastro.
 *
 * O QUE PROVA
 *   Criando um cadastro num `id_cliente` que HOJE tem endereco orfao marcado
 *   PRINCIPAL (dos 346 deixados pela importacao de 20/12/2025):
 *     1. o endereco final e o do cadastro NOVO, nao o herdado;
 *     2. nao sobra linha duplicada — continua UMA linha principal, e e a MESMA
 *        linha (mesmo `id`), sobrescrita, nao uma segunda;
 *     3. `enderecos.obs` fica com a assinatura de quem criou e quando;
 *     4. a regra vale no SERVIDOR: quem aplica e a rota
 *        `/api/cadastros/enderecos`, com o autor tirado da SESSAO, nao do corpo
 *        da requisicao.
 *
 * PRECISA DO SERVIDOR LOCAL RODANDO (`npm run dev`) e das credenciais
 * `USER_TESTE` / `USER_TESTE_SENHA` no `.env.local`.
 *
 * ESCREVE NO BANCO DE PRODUCAO, e por isso so roda com a trava explicita:
 *
 *   PERMITIR_ESCRITA=1 node --experimental-strip-types \
 *     --import ./scripts/testes/_alias-hook.mjs \
 *     scripts/testes/criacao-endereco-principal.test.mts
 *
 * REVERTE TUDO NO FIM: apaga o cadastro de teste que ele mesmo criou e devolve
 * a linha de endereco aos valores exatos de antes (UPDATE, nunca DELETE — o
 * `id` da linha e preservado do inicio ao fim). O banco termina como comecou.
 *
 * Sai com codigo 1 se algo falhar.
 */
import { createClient } from "@supabase/supabase-js";
import { config as carregarEnv } from "dotenv";
import { createCadastro } from "../../src/features/cadastros/services/cadastros.service.ts";
import { formatarEnderecoLinha } from "../../src/features/cadastros/lib/reconsulta-cnpj.ts";

if (process.env.PERMITIR_ESCRITA !== "1") {
  console.log("Pulado: defina PERMITIR_ESCRITA=1 (este teste cria e apaga um cadastro real).");
  process.exit(0);
}

carregarEnv({ path: ".env.local", quiet: true });

const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.USER_TESTE;
const SENHA = process.env.USER_TESTE_SENHA;
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

if (!URL_SUPABASE || !ANON || !SERVICE || !EMAIL || !SENHA) {
  console.log("FALHOU  .env.local sem NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY / USER_TESTE / USER_TESTE_SENHA");
  process.exit(1);
}

/**
 * 53 e um dos 346 `id_cliente` com endereco orfao PRINCIPAL — Cuiaba/MT, da
 * importacao de 20/12/2025. Nao existe cliente com esse numero: e exatamente a
 * armadilha que um operador arma ao digitar "53" no campo ID do cliente.
 */
const ID_ALVO = 53;
/** CNPJ valido de teste, ausente da base — conferido antes de escrever. */
const DOCUMENTO = "19131243000197";
const NOME = "TESTE AUTOMATIZADO — ENDERECO PRINCIPAL UNICO";

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
  recebedor: string | null;
  cpf_recebedor: string | null;
};

const COLUNAS = "id,id_cliente,tipo_endereco,cep,endereco,numero,complemento,bairro,cidade,uf,obs,recebedor,cpf_recebedor";

async function lerEnderecos(): Promise<LinhaEndereco[]> {
  const { data, error } = await leitor.from("enderecos").select(COLUNAS).eq("id_cliente", ID_ALVO).order("id");
  if (error) throw new Error(`Erro ao ler enderecos: ${error.message}`);
  return (data ?? []) as LinhaEndereco[];
}

// ── 0. PRE-CONDICOES ────────────────────────────────────────────────────────
const { data: clienteExistente } = await leitor
  .from("clientes")
  .select("id_cliente,nome")
  .eq("id_cliente", ID_ALVO)
  .maybeSingle();

if (clienteExistente) {
  console.log(`Pulado: o id_cliente ${ID_ALVO} deixou de ser orfao (agora e "${(clienteExistente as { nome?: string }).nome}").`);
  console.log("        Escolha outro id da lista de orfaos e rode de novo.");
  process.exit(0);
}

const antes = await lerEnderecos();
const orfaoAntes = antes.find((l) => String(l.tipo_endereco ?? "").trim().toLowerCase() === "principal");

if (!orfaoAntes) {
  console.log(`Pulado: o id_cliente ${ID_ALVO} nao tem mais endereco principal orfao.`);
  process.exit(0);
}

console.log("=".repeat(78));
console.log(`REGRA DO PRINCIPAL UNICO — criando cadastro no id_cliente ${ID_ALVO}`);
console.log("=".repeat(78));
console.log("\n--- ANTES (endereco orfao, de nenhum cliente) ---");
console.log(`  id da linha: ${orfaoAntes.id}`);
console.log(`  ${orfaoAntes.tipo_endereco}  ${formatarEnderecoLinha(orfaoAntes)}`);
console.log(`  obs: ${orfaoAntes.obs ?? "(vazia)"}`);
console.log(`  total de enderecos nesse id: ${antes.length}`);

// ── 1. SESSAO — o autor sai daqui, nao do corpo da requisicao ───────────────
const autenticador = createClient(URL_SUPABASE, ANON, { auth: { persistSession: false } });
const { data: sessao, error: erroLogin } = await autenticador.auth.signInWithPassword({
  email: EMAIL,
  password: SENHA
});

if (erroLogin || !sessao.session) {
  console.log(`FALHOU  login com USER_TESTE: ${erroLogin?.message ?? "sem sessao"}`);
  process.exit(1);
}
const token = sessao.session.access_token;
console.log(`\n  sessao de ${sessao.user?.email}`);

// ── 2. CRIAR O CADASTRO ─────────────────────────────────────────────────────
const ENDERECO_NOVO = {
  cep: "95700000",
  endereco: "Rua do Cadastro Novo",
  numero: "1000",
  complemento: "Sala 1",
  bairro: "Centro",
  cidade: "Bento Goncalves",
  uf: "RS"
};

let clienteCriado = false;
try {
  const resultado = await createCadastro({
    id_cliente: ID_ALVO,
    nome: NOME,
    fantasia: NOME,
    documento: DOCUMENTO,
    tipo_pessoa: "JURIDICA",
    categoria: "CLIENTE",
    ativo: true,
    restricao: false,
    recebe_email: false,
    recebe_whatsapp: false,
    nota: true,
    verificado: false,
    // `percentual_bunus` e NOT NULL no banco; o formulario sempre manda "0".
    percentual_bunus: "0"
  } as Parameters<typeof createCadastro>[0]);

  checar("cadastro criado", resultado.success, true);
  if (!resultado.success) {
    // `throw`, nao `process.exit`: exit pula o `finally` e deixaria o banco sujo.
    throw new Error(`createCadastro falhou: ${resultado.errorMessage}`);
  }
  clienteCriado = true;

  // ── 3. GRAVAR OS ENDERECOS PELA ROTA — a regra vive no servidor ───────────
  const resposta = await fetch(`${BASE_URL}/api/cadastros/enderecos`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      idCliente: ID_ALVO,
      enderecos: [{ ...ENDERECO_NOVO, tipo_endereco: "PRINCIPAL", obs: null }]
    })
  });

  const corpo = await resposta.json().catch(() => null);
  checar("rota respondeu com sucesso", Boolean(corpo?.success), true);
  if (!corpo?.success) {
    console.log(`  HTTP ${resposta.status}: ${corpo?.message ?? "(sem mensagem)"}`);
  }
  checar("a rota SOBRESCREVEU em vez de criar", corpo?.principalAcao, "sobrescrito");

  // ── 4. DEPOIS ─────────────────────────────────────────────────────────────
  const depois = await lerEnderecos();
  const principalDepois = depois.find((l) => String(l.tipo_endereco ?? "").trim().toLowerCase() === "principal");

  console.log("\n--- DEPOIS (endereco do cadastro novo) ---");
  for (const linha of depois) {
    console.log(`  ${linha.tipo_endereco}  ${formatarEnderecoLinha(linha)}`);
    console.log(`               id: ${linha.id}`);
    console.log(`               obs: ${linha.obs ?? "(vazia)"}`);
  }

  checar(
    "o endereco final e o do cadastro novo",
    principalDepois ? formatarEnderecoLinha(principalDepois) : null,
    formatarEnderecoLinha(ENDERECO_NOVO)
  );
  checar("nao sobrou linha duplicada", depois.length, antes.length);
  checar(
    "e a MESMA linha, sobrescrita (mesmo id)",
    principalDepois?.id,
    orfaoAntes.id
  );
  checar(
    "so existe UM endereco principal",
    depois.filter((l) => String(l.tipo_endereco ?? "").trim().toLowerCase() === "principal").length,
    1
  );
  const assinatura = String(principalDepois?.obs ?? "");
  checar("obs registra a criacao do cadastro", assinatura.includes("criacao do cadastro"), true);
  checar(
    "obs registra o autor tirado da sessao",
    assinatura.includes(String(sessao.user?.email ?? "@@@")),
    true
  );
  console.log(`  assinatura: ${assinatura}`);
} finally {
  // ── 5. REVERTER — o banco tem de terminar como comecou ───────────────────
  console.log("\n--- REVERTENDO ---");

  const { error: erroRestore } = await leitor
    .from("enderecos")
    .update({
      tipo_endereco: orfaoAntes.tipo_endereco,
      cep: orfaoAntes.cep,
      endereco: orfaoAntes.endereco,
      numero: orfaoAntes.numero,
      complemento: orfaoAntes.complemento,
      bairro: orfaoAntes.bairro,
      cidade: orfaoAntes.cidade,
      uf: orfaoAntes.uf,
      obs: orfaoAntes.obs,
      recebedor: orfaoAntes.recebedor,
      cpf_recebedor: orfaoAntes.cpf_recebedor
    })
    .eq("id", orfaoAntes.id);
  checar("endereco restaurado ao estado original", erroRestore?.message ?? null, null);

  if (clienteCriado) {
    // O cadastro de teste sai; a linha de endereco FICA (volta a ser orfa, como
    // era). Nenhum endereco e apagado em momento algum.
    const { error: erroDelete } = await leitor.from("clientes").delete().eq("id_cliente", ID_ALVO).eq("documento", DOCUMENTO);
    checar("cadastro de teste removido", erroDelete?.message ?? null, null);
  }

  const final = await lerEnderecos();
  checar(
    "estado final identico ao inicial",
    final.map((l) => ({ ...l })),
    antes.map((l) => ({ ...l }))
  );

  console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
  process.exitCode = falhas === 0 ? 0 : 1;
}
