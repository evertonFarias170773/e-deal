/**
 * A trava de duplicidade que olha o payload.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/ja-autorizada.test.mts
 *
 * Existe porque o valor desta trava esta na PRECISAO nos dois sentidos: deixar
 * passar uma nota ja autorizada custa uma NF-e duplicada na SEFAZ; barrar uma
 * nota legitima trava o faturamento. Por isso as 14 notas reais do banco sao
 * conferidas UMA A UMA, e nao em agregado.
 *
 * SO LEITURA. Nao chama fn_preparar_envio_nfe nem a rota — as duas escrevem.
 */
import { config as carregarEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  detectarNotaJaAutorizada,
  mensagemNotaJaAutorizada
} from "../../src/features/fiscal/services/ja-autorizada.ts";

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

const barra = (p: unknown) => detectarNotaJaAutorizada(p).jaAutorizada;
const regra = (p: unknown) => {
  const d = detectarNotaJaAutorizada(p);
  return d.jaAutorizada ? d.evidencia.regra : null;
};

// ── 1. R1: o envelope se declara autorizado ─────────────────────────────────
checar("status autorizado barra", regra({ status: "autorizado" }), "STATUS_NIVEL_1");
checar("AUTORIZADO em maiuscula tambem", regra({ status: "AUTORIZADO" }), "STATUS_NIVEL_1");
checar("status com espacos tambem", regra({ status: "  autorizado " }), "STATUS_NIVEL_1");

// ── 2. R2: chave no primeiro nivel ──────────────────────────────────────────
checar("chave no nivel 1 barra", regra({ chave_nfe: "4326083341313100015055001..." }), "CHAVE_NIVEL_1");
checar("chave vazia NAO barra", barra({ chave_nfe: "" }), false);
checar("chave so com espacos NAO barra", barra({ chave_nfe: "   " }), false);

// ── 3. R3: o segundo nivel, e a exigencia dos TRES ──────────────────────────
// Esta e a regra do caso real: envelope diz "processando_autorizacao" e o
// protocolo 100 esta escondido um nivel abaixo.
const emCurso = {
  status: "processando_autorizacao",
  protocolo_nota_fiscal: {
    status: "100",
    numero_protocolo: "143260001185119",
    chave_nfe: "43260833413131000150550010000010021636834288"
  },
  requisicao_nota_fiscal: { numero: "1002", serie: "1" }
};
checar("protocolo 100 completo barra — o caso da 20370-002", regra(emCurso), "PROTOCOLO_NIVEL_2");

// O DONO EXIGIU os tres. Estes quatro provam que a exigencia esta de pe:
checar("100 SEM protocolo e SEM chave NAO barra",
  barra({ status: "processando_autorizacao", protocolo_nota_fiscal: { status: "100" } }), false);
checar("100 com chave mas SEM protocolo NAO barra",
  barra({ protocolo_nota_fiscal: { status: "100", chave_nfe: "43260..." } }), false);
checar("100 com protocolo mas SEM chave NAO barra",
  barra({ protocolo_nota_fiscal: { status: "100", numero_protocolo: "1432600" } }), false);
checar("codigo diferente de 100 NAO barra, mesmo completo",
  barra({ protocolo_nota_fiscal: { status: "204", numero_protocolo: "1432600", chave_nfe: "43260..." } }), false);

// ── 4. O QUE NAO PODE SER BARRADO ───────────────────────────────────────────
// Rejeicao precisa continuar reenviavel: e o fluxo de corrigir e mandar de novo.
checar("rejeicao 732 NAO barra",
  barra({ status: "erro_autorizacao", status_sefaz: "732", mensagem_sefaz: "Rejeicao" }), false);
checar("rejeicao 210 NAO barra", barra({ status: "erro_autorizacao", status_sefaz: "210" }), false);
checar("processando puro, sem protocolo, NAO barra", barra({ status: "processando_autorizacao" }), false);
checar("payload nulo NAO barra", barra(null), false);
checar("payload indefinido NAO barra", barra(undefined), false);
checar("objeto vazio NAO barra", barra({}), false);
checar("string solta NAO barra", barra("nao e json"), false);
checar("numero solto NAO barra", barra(42), false);
// O payload de ERRO que sobrescreveu a 20370-002. Nao ha o que detectar nele —
// e a prova de que a sobrescrita apaga a evidencia, nao um defeito da trava.
checar("payload de erro de token NAO barra",
  barra({ codigo: "permissao_negada", mensagem: "Access token invalido" }), false);

// ── 5. Formas de embrulho que a Focus e o n8n usam ──────────────────────────
checar("array com o objeto dentro barra", barra([{ status: "autorizado" }]), true);
checar("JSON em string barra", barra(JSON.stringify({ status: "autorizado" })), true);

