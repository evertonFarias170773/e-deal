/**
 * Endereço de entrega gravado pelo orçamento (09/10/2026, pedido 23320).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/endereco-entrega-proposta.test.mts
 *
 * O "Salvar endereço" do orçamento fazia UPDATE no endereço vinculado, que por
 * padrão é o PRINCIPAL do cliente — o fiscal, de onde sai o destinatário da
 * NF-e. A NFE-23320-001 foi autorizada para o endereço de entrega.
 *
 * O QUE PROVA (sem banco: um `enderecos` em memória que aplica os filtros e
 * imita o gatilho BEFORE INSERT, que troca o recebedor pelo do cliente)
 *   1. vinculado PRINCIPAL: cria um ENTREGA novo e não toca no principal;
 *   2. vinculado ENTREGA: edita a própria linha;
 *   3. dados iguais a um ENTREGA do mesmo cadastro: reutiliza, não duplica;
 *   4. a função de UPDATE recusa linha PRINCIPAL, com a mensagem combinada;
 *   5. o tipo PRINCIPAL nunca é criado nem gravado pelo orçamento;
 *   6. único endereço do cadastro é tratado como o principal;
 *   7. nada digitado de diferente: nenhuma escrita.
 */
import {
  MENSAGEM_PRINCIPAL_SO_NO_CADASTRO,
  atualizarEnderecoDoOrcamento,
  decidirGravacaoDoEndereco,
  ehTipoPrincipal,
  inserirEnderecoDoOrcamento,
  mesmoLocal,
  salvarEnderecoDeEntrega,
  tipoQueOOrcamentoGrava,
  type EnderecoDigitado,
  type LinhaEndereco
} from "../../src/features/orcamentos/lib/endereco-entrega-proposta.ts";

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

// ── `enderecos` em memória ──────────────────────────────────────────────────
type Escrita = { op: "insert" | "update"; id: string; payload: Record<string, unknown> };

function bancoFalso(linhasIniciais: LinhaEndereco[]) {
  const linhas: LinhaEndereco[] = linhasIniciais.map((l) => ({ ...l }));
  const escritas: Escrita[] = [];
  let sequencia = 0;

  const from = (tabela: string) => {
    if (tabela !== "enderecos") throw new Error(`tabela inesperada: ${tabela}`);
    let op: "select" | "insert" | "update" = "select";
    let payload: Record<string, unknown> = {};
    const filtros: ((l: LinhaEndereco) => boolean)[] = [];

    const executar = (): LinhaEndereco[] => {
      if (op === "insert") {
        sequencia += 1;
        // O gatilho BEFORE INSERT do banco: recebedor, documento e IE do cliente.
        const nova = { ...(payload as LinhaEndereco), id: `novo-${sequencia}`, recebedor: "CLIENTE LTDA", cpf_recebedor: "11222333000181", ie_recebedor: null };
        linhas.push(nova);
        escritas.push({ op: "insert", id: nova.id, payload });
        return [nova];
      }
      const alvo = linhas.filter((l) => filtros.every((f) => f(l)));
      if (op === "update") {
        alvo.forEach((l) => {
          Object.assign(l, payload);
          escritas.push({ op: "update", id: l.id, payload });
        });
      }
      return alvo.map((l) => ({ ...l }));
    };

    const b: Record<string, unknown> = {
      select: () => b,
      insert: (p: Record<string, unknown>[]) => { op = "insert"; payload = p[0]; return b; },
      update: (p: Record<string, unknown>) => { op = "update"; payload = p; return b; },
      eq: (coluna: keyof LinhaEndereco, valor: unknown) => { filtros.push((l) => l[coluna] === valor); return b; },
      or: (texto: string) => {
        if (texto !== "tipo_endereco.is.null,tipo_endereco.not.ilike.*principal*") throw new Error(`filtro inesperado: ${texto}`);
        filtros.push((l) => l.tipo_endereco == null || !/principal/i.test(l.tipo_endereco));
        return b;
      },
      maybeSingle: async () => ({ data: executar()[0] ?? null, error: null }),
      single: async () => ({ data: executar()[0] ?? null, error: null }),
      then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: executar(), error: null }).then(ok)
    };
    return b;
  };

  return { client: { from } as never, linhas, escritas };
}

const linha = (mudanca: Partial<LinhaEndereco>): LinhaEndereco => ({
  id: "x", id_cliente: 100, cep: "88306773", endereco: "Rua das Flores", numero: "3385", complemento: null,
  bairro: "Centro", cidade: "Itajaí", uf: "SC", tipo_endereco: "PRINCIPAL",
  recebedor: "CLIENTE LTDA", cpf_recebedor: "11222333000181", ie_recebedor: null, ...mudanca
});

