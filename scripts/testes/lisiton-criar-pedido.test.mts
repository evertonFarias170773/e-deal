/**
 * API da Lisiton: criar pedido (27/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/lisiton-criar-pedido.test.mts
 */
import { readFileSync } from "node:fs";
import { CORES_TRIBAND, PRODUTOS_LISITON, resolverCor, produtoLisiton } from "../../src/features/integracoes/lisiton/catalogo.ts";
import { hashDoPedido, validarCorpo } from "../../src/features/integracoes/lisiton/montar-pedido.server.ts";
import { selecaoDoAvisoPronto } from "../../src/features/expedicao/lib/aviso-pronto-lisiton.ts";
import { idDestinatarioEtiquetaVigente, nomeDestinatarioVigente, telefoneComReserva } from "../../src/features/expedicao/lib/destinatario-etiqueta.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else console.log(`ok      ${nome}`);
}

// Catálogo fechado
checar("seis produtos", PRODUTOS_LISITON.map((p) => p.id), [9000, 9002, 9003, 9004, 201, 202]);
checar("20 cores Triband", CORES_TRIBAND.length, 20);
checar("hospitalar só Branca", [produtoLisiton(201)?.cores, produtoLisiton(202)?.cores], [["Branca"], ["Branca"]]);
const triband = produtoLisiton(9000)!;
checar("cor sem acento e caixa vira o nome exato", resolverCor(triband, "  verde   fluor "), { ok: true, cor: "Verde Flúor" });
for (const cor of ["Azul", "Azul Celeste", "Roxo", "Verde Agua"]) {
  const r = resolverCor(triband, cor);
  checar(`recusa ${cor} com mensagem clara`, !r.ok && r.mensagem.includes("não existe no Vibe") && r.mensagem.includes("Cores aceitas"), true);
}
checar("hospitalar recusa Vermelha", resolverCor(produtoLisiton(202)!, "Vermelha").ok, false);
checar("Jet Band só Branca", produtoLisiton(9002)?.cores, ["Branca"]);
checar("Jet Band aceita branca", resolverCor(produtoLisiton(9002)!, "branca"), { ok: true, cor: "Branca" });
{
  const r = resolverCor(produtoLisiton(9002)!, "Azul Médio");
  checar("Jet Band recusa Azul Médio dizendo que é só Branca", !r.ok && r.mensagem.includes("Jet Band) é só Branca"), true);
}

// Corpo
const base = {
  chave_idempotencia: "pedido-0001",
  cliente: { documento: "418.273.946-92", nome: "Fulano" },
  endereco: { cep: "90010-150", logradouro: "Rua A", numero: "10", bairro: "Centro", cidade: "Porto Alegre", uf: "RS" },
  transportadora: { cnpj: "15.165.312/0001-22" },
  itens: [{ produto: 9000, cores: [{ cor: "Branca", quantidade: 2 }, { cor: "Prata", quantidade: 1 }] }]
};
const ok = validarCorpo(base);
checar("corpo válido: quantidade do item = soma das cores", ok.ok ? ok.itens[0].quantidade : null, 3);
checar("produto fora da lista", (validarCorpo({ ...base, itens: [{ produto: 9001, cores: [{ cor: "Branca", quantidade: 1 }] }] }) as { erro?: string }).erro, "produto_nao_aceito");
checar("cor fora da lista", (validarCorpo({ ...base, itens: [{ produto: 9000, cores: [{ cor: "Roxo", quantidade: 1 }] }] }) as { erro?: string }).erro, "cor_nao_aceita");
checar("CPF inválido", validarCorpo({ ...base, cliente: { documento: "111.111.111-11", nome: "X" } }).ok, false);
checar("sem transportadora", (validarCorpo({ ...base, transportadora: undefined }) as { erro?: string }).erro, "dados_invalidos");
checar("MELHOR_ENVIO no lugar do CNPJ", validarCorpo({ ...base, transportadora: { codigo: "MELHOR_ENVIO" } }).ok, true);
checar("CNPJ e código juntos",
  (validarCorpo({ ...base, transportadora: { cnpj: "15.165.312/0001-22", codigo: "MELHOR_ENVIO" } }) as { erro?: string; status?: number }),
  { ok: false, status: 422, erro: "dados_invalidos", mensagem: 'Informe a transportadora com transportadora.cnpj (14 dígitos) OU transportadora.codigo ("MELHOR_ENVIO" ou "RETIRA"), nunca os dois.' });
