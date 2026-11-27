/**
 * API da Lisiton: criar pedido (27/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/lisiton-criar-pedido.test.mts
 */
import { readFileSync } from "node:fs";
import { CORES_TRIBAND, PRODUTOS_LISITON, resolverCor, produtoLisiton } from "../../src/features/integracoes/lisiton/catalogo.ts";
import { hashDoPedido, validarCorpo } from "../../src/features/integracoes/lisiton/montar-pedido.server.ts";
import { selecaoDoAvisoPronto } from "../../src/features/expedicao/lib/aviso-pronto-lisiton.ts";

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
checar("sem transportadora", validarCorpo({ ...base, transportadora: undefined }).ok, false);
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
checar("link: chave da Lisiton só vê 8469", link.includes("if (soDaLisiton && Number(proposta.id_cliente) !== ID_CLIENTE_LISITON) return naoEncontrado();"), true);
const rota = readFileSync("src/app/api/v1/lisiton/pedidos/route.ts", "utf8");
checar("rota: chave própria e PIX pela função da /p",
  [rota.includes("process.env.LISITON_PEDIDOS_KEY"), rota.includes("iniciarPagamentoAreaCliente(banco, idInt, \"PIX\"")],
  [true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else console.log("\nTudo certo.");
