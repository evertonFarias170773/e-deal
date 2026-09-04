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
import { pareceTelefone, telefoneDestinatario } from "@/features/expedicao/lib/telefone-destinatario";
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
    nomeCadastro: "E3 Brindes",
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
    telefone: "",
    telefoneCadastro: ""
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

// ── 6. TELEFONE EDITADO NA EXPEDICAO (`expedicoes.telefone_etiqueta`) ──────
// A precedencia que os consumidores aplicam e a MESMA funcao, com o editado
// como primeiro candidato: `telefoneDestinatario(editado, whatsapp_1, fixo)`.
// NULL segue o cadastro; preenchido (e valido) vence — na 10x15, na previa, na
// conferencia e na prepostagem gerada depois.
checar(
  "telefone_etiqueta preenchido vence o cadastro",
  telefoneDestinatario("(51) 3333-4444", "51991108552", "5140422222"),
  "(51) 3333-4444"
);
checar(
  "telefone_etiqueta nulo segue o cadastro",
  telefoneDestinatario(null, "51991108552", "5140422222"),
  "(51) 99110-8552"
);
checar(
  "telefone_etiqueta vazio segue o cadastro (e o nome no whatsapp cai no fixo)",
  telefoneDestinatario("", "FELIPE FAUTH PROBST", "5140422222"),
  "(51) 4042-2222"
);
checar(
  "editado sem digitos suficientes nao vence — o modal nem deixa gravar assim",
  telefoneDestinatario("ramal 12", "51991108552", null),
  "(51) 99110-8552"
);
checar(
  "preenchido vence tambem na prepostagem",
  contatoParaPayload(telefoneDestinatario("51 3333-4444", "51991108552", null)),
  { dddTelefone: "51", telefone: "33334444" }
);

// ── 7. `pareceTelefone` — a guarda que o modal usa para RECUSAR a gravacao ──
// Vazio/nulo e FALSE, mas nao e erro: e "nao ha telefone editado", e o modal
// grava NULL (segue o cadastro). Erro e texto COM conteudo que nao e telefone.
checar("celular com DDD e telefone", pareceTelefone("(51) 99110-8552"), true);
checar("fixo sem DDD (8 digitos) e telefone", pareceTelefone("40422222"), true);
checar("DDI 55 e telefone (13 digitos)", pareceTelefone("5551991108552"), true);
checar("nome nao e telefone", pareceTelefone("FELIPE FAUTH PROBST"), false);
checar("'ramal 12' nao e telefone", pareceTelefone("ramal 12"), false);
checar("vazio nao e telefone", pareceTelefone(""), false);
checar("nulo nao e telefone", pareceTelefone(null), false);
checar("7 digitos nao bastam", pareceTelefone("123-4567"), false);
// A coerencia entre as duas: o que `pareceTelefone` recusa, `telefoneDestinatario`
// tambem pula. Se divergissem, o modal barraria um valor que a leitura aceitaria.
for (const amostra of ["(51) 99110-8552", "40422222", "5551991108552", "FELIPE", "ramal 12", "", "123-4567"]) {
  checar(
    `coerencia pareceTelefone x telefoneDestinatario: ${JSON.stringify(amostra)}`,
    telefoneDestinatario(amostra) !== "",
    pareceTelefone(amostra)
  );
}

// ── 8. O QUE O MODAL GRAVA: `undefined` = NAO MEXA ─────────────────────────
// Regra do campo (`telefoneEtiquetaParaGravar`) e do upsert de `despachar`:
// sem edicao a coluna nao entra no UPDATE, senao um modal aberto so para
// corrigir a observacao apagaria o telefone ja gravado.
const paraGravar = (estado: string | null) => (estado === null ? undefined : estado.trim());
const entraNoUpsert = (v: string | undefined) => (v !== undefined ? { telefone_etiqueta: v.trim() || null } : {});

checar("nao editado nao entra no upsert", entraNoUpsert(paraGravar(null)), {});
checar("editado entra com o valor", entraNoUpsert(paraGravar(" (51) 3333-4444 ")), { telefone_etiqueta: "(51) 3333-4444" });
checar("limpado entra como NULL (volta ao cadastro)", entraNoUpsert(paraGravar("")), { telefone_etiqueta: null });
checar("so espacos tambem volta ao cadastro", entraNoUpsert(paraGravar("   ")), { telefone_etiqueta: null });

// ── 9. O QUE A PREVIA MOSTRA ───────────────────────────────────────────────
// Sem edicao vale o telefone que o SERVIDOR resolveu (ja inclui o gravado);
// com edicao, o cliente sobrepoe pela mesma funcao. Recalcular sempre a partir
// da tela mostraria o cadastro num pedido que tem telefone gravado — a previa
// diria uma coisa e o PDF imprimiria outra.
const previaTelefone = (estado: string | null, doServidor: string, doCadastro: string) =>
  estado === null ? doServidor : telefoneDestinatario(estado, doCadastro);

checar(
  "sem edicao: mostra o resolvido pelo servidor (gravado)",
  previaTelefone(null, "(51) 3333-4444", "(62) 3281-9109"),
  "(51) 3333-4444"
);
checar(
  "sem edicao e sem gravado: mostra o cadastro",
  previaTelefone(null, "(62) 3281-9109", "(62) 3281-9109"),
  "(62) 3281-9109"
);
checar(
  "editando: mostra o que esta sendo digitado",
  previaTelefone("(11) 4002-8922", "(51) 3333-4444", "(62) 3281-9109"),
  "(11) 4002-8922"
);
checar(
  "limpou o campo: volta ao cadastro, nao ao gravado",
  previaTelefone("", "(51) 3333-4444", "(62) 3281-9109"),
  "(62) 3281-9109"
);

if (falhas > 0) {
  console.log(`\n${falhas} teste(s) falharam.`);
  process.exitCode = 1;
} else {
  console.log("\nTodos os testes passaram.");
}