checar("transportadora vazia", (validarCorpo({ ...base, transportadora: {} }) as { erro?: string }).erro, "dados_invalidos");
checar("outro código", (validarCorpo({ ...base, transportadora: { codigo: "CORREIOS" } }) as { erro?: string }).erro, "dados_invalidos");
checar("RETIRA no lugar do CNPJ", validarCorpo({ ...base, transportadora: { codigo: "RETIRA" } }).ok, true);
checar("RETIRA com CNPJ junto", (validarCorpo({ ...base, transportadora: { cnpj: "15.165.312/0001-22", codigo: "RETIRA" } }) as { erro?: string }).erro, "dados_invalidos");

// Etiqueta: pagador = cliente = 8469, sem escolha gravada no despacho -> o nome
// sai do recebedor do endereço de entrega, que a API grava com o cliente final.
{
  const idDest = idDestinatarioEtiquetaVigente({ despachoConfirmado: false, idClienteProposta: 8469, idFaturado: 8469, idGravadoNoDespacho: null });
  checar("etiqueta: cadastro lido é a 8469", idDest, 8469);
  checar("etiqueta: nome do cliente final pelo recebedor",
    nomeDestinatarioVigente({ idGravadoNoDespacho: null, idDestinatarioResolvido: idDest, recebedorDoEndereco: "Cliente Prova Lisiton", nomeDoCadastro: "8469 - LISITON DOCUMENTOS SEGUROS LTDA" }),
    "Cliente Prova Lisiton");
}

// Etiqueta do pedido da integração (27/11): o cliente final vence tudo; sem ele, nada muda.
{
  const base8469 = { despachoConfirmado: true, idClienteProposta: 8469, idFaturado: 8469, idGravadoNoDespacho: null };
  checar("integração: cadastro lido é o cliente final", idDestinatarioEtiquetaVigente({ ...base8469, idClienteFinalIntegracao: 70034 }), 70034);
  checar("integração: vence até o pagador trocado", idDestinatarioEtiquetaVigente({ ...base8469, idFaturado: 555, idClienteFinalIntegracao: 70034 }), 70034);
  checar("fora da integração: regra de sempre (pagador)", idDestinatarioEtiquetaVigente({ ...base8469, idFaturado: 555, idClienteFinalIntegracao: null }), 555);
  checar("fora da integração: sem o parâmetro, igual", idDestinatarioEtiquetaVigente({ ...base8469, idFaturado: 555 }), 555);
  checar("integração: nome do cadastro, não o recebedor",
    nomeDestinatarioVigente({ idGravadoNoDespacho: null, idDestinatarioResolvido: 70034, recebedorDoEndereco: "Fulano", nomeDoCadastro: "GRAFICA SEM NOME LTDA", clienteFinalIntegracao: true }),
    "GRAFICA SEM NOME LTDA");
  checar("fora da integração: recebedor como sempre",
    nomeDestinatarioVigente({ idGravadoNoDespacho: null, idDestinatarioResolvido: 14, recebedorDoEndereco: "Fulano", nomeDoCadastro: "Cadastro" }),
    "Fulano");
  checar("telefone: o do cliente final", telefoneComReserva("(62) 8529-2128", "(51) 99110-8552"), "(62) 8529-2128");
  checar("telefone: sem o do cliente final, o da 8469", telefoneComReserva("", "(51) 99110-8552"), "(51) 99110-8552");
  checar("telefone: fora da integração não há reserva", telefoneComReserva("", ""), "");
  const consumidores = [
    "src/features/expedicao/services/etiqueta-viewmodel.service.ts",
    "src/features/expedicao/services/declaracao-viewmodel.service.ts",
    "src/app/api/expedicao/correios/prepostagem/route.ts"
  ].map((f) => readFileSync(f, "utf8"));
  checar("etiqueta, Declaração e prepostagem leem o cliente final",
    consumidores.map((t) => t.includes("idClienteFinalIntegracao: idClienteFinal") && t.includes("clienteFinalIntegracao: idClienteFinal !== null")),
    [true, true, true]);
}
checar("Jet Band Azul Médio no corpo", (validarCorpo({ ...base, itens: [{ produto: 9002, cores: [{ cor: "Azul Médio", quantidade: 1 }] }] }) as { erro?: string }).erro, "cor_nao_aceita");
checar("cor repetida", validarCorpo({ ...base, itens: [{ produto: 9000, cores: [{ cor: "Branca", quantidade: 1 }, { cor: "branca", quantidade: 1 }] }] }).ok, false);
checar("quantidade quebrada", validarCorpo({ ...base, itens: [{ produto: 9000, cores: [{ cor: "Branca", quantidade: 1.5 }] }] }).ok, false);
checar("hash ignora a chave", hashDoPedido(base) === hashDoPedido({ ...base, chave_idempotencia: "outra-chave-1" }), true);
checar("hash muda com o conteúdo", hashDoPedido(base) === hashDoPedido({ ...base, observacao: "x" }), false);

