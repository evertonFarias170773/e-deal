/**
 * O que a tela de NF-e passa a exibir no campo Ambiente.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/ambiente-exibido.test.mts
 *
 * Existe porque o valor sozinho nao basta: "PRODUCAO" nao diz se ja aconteceu.
 * O que se testa aqui e o PAR valor+rotulo, e sobretudo o criterio de "ja
 * transmitida" — que nao pode ser so numero e chave, senao promete "saira em
 * PRODUCAO" para nota que ja saiu e foi rejeitada.
 *
 * SO LEITURA na parte do banco; roda sem PERMITIR_ESCRITA.
 */
import { config as carregarEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  ambienteExibido,
  rotuloAmbiente,
  textoAmbiente,
  jaFoiTransmitida,
  avisoDaPreviaTecnica
} from "../../src/features/nfe/lib/ambiente-exibido.ts";

carregarEnv({ path: ".env.local", quiet: true });

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
const par = (n: Parameters<typeof ambienteExibido>[0], amb: string | null) => {
  const r = ambienteExibido(n, amb);
  return `${rotuloAmbiente(r)} ${textoAmbiente(r)}`;
};

// ── 1. Rascunho: quem responde e a EMPRESA ──────────────────────────────────
const rascunho = { status: "PENDENTE", ambiente: "homologacao", numero_nf: null, chave_nfe: null, tentativas_envio: 0 };
checar("rascunho de empresa em producao — o caso da NFE-21409-001",
  par(rascunho, "producao"), "Sairá em PRODUÇÃO");
checar("rascunho de empresa em homologacao", par(rascunho, "homologacao"), "Sairá em HOMOLOGAÇÃO");
checar("o valor de nascimento da nota NAO manda no rascunho",
  par({ ...rascunho, ambiente: "homologacao" }, "producao"), "Sairá em PRODUÇÃO");

// ── 2. Transmitida: quem responde e o CARIMBO da nota ───────────────────────
checar("autorizada em producao", par({ status: "AUTORIZADA", ambiente: "producao", numero_nf: "48002", tentativas_envio: 1 }, "producao"),
  "Transmitida em PRODUÇÃO");
checar("autorizada em homologacao, empresa hoje em producao — o carimbo vence",
  par({ status: "AUTORIZADA", ambiente: "homologacao", numero_nf: "1002", chave_nfe: "4326...", tentativas_envio: 1 }, "producao"),
  "Transmitida em HOMOLOGAÇÃO");

// ── 3. O CRITERIO: rejeitada NAO tem numero nem chave, e mesmo assim JA SAIU ─
const rejeitada = { status: "ERRO_AUTORIZACAO", ambiente: "homologacao", numero_nf: null, chave_nfe: null, tentativas_envio: 1 };
checar("rejeitada conta como transmitida", jaFoiTransmitida(rejeitada), true);
checar("rejeitada NAO promete 'saira em' — o caso das 4 da E3",
  par(rejeitada, "producao"), "Transmitida em HOMOLOGAÇÃO");
checar("so numero ja basta", jaFoiTransmitida({ status: "PENDENTE", numero_nf: "1" }), true);
checar("so chave ja basta", jaFoiTransmitida({ status: "PENDENTE", chave_nfe: "4326" }), true);
checar("nada disso: nao transmitida", jaFoiTransmitida({ status: "PENDENTE", tentativas_envio: 0 }), false);
// O sinal MAIS FORTE e o status, e foi o teste contra a base que o exigiu:
checar("AUTORIZADA com numero, chave e contador zerados JA SAIU — a NFE-20925-001",
  jaFoiTransmitida({ status: "AUTORIZADA", numero_nf: null, chave_nfe: null, tentativas_envio: 0 }), true);
checar("a 20925 nao promete 'saira em'",
  par({ status: "AUTORIZADA", ambiente: "homologacao", numero_nf: null, chave_nfe: null, tentativas_envio: 0 }, "producao"),
  "Transmitida em HOMOLOGAÇÃO");
checar("status desconhecido cai no lado seguro (nao promete)",
  jaFoiTransmitida({ status: "STATUS_QUE_NINGUEM_CONHECE" }), true);
for (const s of ["RASCUNHO", "PENDENTE", "PRONTA_PARA_ENVIO", "ERRO_VALIDACAO", "BLOQUEADA_VALIDACAO"])
  checar(`${s} conta como NAO transmitida`, jaFoiTransmitida({ status: s }), false);
checar("campos vazios nao contam", jaFoiTransmitida({ status: "PENDENTE", numero_nf: "", chave_nfe: "  ", tentativas_envio: null }), false);