// ── 6. A EVIDENCIA, que e o que o operador le ───────────────────────────────
const ev = detectarNotaJaAutorizada(emCurso);
if (!ev.jaAutorizada) {
  falhas += 1;
  console.log("FALHOU  o caso em curso deveria barrar");
} else {
  checar("numero vem de requisicao_nota_fiscal", ev.evidencia.numero, "1002");
  checar("serie vem de requisicao_nota_fiscal", ev.evidencia.serie, "1");
  checar("protocolo vem do nivel 2", ev.evidencia.protocolo, "143260001185119");
  const msg = mensagemNotaJaAutorizada(ev.evidencia);
  checar("a mensagem diz o numero", msg.includes("número 1002"), true);
  checar("a mensagem diz o protocolo", msg.includes("143260001185119"), true);
  checar("a mensagem diz a chave", msg.includes("43260833413131000150550010000010021636834288"), true);
  checar("a mensagem avisa da SEGUNDA NF-e", msg.includes("SEGUNDA NF-e"), true);
  checar("a mensagem explica o nivel 2", msg.includes("protocolo_nota_fiscal"), true);
  checar("a mensagem manda reconciliar, nao emitir", msg.includes("reconciliar"), true);
}
// Numero que chega como number, nao string — a Focus mistura os dois.
const evNum = detectarNotaJaAutorizada({ status: "autorizado", numero: 48002 });
checar("numero numerico vira texto", evNum.jaAutorizada ? evNum.evidencia.numero : null, "48002");

// ── 7. OS 14 PAYLOADS REAIS, UM A UM ────────────────────────────────────────
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.log("\n(pulando a parte do banco: .env.local sem chaves)");
} else {
  const supabase = createClient(URL, SERVICE);
  const { data, error } = await supabase
    .from("notas_fiscais")
    .select("ref, status, numero_nf, chave_nfe, payload_retorno")
    .not("payload_retorno", "is", null)
    .order("ref");

  if (error) {
    falhas += 1;
    console.log(`FALHOU  leitura do banco: ${error.message}`);
  } else {
    const linhas = data ?? [];
    console.log(`\n${linhas.length} payloads gravados, nota a nota:\n`);
    console.log("  ref              status             col.numero  deteccao          esperado");
    console.log("  ---------------  -----------------  ----------  ----------------  --------");

    for (const n of linhas) {
      const d = detectarNotaJaAutorizada(n.payload_retorno);
      // Esperado: barrar toda AUTORIZADA (as 10), liberar as 3 rejeicoes e a
      // RETORNO_FOCUS cujo payload foi sobrescrito por um erro.
      const esperado = n.status === "AUTORIZADA";
      const bate = d.jaAutorizada === esperado;
      if (!bate) falhas += 1;
      console.log(
        `  ${String(n.ref).padEnd(15)}  ${String(n.status).padEnd(17)}  ` +
          `${String(n.numero_nf ?? "-").padEnd(10)}  ` +
          `${(d.jaAutorizada ? d.evidencia.regra : "passa").padEnd(16)}  ` +
          `${esperado ? "BARRA" : "passa"}${bate ? "" : "   <<< DIVERGIU"}`
      );
    }

    const barradas = linhas.filter((n) => detectarNotaJaAutorizada(n.payload_retorno).jaAutorizada);
    checar("as 10 AUTORIZADA sao barradas", barradas.length, 10);
    checar("nenhuma ERRO_AUTORIZACAO e barrada",
      barradas.filter((n) => n.status === "ERRO_AUTORIZACAO").length, 0);

    // O caso que so esta trava pega: AUTORIZADA com as colunas VAZIAS.
    const cegas = barradas.filter((n) => !n.numero_nf && !n.chave_nfe);
    console.log(`\n  Barradas SO pela nova trava (colunas vazias): ${cegas.map((n) => n.ref).join(", ") || "nenhuma"}`);
    checar("a NFE-20925-001 e barrada pela nova trava",
      cegas.some((n) => n.ref === "NFE-20925-001"), true);

    // E o limite honesto: a 20370-002 NAO e pega, porque a prova foi apagada.
    const n002 = linhas.find((n) => n.ref === "NFE-20370-002");
    if (n002) {
      checar("a NFE-20370-002 NAO e pega — a prova dela foi sobrescrita",
        detectarNotaJaAutorizada(n002.payload_retorno).jaAutorizada, false);
    }

    // Nota que nunca foi transmitida nao pode ser barrada: e o fluxo normal.
    const { data: semRetorno } = await supabase
      .from("notas_fiscais")
      .select("ref, status, payload_retorno")
      .is("payload_retorno", null);
    const novas = semRetorno ?? [];
    console.log(`\n  Notas sem payload_retorno (fluxo normal): ${novas.length}`);
    checar("nenhuma nota sem retorno e barrada",
      novas.filter((n) => detectarNotaJaAutorizada(n.payload_retorno).jaAutorizada).length, 0);
  }
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