const principal = linha({ id: "principal" });
const entregaAntiga = linha({ id: "entrega-1", tipo_endereco: "ENTREGA", cep: "90240480", endereco: "Av. Brasil", numero: "50", cidade: "Porto Alegre", uf: "RS", bairro: "Navegantes" });

/** O que o vendedor digita: a entrega em outra cidade (o caso do 23320). */
const digitado: EnderecoDigitado = {
  tipo: "principal", cep: "91110-580", endereco: "Rua Nova", numero: "1800", complemento: "Sala 2",
  bairro: "Sarandi", cidade: "Porto Alegre", uf: "RS", recebedor: "Fulano Recebedor", cpfRecebedor: "12345678909", ieRecebedor: ""
};

// ── Regras puras ────────────────────────────────────────────────────────────
checar("grafias de principal", ["PRINCIPAL", "principal", " Principal ", "ENTREGA", null, ""].map(ehTipoPrincipal), [true, true, true, false, false, false]);
checar("tipo que o orcamento grava",
  ["entrega", "Entrega", "cobranca", "cobrança", "fiscal", "", undefined, "principal", "PRINCIPAL"].map((t) => tipoQueOOrcamentoGrava(t)),
  ["ENTREGA", "ENTREGA", "COBRANCA", "COBRANCA", "FISCAL", "ENTREGA", "ENTREGA", null, null]);
checar("mesmo local ignora mascara, acento e caixa",
  mesmoLocal({ cep: "91110-580", endereco: "Rua São João", numero: " 1800 ", complemento: "" }, { cep: "91110580", endereco: "RUA SAO JOAO", numero: "1800", complemento: null }), true);
checar("complemento diferente nao e o mesmo local",
  mesmoLocal({ cep: "91110580", endereco: "Rua A", numero: "1", complemento: "Sala 2" }, { cep: "91110580", endereco: "Rua A", numero: "1", complemento: "Sala 5" }), false);
checar("decisao: principal com dados novos cria", decidirGravacaoDoEndereco(principal, [principal, entregaAntiga], digitado), { acao: "criar" });
checar("decisao: entrega com outro endereco no cadastro edita", decidirGravacaoDoEndereco(entregaAntiga, [principal, entregaAntiga], digitado), { acao: "editar" });

// ── 1. Vinculado PRINCIPAL: cria ENTREGA, principal intacto ─────────────────
{
  const banco = bancoFalso([principal, entregaAntiga]);
  const r = await salvarEnderecoDeEntrega(banco.client, "principal", digitado);
  checar("1. resultado", [r.success, r.acao, r.data?.tipo, r.data?.cidade], [true, "criado", "entrega", "Porto Alegre"]);
  checar("1. o principal nao foi tocado", banco.linhas.find((l) => l.id === "principal"), principal);
  checar("1. nenhuma escrita no principal", banco.escritas.filter((e) => e.id === "principal").length, 0);
  const insert = banco.escritas.find((e) => e.op === "insert");
  checar("1. o novo nasce ENTREGA, no mesmo cadastro", [insert?.payload.tipo_endereco, insert?.payload.id_cliente, insert?.payload.cep], ["ENTREGA", 100, "91110-580"]);
  checar("1. o recebedor digitado sobrevive ao gatilho", [r.data?.recebedor, r.data?.cpfRecebedor], ["Fulano Recebedor", "12345678909"]);
  checar("1. o id devolvido e o do endereco novo", r.data?.id !== "principal" && banco.linhas.some((l) => l.id === r.data?.id), true);
}

// ── 2. Vinculado ENTREGA: edita ─────────────────────────────────────────────
{
  const banco = bancoFalso([principal, entregaAntiga]);
  const r = await salvarEnderecoDeEntrega(banco.client, "entrega-1", { ...digitado, tipo: "entrega" });
  checar("2. resultado", [r.success, r.acao, r.data?.id, r.data?.cep], [true, "editado", "entrega-1", "91110-580"]);
  checar("2. so um UPDATE, na propria linha", banco.escritas.map((e) => [e.op, e.id]), [["update", "entrega-1"]]);
  checar("2. tipo gravado em maiusculas", banco.escritas[0].payload.tipo_endereco, "ENTREGA");
  checar("2. nenhuma linha nova", banco.linhas.length, 2);
}

