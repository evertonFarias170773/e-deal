/**
 * Reenvio de pedido devolvido, fase 1 — o lado da tela (src/features/expedicao/lib/reenvio.ts).
 *
 * Quem decide e o banco (exp_reenviar_pedido, migration 20261022_exp_reenvio_fase1.sql);
 * aqui so o estado "reenvio aberto", o item do menu, os avisos e o texto do erro. NAO TOCA EM BANCO.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/reenvio.test.mts
 */
import {
  agruparReenvios,
  avisosDoReenvio,
  chaveDoReenvio,
  diferencaDoReenvio,
  freteDoEnvioAnterior,
  lerSituacaoDoReenvio,
  lerVereditoRedespacho,
  normalizarModoCobranca,
  opcoesDoTipo,
  podeOferecerReenvio,
  reenvioDoPedido,
  textoDoErroDeReenvio,
  tipoDaOpcao,
  tituloDoFreteDoReenvio,
  valorACobrarDoReenvio,
  type LinhaReenvio
} from "../../src/features/expedicao/lib/reenvio.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${nome}${ok ? "" : `\n        obtido:   ${JSON.stringify(obtido)}\n        esperado: ${JSON.stringify(esperado)}`}`);
}

// Formatos reais: o PostgREST devolve timestamptz com fuso; a data copiada e a mesma coluna.
const DESPACHO_1 = "2026-10-22T11:54:51.652+00:00";
const linha = (ciclo: number, dataAnterior: string): LinhaReenvio => ({
  id_int: 23820,
  ciclo,
  motivo: `Devolvido ${ciclo}`,
  autor_nome: "userteste1",
  criado_em: "2026-10-22T15:00:00+00:00",
  tipo_frete_anterior: "CORREIOS",
  tipo_frete_novo: "CORREIOS",
  data_despacho_anterior: dataAnterior
});

checar("sem linhas: sem reenvio", reenvioDoPedido([], DESPACHO_1), null);
checar("aberto: data de despacho e a copiada", reenvioDoPedido([linha(1, DESPACHO_1)], DESPACHO_1)?.aberto?.ciclo, 1);
checar("aberto mesmo com outro formato do mesmo instante", reenvioDoPedido([linha(1, DESPACHO_1)], "2026-10-22 11:54:51.652+00")?.aberto?.ciclo, 1);
checar("fechado: redespachado (data nova)", reenvioDoPedido([linha(1, DESPACHO_1)], "2026-10-23T09:00:00+00:00"), { ciclos: 1, aberto: null, ultimoFrete: null });
checar("fechado: data de despacho apagada (Voltar status)", reenvioDoPedido([linha(1, DESPACHO_1)], null)?.aberto, null);
checar(
  "dois ciclos: vale o ultimo",
  reenvioDoPedido([linha(1, "2026-10-01T10:00:00+00:00"), linha(2, DESPACHO_1)], DESPACHO_1)?.aberto?.ciclo,
  2
);
checar("dois ciclos: proximo e o 3", (reenvioDoPedido([linha(2, DESPACHO_1), linha(1, "2026-10-01T10:00:00+00:00")], "x")?.ciclos ?? 0) + 1, 3);
checar("agrupar por pedido", [...agruparReenvios([linha(1, DESPACHO_1), { ...linha(1, DESPACHO_1), id_int: "24000" }]).keys()], [23820, 24000]);

const base = { statusInterno: "EM TRANSITO", despachoConfirmado: true, dataEntrega: null, pedidoPrincipal: null, complementos: [] as unknown[] };
checar("item: EM TRANSITO despachado", podeOferecerReenvio(base), true);
checar("item: fora de EM TRANSITO", podeOferecerReenvio({ ...base, statusInterno: "ENTREGUE" }), false);
checar("item: sem despacho", podeOferecerReenvio({ ...base, despachoConfirmado: false }), false);
checar("item: com data de entrega", podeOferecerReenvio({ ...base, dataEntrega: "2026-10-22T10:00:00Z" }), false);
checar("item: complemento", podeOferecerReenvio({ ...base, pedidoPrincipal: { idInt: 1 } }), false);
checar("item: principal com complemento", podeOferecerReenvio({ ...base, complementos: [{}] }), false);

checar("chave do banco", chaveDoReenvio(23820, 2), "REENVIO:23820:2");

