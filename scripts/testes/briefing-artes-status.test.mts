/**
 * Status do registro de arte (`pedidos_artes.status`) no salvamento — SEM BANCO.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/briefing-artes-status.test.mts
 *
 * O QUE PROVA (25/09/2026, caso 22714)
 *   O "Salvar alteracoes" da proposta mandava status "AGUARDANDO" fixo junto com
 *   o rascunho da aba Artes e desfazia o "Enviar para arte" (e o "Em Aprovação"
 *   do fluxo da designer). Agora:
 *   A. registro EXISTENTE salvo sem status: o UPDATE nao leva `status`, e o
 *      banco mantem o que tinha;
 *   B. registro NOVO salvo sem status: o INSERT nasce "AGUARDANDO";
 *   C. "Enviar para arte" (ArtesTab) continua gravando "EM ARTE";
 *   D. os tres pontos de salvamento do OrcamentoFormPage nao mandam mais status.
 *
 * O `@/lib/supabase/client` do servico e trocado pelo `_supabase-falso.mts`:
 * nenhuma requisicao sai daqui.
 */
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FALSO = pathToFileURL(path.join(AQUI, "_supabase-falso.mts")).href;

registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@/lib/supabase/client") return { url: FALSO, shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { salvarBriefingArtes } = await import("../../src/features/pedidos/services/pedidos-artes.service.ts");
const { falso } = await import("./_supabase-falso.mts");

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

/** O rascunho que a aba Artes entrega ao formulario (BriefingArtesDraft): sem status. */
const rascunho = {
  nome_evento: "BOLSHOI",
  data_evento: null,
  local_evento: "",
  observacoes: {},
  designer_uid: "00000000-0000-0000-0000-000000000001",
  designer_nome: "Designer",
  arquivos: []
};

const escrita = () => falso.chamadas.find((c) => c.tabela === "pedidos_artes" && (c.op === "update" || c.op === "insert"));

// ── A. registro existente, salvo pelo "Salvar alteracoes" ──────────────────
falso.zerar();
falso.responder("pedidos_artes:select", { data: [{ id: "arte-existente" }], error: null });
falso.responder("pedidos_artes:update", { data: [{ id: "arte-existente", status: "Em Aprovação" }], error: null });
await salvarBriefingArtes(22714, { ...rascunho });
const a = escrita();
checar("A. registro existente: a escrita e UPDATE", a?.op, "update");
checar("A. registro existente: o UPDATE NAO leva status", Object.prototype.hasOwnProperty.call(a?.payload ?? {}, "status"), false);
checar("A. registro existente: o UPDATE e no registro certo", a?.filtros, [["eq", ["id", "arte-existente"]]]);
checar("A. registro existente: o resto do briefing continua sendo salvo", (a?.payload as { nome_evento?: string })?.nome_evento, "BOLSHOI");

// ── B. proposta sem registro de arte ───────────────────────────────────────
falso.zerar();
falso.responder("pedidos_artes:select", { data: [], error: null });
falso.responder("pedidos_artes:insert", { data: [{ id: "arte-nova", status: "AGUARDANDO" }], error: null });
await salvarBriefingArtes(22714, { ...rascunho });
const b = escrita();
checar("B. registro novo: a escrita e INSERT", b?.op, "insert");
checar("B. registro novo: nasce AGUARDANDO", (b?.payload as { status?: string })?.status, "AGUARDANDO");

// ── C. "Enviar para arte" (ArtesTab manda o status) ───────────────────────
falso.zerar();
falso.responder("pedidos_artes:select", { data: [{ id: "arte-existente" }], error: null });
falso.responder("pedidos_artes:update", { data: [{ id: "arte-existente", status: "EM ARTE" }], error: null });
await salvarBriefingArtes(22714, { ...rascunho, status: "EM ARTE" as never });
checar("C. Enviar para arte: o UPDATE grava EM ARTE", (escrita()?.payload as { status?: string })?.status, "EM ARTE");

// ── D. os tres pontos de salvamento do OrcamentoFormPage ──────────────────
const pagina = readFileSync(path.join(AQUI, "../../src/features/orcamentos/OrcamentoFormPage.tsx"), "utf8");
const chamadas = [...pagina.matchAll(/salvarBriefingArtes\(([^;]*?)\)/gs)].map((m) => m[1]);
checar("D. OrcamentoFormPage chama salvarBriefingArtes em 3 pontos", chamadas.length, 3);
checar("D. nenhum dos 3 manda status", chamadas.filter((c) => /status\s*:/.test(c)).length, 0);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
