/**
 * Testes das regras de apresentacao da etiqueta 10x15 e do telefone do
 * destinatario (04/09/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/etiqueta-apresentacao.test.mts
 *
 * 1. `telefoneDestinatario` — o primeiro candidato que E telefone. Nasceu do
 *    pedido 21000: `clientes.whatsapp_1` do pagador guardava o NOME dele, e a
 *    etiqueta imprimiu "Fone: FELIPE FAUTH PROBST".
 *
 * 2. `lib/etiqueta-apresentacao` — as linhas derivadas que o PDF e a previa do
 *    modal Despachar imprimem identicas. Sao puras e rodam nos dois lados.
 */
import { telefoneDestinatario } from "@/features/expedicao/lib/telefone-destinatario";
import {
  idDestinatarioEtiquetaVigente,
  temPagadorDistinto
} from "@/features/expedicao/lib/destinatario-etiqueta";
import {
  LIMITE_OBSERVACAO,
  apresentacaoEtiqueta,
  cortarObservacao,
  separarCidadeUf
} from "@/features/expedicao/lib/etiqueta-apresentacao";
import type { EtiquetaViewModel } from "@/features/expedicao/services/etiqueta-viewmodel.service";
import { contatoParaPayload } from "@/lib/correios/cws";

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

// ── 1. TELEFONE DO DESTINATARIO ─────────────────────────────────────────────
// O caso real do 21000: nome no whatsapp, numero no fixo.
checar("nome no whatsapp cai no fixo", telefoneDestinatario("FELIPE FAUTH PROBST", "5140422222"), "(51) 4042-2222");
checar("whatsapp valido vence o fixo", telefoneDestinatario("51991108552", "51 991107694"), "(51) 99110-8552");
checar("'NULL' e espaco nao sao telefone", telefoneDestinatario("NULL", " "), "");
checar("nulos devolvem vazio", telefoneDestinatario(null, undefined), "");
checar("espaco no whatsapp cai no fixo", telefoneDestinatario(" ", "11 975463797"), "(11) 97546-3797");
checar("DDI 55 passa cru (13 digitos)", telefoneDestinatario("5551991108552", ""), "5551991108552");
checar("fixo sem DDD (8 digitos) e aceito", telefoneDestinatario("", "40422222"), "40422222");
checar("7 digitos nao e telefone", telefoneDestinatario("1234567", null), "");

// ── 2. CIDADE / UF ──────────────────────────────────────────────────────────
checar("hifen", separarCidadeUf("Novo Hamburgo - RS"), { cidade: "Novo Hamburgo", uf: "RS" });
checar("barra", separarCidadeUf("Santarém/PA"), { cidade: "Santarém", uf: "PA" });
checar("espaco", separarCidadeUf("Porto Alegre rs"), { cidade: "Porto Alegre", uf: "RS" });
checar("sem UF", separarCidadeUf("Porto Alegre"), { cidade: "Porto Alegre", uf: "" });
checar("vazio", separarCidadeUf(""), { cidade: "", uf: "" });

// ── 3. OBSERVACAO ───────────────────────────────────────────────────────────
checar("curta passa intacta", cortarObservacao("  PRODUTO FRÁGIL  "), "PRODUTO FRÁGIL");
const longa = Array.from({ length: 40 }, (_, i) => `PALAVRA${i}`).join(" ");
const cortada = cortarObservacao(longa);
checar("longa termina em reticencias", cortada.endsWith("…"), true);
checar("longa cabe no limite", cortada.length <= LIMITE_OBSERVACAO + 1, true);
checar("corte nao parte palavra", longa.startsWith(cortada.slice(0, -1) + " "), true);

// ── 4. LINHAS DERIVADAS — PDF e previa ──────────────────────────────────────
const vmBase: EtiquetaViewModel = {
  idInt: 21000,
  volumes: 1,
  pesoKg: "5,00",
  transportadora: "",
  codigoRastreamento: "",
  obs: "",
  nfNumero: "",
  tipoVolume: "Caixa",
  remetenteRodape: "DSEG BRASIL",
  remetente: {
    nome: "DSEG BRASIL",
    logradouro: "RUA FELIZARDO DE FARIAS, 81",
    bairroCidadeUf: "BAIRRO MEDIANEIRA, Porto Alegre/RS"
  },
  obsEtiqueta: "",
  dataEnvio: "04/09/2026",
  destinatario: {
    nome: "FELIPE FAUTH PROBST",
    recebedor: "",
    endereco: "RUA GUANANAS, 78 - APT 24",
    bairro: "OURO BRANCO",
    cidadeUf: "Novo Hamburgo - RS",
    cep: "",
    documento: "",
    telefone: ""
  }
};

const vazia = apresentacaoEtiqueta(vmBase);
checar("sem NF imprime travessao", vazia.nfExibida, "—");
checar("sem transportadora imprime A DEFINIR", vazia.transportadoraExibida, "A DEFINIR");
checar("sem telefone a linha some", vazia.telefoneLinha, "");
checar("sem observacao o bloco some", vazia.observacaoImpressa, "");
checar("sem CEP imprime travessao", vazia.cepExibido, "—");
checar("cidade/UF em corpo grande", vazia.cidadeUfLinha, "Novo Hamburgo / RS");