// ── 4. Indeterminado: nao se promete o que nao se sabe ──────────────────────
checar("empresa ainda carregando", par(rascunho, null), "Ambiente —");
checar("empresa sem ambiente definido", par(rascunho, ""), "Ambiente —");
checar("empresa com lixo na coluna", par(rascunho, "qualquer"), "Ambiente —");
checar("transmitida sem carimbo legivel", par({ status: "AUTORIZADA", numero_nf: "1", ambiente: null }, "producao"), "Ambiente —");

// ── 5. O aviso da previa tecnica ────────────────────────────────────────────
const avisoProd = avisoDaPreviaTecnica(ambienteExibido(rascunho, "producao"));
checar("aviso de rascunho em producao avisa que NAO e teste", avisoProd.texto.includes("Não é um teste."), true);
checar("aviso de rascunho em producao diz que ainda nao houve transmissao",
  avisoProd.texto.includes("Ainda NÃO houve transmissão"), true);
checar("aviso de rascunho em producao fala em valor fiscal", avisoProd.texto.includes("terá valor fiscal"), true);
const avisoHom = avisoDaPreviaTecnica(ambienteExibido(rascunho, "homologacao"));
checar("aviso em homologacao diz sem valor fiscal", avisoHom.texto.includes("sem valor fiscal"), true);
const avisoTrans = avisoDaPreviaTecnica(ambienteExibido({ status: "AUTORIZADA", numero_nf: "48002", ambiente: "producao" }, "producao"));
checar("nota transmitida NAO diz mais que nao houve transmissao",
  avisoTrans.texto.includes("Ainda"), false);
checar("nota transmitida diz que ja foi enviada", avisoTrans.texto.includes("já foi enviada"), true);
checar("o texto antigo sumiu de todos os casos",
  [avisoProd, avisoHom, avisoTrans].some((a) => a.texto.includes("ambiente de testes")), false);

// ── 6. Contra a base real ───────────────────────────────────────────────────
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.log("\n(pulando a parte do banco: .env.local sem chaves)");
} else {
  const sb = createClient(URL, SERVICE);
  const { data: emps } = await sb.from("empresas").select("id, empresa, ambiente_nfe");
  const porId = new Map((emps ?? []).map((e) => [e.id, e]));
  const { data: notas } = await sb
    .from("notas_fiscais")
    .select("ref, id_empresa, status, ambiente, numero_nf, chave_nfe, tentativas_envio")
    .order("id_empresa")
    .order("ref");

  const linhas = notas ?? [];
  const rascunhos = linhas.filter((n) => !jaFoiTransmitida(n));
  const enviadas = linhas.filter((n) => jaFoiTransmitida(n));

  console.log(`\n${"=".repeat(84)}\nO QUE A TELA PASSA A EXIBIR — ${rascunhos.length} NAO TRANSMITIDAS\n${"=".repeat(84)}`);
  console.log("empresa                    ref              status             ANTES         DEPOIS");
  for (const n of rascunhos) {
    const e = porId.get(n.id_empresa!);
    const r = ambienteExibido(n, e?.ambiente_nfe);
    console.log(
      `${String(e?.empresa ?? "?").slice(0, 24).padEnd(25)} ${String(n.ref).padEnd(16)} ` +
      `${String(n.status).padEnd(18)} ${String(n.ambiente).toUpperCase().padEnd(13)} ${rotuloAmbiente(r)} ${textoAmbiente(r)}`
    );
  }

  console.log(`\n${"=".repeat(84)}\n${enviadas.length} JA TRANSMITIDAS — o carimbo continua mandando\n${"=".repeat(84)}`);
  for (const n of enviadas) {
    const e = porId.get(n.id_empresa!);
    const r = ambienteExibido(n, e?.ambiente_nfe);
    console.log(
      `${String(e?.empresa ?? "?").slice(0, 24).padEnd(25)} ${String(n.ref).padEnd(16)} ` +
      `${String(n.status).padEnd(18)} ${String(n.ambiente).toUpperCase().padEnd(13)} ${rotuloAmbiente(r)} ${textoAmbiente(r)}`
    );
  }

  checar("nenhuma nota transmitida passa a exibir o ambiente da EMPRESA",
    enviadas.every((n) => {
      const r = ambienteExibido(n, porId.get(n.id_empresa!)?.ambiente_nfe);
      return r.tipo === "TRANSMITIDA_EM" && r.ambiente === String(n.ambiente).toLowerCase();
    }), true);
  checar("nenhuma nota nao transmitida fica sem resposta (todas as empresas tem ambiente)",
    rascunhos.every((n) => ambienteExibido(n, porId.get(n.id_empresa!)?.ambiente_nfe).tipo === "SAIRA_EM"), true);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