const avisosCorreios = avisosDoReenvio({ tipoFreteAtual: "CORREIOS", correiosCodigoObjeto: "AE058913117BR", prepostagemCanceladaEm: null, azulAwb: null });
checar("aviso Correios cita o objeto antigo", avisosCorreios.length === 1 && avisosCorreios[0].includes("AE058913117BR"), true);
checar("sem aviso Correios com prepostagem ja cancelada", avisosDoReenvio({ tipoFreteAtual: "CORREIOS", correiosCodigoObjeto: "AE1BR", prepostagemCanceladaEm: "2026-10-22", azulAwb: null }), []);
const avisoAzul = avisosDoReenvio({ tipoFreteAtual: "TRANSPORTADORA", correiosCodigoObjeto: null, prepostagemCanceladaEm: null, azulAwb: "123" });
checar("aviso Azul: uma AWB por pedido", avisoAzul.length === 1 && avisoAzul[0].includes("123"), true);

// Textos reais devolvidos pela RPC na prova de 22/10/2026 (transacao desfeita).
checar(
  "erro de frete sem o codigo",
  textoDoErroDeReenvio("EXP_REENVIO_FRETE: este endereco ou tipo de envio exige recotar o frete. A diferenca de frete no reenvio sera tratada na fase 2; nada foi gravado."),
  "este endereco ou tipo de envio exige recotar o frete. A diferenca de frete no reenvio sera tratada na fase 2; nada foi gravado."
);
// Texto real da recusa por saldo (prova de 22/10/2026, pedido 23820 com R$ 0,01 a mais, desfeita).
checar(
  "erro de saldo sem o codigo, com a mensagem de exp_saldo_despacho",
  textoDoErroDeReenvio(
    "EXP_REENVIO_SALDO: Despacho bloqueado: falta receber R$ 0,01 deste pedido. O total do pedido é R$ 124,58 e o pago confirmado é R$ 124,57. " +
      "Gere a cobrança da diferença na aba Pagamentos da proposta (ou peça ao administrador para abonar a diferença) e despache depois que o pagamento for confirmado. " +
      "O saldo precisa ser resolvido (cobranca paga ou abono) antes do reenvio; nada foi gravado."
  ).startsWith("Despacho bloqueado: falta receber R$ 0,01 deste pedido."),
  true
);
checar("erro de permissao em portugues", textoDoErroDeReenvio("PERM: sem permissão expedicao.reenvio"), "Você não tem a permissão de reenviar pedido (expedicao.reenvio).");

// -----------------------------------------------------------------------------
// FASE 2B (18/11/2026): frete do reenvio, diferenca e redespacho
// -----------------------------------------------------------------------------
// Opcoes como a rota cotar devolve (formatos reais das consultas gravadas).
const OPCOES = [
  { id: "sedex", transportadora: "Correios SEDEX", servico: "SEDEX", valor: 41, prazo: "2 dias" },
  { id: "azul-exp", transportadora: "Azul Cargo", servico: "AZUL EXPRESSO", valor: 120, prazo: "1 dia" },
  { id: "azul-std", transportadora: "Azul Cargo", servico: "AZUL STANDARD", valor: 95, prazo: "3 dias" },
  { id: "veppo", transportadora: "VEPPO", servico: "VEPPO", valor: 88.5, prazo: "2 dias" },
  { id: "moto", transportadora: "Motoboy", servico: "MOTOBOY", valor: 25, prazo: "hoje" },
  { id: "sm", transportadora: "Transportadora São Miguel", servico: "SÃO MIGUEL", valor: 70, prazo: "4 dias" },
  { id: "retira", transportadora: "Retira no Balcão", servico: "Retirada no local", valor: 0, prazo: "" }
];
checar("tipo da opcao: Azul e transportadora", tipoDaOpcao(OPCOES[1]), "TRANSPORTADORA");
checar("tipo da opcao: SEDEX e Correios", tipoDaOpcao(OPCOES[0]), "CORREIOS");
checar("tipo da opcao: Sao Miguel com acento", tipoDaOpcao(OPCOES[5]), "TRANSPORTADORA");
checar("tipo da opcao: servico sem tipo cai na transportadora", tipoDaOpcao({ servico: "ECONOMICO", transportadora: "Azul Cargo" }), "TRANSPORTADORA");
checar("opcoes de Transportadora, da mais barata", opcoesDoTipo(OPCOES, "TRANSPORTADORA").map((o) => o.id), ["sm", "veppo", "azul-std", "azul-exp"]);
checar("opcoes de Correios", opcoesDoTipo(OPCOES, "CORREIOS").map((o) => o.id), ["sedex"]);
checar("retirada nao entra em nenhum tipo de envio do reenvio", opcoesDoTipo(OPCOES, "MOTOBOY").map((o) => o.id), ["moto"]);

