/**
 * Testes da classificação de eventos dos Correios.
 *
 * O projeto não tem runner; este arquivo roda sozinho pelo Node:
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/correios-eventos.test.mts
 *
 * Sai com código 1 se algo falhar. Rode depois de mexer em
 * src/lib/correios/eventos.ts — as mesmas listas decidem o botão "marcar
 * ENTREGUE" na tela e a mudança automática de status_interno pelo webhook.
 *
 * O caso que motivou o teste: o SRO devolve o tipo com zero à esquerda
 * (`"tipo": "01"`) e o webhook, sem (`BDE-1`). Sem normalizar, uma entrega real
 * vinda da consulta não seria reconhecida e o botão nunca apareceria.
 */
import {
  chaveEvento,
  eventoEhEntrega,
  eventoEhTransito,
  separarTipoEvento
} from "../../src/lib/correios/eventos.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas++;
    console.error(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}

// ── chaveEvento: normalização das duas origens ──────────────────────────────
checar("SRO manda tipo com zero à esquerda", chaveEvento("BDE", "01"), "BDE-1");
checar("webhook manda tipo sem zero", chaveEvento("BDE", "1"), "BDE-1");
checar("tipo numérico também vale", chaveEvento("PO", 9), "PO-9");
checar("código em minúscula é normalizado", chaveEvento("bde", "01"), "BDE-1");
checar("tipo 0 não vira vazio", chaveEvento("CMT", "0"), "CMT-0");
checar("sem código não forma chave", chaveEvento("", "1"), "");
checar("sem tipo não forma chave", chaveEvento("BDE", ""), "");
checar("tipo não numérico fica como veio", chaveEvento("XX", "AB"), "XX-AB");

// ── entrega ────────────────────────────────────────────────────────────────
checar("BDE-1 é entrega", eventoEhEntrega("BDE", "01"), true);
checar("BDI-67 é entrega", eventoEhEntrega("BDI", "67"), true);
checar("BDR-70 é entrega", eventoEhEntrega("BDR", "70"), true);
// Este é o evento real da prepostagem recém-criada (visto em 19/08/2026 no
// objeto AD816558575BR): não pode contar como entrega.
checar("FC-82 (etiqueta emitida) NÃO é entrega", eventoEhEntrega("FC", "82"), false);
checar("BDE-2 não está na lista", eventoEhEntrega("BDE", "2"), false);
checar("PO-9 (postagem) não é entrega", eventoEhEntrega("PO", "9"), false);

// ── trânsito ───────────────────────────────────────────────────────────────
checar("PO-9 é trânsito", eventoEhTransito("PO", "9"), true);
checar("CO-15 é trânsito", eventoEhTransito("CO", "15"), true);
checar("CMT-0 é trânsito", eventoEhTransito("CMT", "0"), true);
checar("FC-82 não é trânsito", eventoEhTransito("FC", "82"), false);
checar("BDE-1 não é trânsito", eventoEhTransito("BDE", "01"), false);

// -- forma do WEBHOOK: o par chega COLADO -----------------------------------
// O receiver (`/api/correios/webhook`) nao tem `codigo` e `tipo` separados como
// o SRO: ele extrai "BDE-01" inteiro do header/corpo. Estas checagens sao a
// decisao dele, escrita do mesmo jeito -- `eventoEh*(...separarTipoEvento(t))`.
const ehEntregaColado = (t: string) => eventoEhEntrega(...separarTipoEvento(t));
const ehTransitoColado = (t: string) => eventoEhTransito(...separarTipoEvento(t));

checar("separa BDE-01", separarTipoEvento("BDE-01"), ["BDE", "01"]);
checar("separa BDE-1", separarTipoEvento("BDE-1"), ["BDE", "1"]);
checar("separa vazio", separarTipoEvento(""), ["", ""]);
checar("separa sem hifen", separarTipoEvento("BDE"), ["BDE", ""]);

// O ponto da correcao: as duas grafias do MESMO evento decidem igual.
checar("webhook BDE-01 e entrega", ehEntregaColado("BDE-01"), true);
checar("webhook BDE-1 e entrega", ehEntregaColado("BDE-1"), true);
checar("BDE-01 e BDE-1 sao o mesmo evento", ehEntregaColado("BDE-01") === ehEntregaColado("BDE-1"), true);
checar("webhook BDI-067 e entrega", ehEntregaColado("BDI-067"), true);
checar("webhook BDR-70 e entrega", ehEntregaColado("BDR-70"), true);
checar("webhook FC-82 nao e entrega", ehEntregaColado("FC-82"), false);
checar("webhook sem tipo nao e entrega", ehEntregaColado(""), false);

checar("webhook PO-01 e transito", ehTransitoColado("PO-01"), true);
checar("webhook PO-1 e transito", ehTransitoColado("PO-1"), true);
checar("PO-01 e PO-1 sao o mesmo evento", ehTransitoColado("PO-01") === ehTransitoColado("PO-1"), true);
checar("webhook CO-015 e transito", ehTransitoColado("CO-015"), true);
checar("webhook CMT-00 e transito", ehTransitoColado("CMT-00"), true);
checar("webhook BDE-01 nao e transito", ehTransitoColado("BDE-01"), false);
checar("webhook OEC-01 (saiu para entrega) nao muda status", ehTransitoColado("OEC-01") || ehEntregaColado("OEC-01"), false);

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