// Aviso de pedido pronto
checar("Lisiton: todas as conversas do pedido",
  selecaoDoAvisoPronto({ idCliente: 8469, conversasDoPedido: ["a", "b"], edgePediuEscolha: false, selecionadasNaTela: [] }), { chatIds: ["a", "b"] });
checar("outro cliente: regra de sempre (principal)",
  selecaoDoAvisoPronto({ idCliente: 14, conversasDoPedido: ["a", "b"], edgePediuEscolha: false, selecionadasNaTela: [] }), undefined);
checar("outro cliente com escolha da tela",
  selecaoDoAvisoPronto({ idCliente: 14, conversasDoPedido: [], edgePediuEscolha: true, selecionadasNaTela: ["c"] }), { chatIds: ["c"] });

// Migration e rotas
const mig = readFileSync("supabase/migrations/20261127_lisiton_api_criar_pedido.sql", "utf8");
checar("migration: só service_role cria pedido; config por função com permissão",
  [
    mig.includes("GRANT EXECUTE ON FUNCTION public.lisiton_criar_pedido(jsonb) TO service_role;"),
    mig.includes("REVOKE ALL ON FUNCTION public.lisiton_criar_pedido(jsonb) FROM PUBLIC, anon, authenticated;"),
    mig.includes("cc__assert_permissao(v_uid, 'config.integracoes')"),
    mig.includes("LISITON_CHAVE_REUSADA")
  ],
  [true, true, true, true]);
const link = readFileSync("src/app/api/v1/parceiro/link-pagamento/[id_int]/route.ts", "utf8");
const mig2 = readFileSync("supabase/migrations/20261127b_lisiton_pagador_lisiton_retira.sql", "utf8");
checar("migration b: pagador 8469, recebedor = cliente final, RETIRA sem transportadora",
  [
    mig2.includes("c_lisiton, c_lisiton, v_id_end"),
    mig2.includes("'Integração Lisiton', v_nome_final)"),
    mig2.includes("v_modal NOT IN ('FOB', 'RETIRA')"),
    mig2.includes("retirada no balcao nao leva transportadora")
  ],
  [true, true, true, true]);
const mig3 = readFileSync("supabase/migrations/20261127c_lisiton_sem_vinculo_cliente_final.sql", "utf8");
const corpo3 = mig3.slice(mig3.indexOf("CREATE OR REPLACE FUNCTION"));
checar("migration c: sem vínculo comercial, nenhum DELETE, resto igual",
  [corpo3.includes("clientes_socios"), /DELETE\s+FROM/i.test(corpo3), corpo3.includes("c_lisiton, c_lisiton, v_id_end"), corpo3.includes("GRANT EXECUTE ON FUNCTION public.lisiton_criar_pedido(jsonb) TO service_role;")],
  [false, false, true, true]);
const mig4 = readFileSync("supabase/migrations/20261127d_lisiton_completa_contato_cliente_final.sql", "utf8");
const corpo4 = mig4.slice(mig4.indexOf("CREATE OR REPLACE FUNCTION"));
const updCliente = corpo4.slice(corpo4.indexOf("UPDATE public.clientes c"), corpo4.indexOf("END IF;", corpo4.indexOf("UPDATE public.clientes c")));
checar("migration d: cadastro existente só completa telefone e e-mail vazios",
  [
    corpo4.includes("IF NOT v_criou_cf THEN"),
    /SET whatsapp_1 = CASE[\s\S]*email = CASE/.test(updCliente),
    /\b(nome|documento|fantasia|cidade_uf|categoria|telefone_fixo)\s*=/.test(updCliente.replace(/c\.\w+/g, "")),
    updCliente.includes("nullif(btrim(coalesce(c.telefone_fixo, '')), '') IS NULL"),
    corpo4.includes("clientes_socios"),
    corpo4.includes("GRANT EXECUTE ON FUNCTION public.lisiton_criar_pedido(jsonb) TO service_role;")
  ],
  [true, true, false, true, false, true]);
checar("link: chave da Lisiton só vê 8469", link.includes("if (soDaLisiton && Number(proposta.id_cliente) !== ID_CLIENTE_LISITON) return naoEncontrado();"), true);
const rota = readFileSync("src/app/api/v1/lisiton/pedidos/route.ts", "utf8");
checar("rota: chave própria e PIX pela função da /p",
  [rota.includes("process.env.LISITON_PEDIDOS_KEY"), rota.includes("iniciarPagamentoAreaCliente(banco, idInt, \"PIX\"")],
  [true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else console.log("\nTudo certo.");