const linha2b = (ciclo: number, extra: Partial<LinhaReenvio>): LinhaReenvio => ({ ...linha(ciclo, DESPACHO_1), ...extra });
checar("frete anterior: sem reenvio vale o da proposta", freteDoEnvioAnterior(null, 40.43), 40.43);
checar(
  "frete anterior: o do ultimo ciclo com frete",
  freteDoEnvioAnterior(reenvioDoPedido([linha2b(1, { frete_novo: "95.00" }), linha2b(2, { frete_novo: null })], "x"), 40.43),
  95
);
checar("diferenca positiva (24552: 40,43 -> 95,00)", diferencaDoReenvio(40.43, 95), { diferenca: 54.57, recusada: false });
checar("diferenca zero", diferencaDoReenvio(40.43, 40.43), { diferenca: 0, recusada: false });
checar("diferenca negativa e recusada", diferencaDoReenvio(40.43, 30), { diferenca: -10.43, recusada: true });
checar("centavos sem erro de ponto flutuante", diferencaDoReenvio(0.1, 0.3).diferenca, 0.2);

const aberto2b = reenvioDoPedido(
  [linha2b(1, { diferenca: "54.57", exige_nota: true, frete_origem: "COTACAO", frete_novo: "95.00" })],
  DESPACHO_1
)?.aberto;
checar("ciclo aberto carrega diferenca, nota e frete decidido", [aberto2b?.diferenca, aberto2b?.exigeNota, aberto2b?.freteDecidido], [54.57, true, true]);
checar(
  "ciclo da fase 1 (sem colunas novas): sem diferenca, sem nota, frete nao decidido",
  [reenvioDoPedido([linha(1, DESPACHO_1)], DESPACHO_1)?.aberto?.diferenca, reenvioDoPedido([linha(1, DESPACHO_1)], DESPACHO_1)?.aberto?.exigeNota, reenvioDoPedido([linha(1, DESPACHO_1)], DESPACHO_1)?.aberto?.freteDecidido],
  [0, false, false]
);
checar("frete TRAVA nao e decidido", reenvioDoPedido([linha2b(1, { frete_origem: "TRAVA" })], DESPACHO_1)?.aberto?.freteDecidido, false);

checar("veredito: sem reenvio", lerVereditoRedespacho({ aberto: false, bloqueia: false, situacao: "SEM_REENVIO" })?.aberto, false);
checar(
  "veredito: falta a nota nova",
  (() => {
    const v = lerVereditoRedespacho({
      aberto: true, bloqueia: true, situacao: "SEM_NOTA_NOVA", ciclo: 1, frete_decidido: true, diferenca: 54.57, exige_nota: true,
      mensagem: "O reenvio 1 trocou o tipo de envio (CORREIOS para TRANSPORTADORA) e exige nota nova: ..."
    });
    return [v?.bloqueia, v?.situacao, v?.ciclo, v?.freteDecidido, v?.diferenca, v?.exigeNota, v?.notaNova];
  })(),
  [true, "SEM_NOTA_NOVA", 1, true, 54.57, true, null]
);
checar(
  "veredito: liberado com a nota",
  lerVereditoRedespacho({ aberto: true, bloqueia: false, situacao: "LIBERADO", nota_nova: { tipo: "NF-e", numero: "41500", em: "2026-11-19T10:00:00+00:00" } })?.notaNova,
  { tipo: "NF-e", numero: "41500" }
);
checar("veredito: lixo vira null", lerVereditoRedespacho(null), null);

const SITUACAO = [
  {
    ciclo: 1, chave: "REENVIO:24552:1", frete_anterior: 40.43, frete_novo: 95, frete_origem: "COTACAO", diferenca: 54.57,
    abono: null, abonado_por: null, pago: 0, pendente: 54.57, exige_nota: true, criado_em: "2026-11-18T19:00:00+00:00",
    cobranca_viva: { id: "11111111-2222-3333-4444-555555555555", id_pagamento: "24552-C", status: "A_RECEBER", valor: 54.57, id_empresa: 3, pix_copia_cola: false }
  }
];
checar(
  "situacao do ciclo: pendente e cobranca viva sem QR",
  (() => {
    const [c] = lerSituacaoDoReenvio(SITUACAO);
    return [c.ciclo, c.pendente, c.cobrancaViva?.idPagamento, c.cobrancaViva?.temPix, c.cobrancaViva?.idEmpresa];
  })(),
  [1, 54.57, "24552-C", false, 3]
);
checar("situacao: resposta que nao e lista vira vazia", lerSituacaoDoReenvio({ erro: true }), []);