// ── 3. Igual a um ENTREGA existente: reutiliza ──────────────────────────────
{
  const igual = linha({ id: "entrega-2", tipo_endereco: "entrega", cep: "91110580", endereco: "RUA NOVA", numero: "1800", complemento: "sala 2", cidade: "Porto Alegre", uf: "RS", bairro: "Sarandi", recebedor: "Fulano Recebedor", cpf_recebedor: "12345678909" });
  const banco = bancoFalso([principal, entregaAntiga, igual]);
  const r = await salvarEnderecoDeEntrega(banco.client, "principal", digitado);
  checar("3. resultado", [r.success, r.acao, r.data?.id], [true, "reutilizado", "entrega-2"]);
  checar("3. nenhuma escrita, nenhuma linha nova", [banco.escritas.length, banco.linhas.length], [0, 3]);

  const outroRecebedor = bancoFalso([principal, { ...igual, recebedor: "Outro", cpf_recebedor: "00000000000" }]);
  const r2 = await salvarEnderecoDeEntrega(outroRecebedor.client, "principal", digitado);
  checar("3. recebedor diferente: so o recebedor do ENTREGA e regravado",
    [r2.acao, outroRecebedor.escritas.map((e) => [e.op, e.id, Object.keys(e.payload).sort().join(",")])],
    ["reutilizado", [["update", "entrega-2", "cpf_recebedor,ie_recebedor,recebedor"]]]);
  checar("3. o principal segue intacto", outroRecebedor.linhas.find((l) => l.id === "principal"), principal);
}

// ── 4. A funcao de UPDATE recusa PRINCIPAL ──────────────────────────────────
{
  const banco = bancoFalso([principal, linha({ id: "minusculo", tipo_endereco: "principal" })]);
  const r = await atualizarEnderecoDoOrcamento(banco.client, "principal", { ...digitado, tipo: "entrega" });
  checar("4. linha PRINCIPAL: recusado com a mensagem", [r.success, r.errorMessage], [false, MENSAGEM_PRINCIPAL_SO_NO_CADASTRO]);
  const r2 = await atualizarEnderecoDoOrcamento(banco.client, "minusculo", { ...digitado, tipo: "entrega" });
  checar("4. linha 'principal' em minusculas: recusado", [r2.success, r2.errorMessage], [false, MENSAGEM_PRINCIPAL_SO_NO_CADASTRO]);
  checar("4. nenhuma escrita", banco.escritas.length, 0);
  checar("4. a mensagem", MENSAGEM_PRINCIPAL_SO_NO_CADASTRO, "O endereço principal é o fiscal e só se altera no cadastro do cliente.");
}

// ── 5. PRINCIPAL nunca e criado nem gravado ─────────────────────────────────
{
  const banco = bancoFalso([principal, entregaAntiga]);
  const r = await inserirEnderecoDoOrcamento(banco.client, { ...digitado, tipo: "principal", id_cliente: 100 });
  checar("5. INSERT de principal: recusado", [r.success, r.errorMessage, banco.escritas.length], [false, MENSAGEM_PRINCIPAL_SO_NO_CADASTRO, 0]);
  const r2 = await atualizarEnderecoDoOrcamento(banco.client, "entrega-1", { ...digitado, tipo: "principal" });
  checar("5. reclassificar um ENTREGA como principal: recusado", [r2.success, banco.escritas.length], [false, 0]);
  const r3 = await inserirEnderecoDoOrcamento(banco.client, { ...digitado, tipo: "entrega", id_cliente: 100 });
  checar("5. INSERT comum grava ENTREGA em maiusculas", [r3.success, banco.escritas[0].payload.tipo_endereco], [true, "ENTREGA"]);
  checar("5. em todo o arquivo, nenhuma escrita com tipo principal",
    banco.escritas.some((e) => /principal/i.test(String(e.payload.tipo_endereco ?? ""))), false);
}

// ── 6. Unico endereco do cadastro e tratado como o principal ────────────────
{
  const unico = linha({ id: "unico", tipo_endereco: "ENTREGA" });
  const banco = bancoFalso([unico]);
  const r = await salvarEnderecoDeEntrega(banco.client, "unico", { ...digitado, tipo: "entrega" });
  checar("6. cria outro em vez de editar o unico", [r.acao, banco.linhas.length, banco.escritas.filter((e) => e.id === "unico").length], ["criado", 2, 0]);
}

// ── 7. Nada mudou: nenhuma escrita ──────────────────────────────────────────
{
  const banco = bancoFalso([principal, entregaAntiga]);
  const r = await salvarEnderecoDeEntrega(banco.client, "principal", {
    tipo: "principal", cep: "88306-773", endereco: "rua das flores", numero: "3385", complemento: "",
    bairro: "Centro", cidade: "Itajai", uf: "SC", recebedor: "Cliente Ltda", cpfRecebedor: "11.222.333/0001-81", ieRecebedor: ""
  });
  checar("7. sem mudanca", [r.success, r.acao, r.data?.id, banco.escritas.length], [true, "sem_mudanca", "principal", 0]);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