const cheia = apresentacaoEtiqueta({
  ...vmBase,
  nfNumero: "21560",
  transportadora: "svt transportes",
  obsEtiqueta: "  produto frágil, retira no aeroporto  ",
  destinatario: { ...vmBase.destinatario, telefone: "(51) 4042-2222", cep: "93320-250" }
});
checar("NF ao lado do pedido", cheia.nfExibida, "21560");
checar("transportadora em caixa alta", cheia.transportadoraExibida, "SVT TRANSPORTES");
checar("linha do telefone", cheia.telefoneLinha, "Fone: (51) 4042-2222");
checar("observacao em caixa alta", cheia.observacaoImpressa, "PRODUTO FRÁGIL, RETIRA NO AEROPORTO");
checar("CEP formatado passa", cheia.cepExibido, "93320-250");

// ── 5. TELEFONE NA PREPOSTAGEM DOS CORREIOS (04/09/2026) ────────────────────
// A rota passou a alimentar `contatoParaPayload` com `telefoneDestinatario`.
// Antes era `whatsapp_1 ?? telefone_fixo`: o primeiro campo PREENCHIDO.
const regraAntiga = (whats: string | null, fixo: string | null) => String(whats ?? fixo ?? "");

checar(
  "antes: nome no whatsapp ia SEM contato (cws descarta o que nao tem digitos)",
  contatoParaPayload(regraAntiga("FELIPE FAUTH PROBST", "5140422222")),
  {}
);
checar(
  "agora: nome no whatsapp cai no fixo e vira dddTelefone/telefone",
  contatoParaPayload(telefoneDestinatario("FELIPE FAUTH PROBST", "5140422222")),
  { dddTelefone: "51", telefone: "40422222" }
);
checar(
  "celular valido vira dddCelular/celular",
  contatoParaPayload(telefoneDestinatario("51991108552", "51 991107694")),
  { dddCelular: "51", celular: "991108552" }
);
checar(
  "fixo formatado pelo helper ainda e aceito pelo cws",
  contatoParaPayload(telefoneDestinatario(" ", "11 975463797")),
  { dddCelular: "11", celular: "975463797" }
);
checar("sem telefone valido continua sem contato", contatoParaPayload(telefoneDestinatario("NULL", " ")), {});
checar("DDI 55 (13 digitos) segue omitido, como antes", contatoParaPayload(telefoneDestinatario("5551991108552", "")), {});

// ── 6. QUEM SAI NA ETIQUETA — regra FIXA desde 04/09/2026 ─────────────────
// O select "Em nome de quem sai a etiqueta" saiu. A regra passou a ser: escolha
// JA GRAVADA vence (sao 21 na base, e as 21 escolheram o pagador); sem escolha,
// o PAGADOR quando existir; nao existindo, o cliente — o unico nome do cadastro.
//
// O DEGRAU DO MEIO CAIU: "pedido ja despachado imprime o cliente". Os testes
// abaixo travam justamente isso — despachado e nao-despachado dao o MESMO nome.
const CLIENTE = 8469;
const PAGADOR = 248;

checar(
  "sem escolha e sem despacho: o pagador",
  idDestinatarioEtiquetaVigente({
    despachoConfirmado: false,
    idClienteProposta: CLIENTE,
    idFaturado: PAGADOR,
    idGravadoNoDespacho: null
  }),
  PAGADOR
);
checar(
  "sem escolha e JA DESPACHADO: o pagador tambem (degrau do meio removido)",
  idDestinatarioEtiquetaVigente({
    despachoConfirmado: true,
    idClienteProposta: CLIENTE,
    idFaturado: PAGADOR,
    idGravadoNoDespacho: null
  }),
  PAGADOR
);
checar(
  "sem pagador distinto: o cliente, o unico nome do cadastro",
  idDestinatarioEtiquetaVigente({
    despachoConfirmado: true,
    idClienteProposta: CLIENTE,
    idFaturado: null,
    idGravadoNoDespacho: null
  }),
  CLIENTE
);
checar(
  "pagador igual ao cliente nao e pagador distinto",
  idDestinatarioEtiquetaVigente({
    despachoConfirmado: false,
    idClienteProposta: CLIENTE,
    idFaturado: CLIENTE,
    idGravadoNoDespacho: null
  }),
  CLIENTE
);
checar(
  "escolha gravada continua vencendo (as 21 da base)",
  idDestinatarioEtiquetaVigente({
    despachoConfirmado: true,
    idClienteProposta: CLIENTE,
    idFaturado: PAGADOR,
    idGravadoNoDespacho: CLIENTE
  }),
  CLIENTE
);
checar(
  "id gravado que nao e cliente nem pagador cai no cliente",
  idDestinatarioEtiquetaVigente({
    despachoConfirmado: false,
    idClienteProposta: CLIENTE,
    idFaturado: PAGADOR,
    idGravadoNoDespacho: 99999
  }),
  CLIENTE
);
checar("temPagadorDistinto: pagador proprio", temPagadorDistinto(CLIENTE, PAGADOR), true);
checar("temPagadorDistinto: sem pagador", temPagadorDistinto(CLIENTE, null), false);
checar("temPagadorDistinto: pagador = cliente", temPagadorDistinto(CLIENTE, CLIENTE), false);

if (falhas > 0) {
  console.log(`\n${falhas} teste(s) falharam.`);
  process.exitCode = 1;
} else {
  console.log("\nTodos os testes passaram.");
}