checar(
  "erro do gatilho do redespacho sem o codigo",
  textoDoErroDeReenvio("EXP_REDESPACHO_SEM_NOTA_NOVA: O reenvio 1 trocou o tipo de envio (CORREIOS para TRANSPORTADORA) e exige nota nova."),
  "O reenvio 1 trocou o tipo de envio (CORREIOS para TRANSPORTADORA) e exige nota nova."
);
checar(
  "erro de frete menor sem o codigo",
  textoDoErroDeReenvio("EXP_REENVIO_FRETE: o frete novo (R$ 30,00) e menor que o do envio anterior (R$ 40,43).").startsWith("o frete novo (R$ 30,00)"),
  true
);

// --- MODO DE COBRANCA (18/11/2026) -------------------------------------------
// O caso do #24552: SEDEX R$ 40,43 -> Sao Miguel R$ 98,00.
checar("modo DIFERENCA cobra 57,57", valorACobrarDoReenvio("DIFERENCA", 40.43, 98), { valor: 57.57, diferenca: 57.57, recusado: false });
checar("modo CHEIO cobra 98,00", valorACobrarDoReenvio("CHEIO", 40.43, 98), { valor: 98, diferenca: 57.57, recusado: false });
checar("modo SEM_COBRANCA cobra 0", valorACobrarDoReenvio("SEM_COBRANCA", 40.43, 98), { valor: 0, diferenca: 57.57, recusado: false });
checar("frete menor: recusado so na DIFERENCA", valorACobrarDoReenvio("DIFERENCA", 98, 41).recusado, true);
checar("frete menor: CHEIO aceita e cobra o frete novo", valorACobrarDoReenvio("CHEIO", 98, 41), { valor: 41, diferenca: -57, recusado: false });
checar("frete menor: SEM_COBRANCA aceita", valorACobrarDoReenvio("SEM_COBRANCA", 98, 41), { valor: 0, diferenca: -57, recusado: false });
checar("modo vazio/lixo vira DIFERENCA", [normalizarModoCobranca(null), normalizarModoCobranca("x"), normalizarModoCobranca(" cheio ")], ["DIFERENCA", "DIFERENCA", "CHEIO"]);
checar(
  "titulos do quadro da aba Pagamentos",
  [tituloDoFreteDoReenvio("CHEIO"), tituloDoFreteDoReenvio("DIFERENCA"), tituloDoFreteDoReenvio("SEM_COBRANCA")],
  ["Frete do reenvio (valor cheio)", "Diferença de frete do reenvio", "Reenvio sem cobrança"]
);
checar(
  "ciclo aberto: modo e valor a cobrar (sem as colunas novas = DIFERENCA com a diferenca)",
  [
    reenvioDoPedido([linha2b(1, { modo_cobranca: "CHEIO", valor_cobrar: 98 })], DESPACHO_1)?.aberto?.modoCobranca,
    reenvioDoPedido([linha2b(1, { modo_cobranca: "CHEIO", valor_cobrar: 98 })], DESPACHO_1)?.aberto?.valorCobrar,
    reenvioDoPedido([linha2b(1, { diferenca: 54.57 })], DESPACHO_1)?.aberto?.modoCobranca,
    reenvioDoPedido([linha2b(1, { diferenca: 54.57 })], DESPACHO_1)?.aberto?.valorCobrar
  ],
  ["CHEIO", 98, "DIFERENCA", 54.57]
);
checar(
  "situacao: modo, valor a cobrar e transportadora",
  (() => {
    const [c] = lerSituacaoDoReenvio([
      { ...SITUACAO[0], frete_novo: 98, diferenca: 57.57, modo_cobranca: "CHEIO", valor_cobrar: 98, pendente: 98,
        tipo_frete_novo: "TRANSPORTADORA", transportadora: "Transportadora São Miguel", cobranca_viva: null }
    ]);
    return [c.modoCobranca, c.valorCobrar, c.diferenca, c.pendente, c.transportadora, c.tipoFreteNovo];
  })(),
  ["CHEIO", 98, 57.57, 98, "Transportadora São Miguel", "TRANSPORTADORA"]
);
checar(
  "veredito do redespacho: modo e valor a cobrar",
  (() => {
    const v = lerVereditoRedespacho({ aberto: true, bloqueia: true, situacao: "SALDO", modo_cobranca: "SEM_COBRANCA", valor_cobrar: 0, diferenca: 57.57 });
    return [v?.modoCobranca, v?.valorCobrar];
  })(),
  ["SEM_COBRANCA", 0]
);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
if (falhas > 0) process.exit(1);
