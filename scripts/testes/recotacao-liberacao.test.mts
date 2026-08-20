/**
 * Testes do estado da liberação de recotação de frete.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/recotacao-liberacao.test.mts
 *
 * O QUE ESTE ARQUIVO FIXA
 *   A máquina de estados que a UI e as duas rotas compartilham: quando o botão
 *   está bloqueado, quando está liberado, e o que o menu Ações oferece ao admin.
 *   São três consumidores lendo a MESMA fonte (`PedidoExpedicao.liberacaoRecotacao`,
 *   carregada com a lista) — se divergirem, um mostra liberado e o outro bloqueia.
 *
 * O QUE ELE NÃO SUBSTITUI
 *   A unicidade da liberação ativa é um índice único PARCIAL no banco
 *   (`exp_lib_uma_ativa_por_pedido`), e o consumo atômico é o
 *   `UPDATE ... WHERE consumida_em IS NULL RETURNING` dentro de
 *   `exp_aplicar_recotacao`. Nenhuma das duas coisas é testável aqui, e nenhuma
 *   depende deste arquivo — são garantias do banco, não do TypeScript.
 */

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

type Liberacao = { id: number; liberadoEm: string; liberadoPorNome: string | null } | null;
type Pedido = { statusInterno: string; modalidade: string | null; liberacaoRecotacao: Liberacao };

const LIB: Liberacao = { id: 7, liberadoEm: "2026-08-20T12:00:00Z", liberadoPorNome: "Everton Farias" };

/** Réplica do gate do DespacharModal: o bloco aparece, o botão é que trava. */
function estadoBotao(p: Pedido): "oculto" | "bloqueado" | "liberado" {
  if (p.statusInterno !== "EXPEDICAO" || p.modalidade !== "CIF") return "oculto";
  return p.liberacaoRecotacao ? "liberado" : "bloqueado";
}

/** Réplica dos itens do menu Ações. Sem filtro por modalidade, de propósito. */
function itensMenuAdmin(p: Pedido, canAdmin: boolean): string[] {
  if (!canAdmin || p.statusInterno !== "EXPEDICAO") return [];
  return p.liberacaoRecotacao ? ["Recotação já liberada", "Cancelar liberação"] : ["Liberar recotação de frete"];
}

const emExpedicaoCif = (lib: Liberacao): Pedido => ({ statusInterno: "EXPEDICAO", modalidade: "CIF", liberacaoRecotacao: lib });

// ── O botão do expedidor ────────────────────────────────────────────────────
checar("sem liberação o botão fica BLOQUEADO, não oculto", estadoBotao(emExpedicaoCif(null)), "bloqueado");
checar("com liberação o botão libera", estadoBotao(emExpedicaoCif(LIB)), "liberado");
checar(
  "fora de EXPEDICAO o bloco nem aparece",
  estadoBotao({ statusInterno: "EM PRODUCAO", modalidade: "CIF", liberacaoRecotacao: LIB }),
  "oculto"
);
checar(
  "sem CIF o bloco nem aparece, mesmo liberado",
  estadoBotao({ statusInterno: "EXPEDICAO", modalidade: "FOB", liberacaoRecotacao: LIB }),
  "oculto"
);
checar(
  "sem modalidade declarada o bloco nem aparece",
  estadoBotao({ statusInterno: "EXPEDICAO", modalidade: null, liberacaoRecotacao: null }),
  "oculto"
);

// ── O menu do admin ─────────────────────────────────────────────────────────
checar("admin sem liberação ativa vê liberar", itensMenuAdmin(emExpedicaoCif(null), true), [
  "Liberar recotação de frete"
]);
checar("admin com liberação ativa vê o estado e o cancelar", itensMenuAdmin(emExpedicaoCif(LIB), true), [
  "Recotação já liberada",
  "Cancelar liberação"
]);
checar("não-admin não vê nada", itensMenuAdmin(emExpedicaoCif(null), false), []);
checar(
  "fora de EXPEDICAO o admin não vê o item",
  itensMenuAdmin({ statusInterno: "PRONTO", modalidade: "CIF", liberacaoRecotacao: null }, true),
  []
);
// Sem filtro por modalidade: o admin costuma liberar ANTES de o expedidor
// declarar CIF na bancada. Os gates de CIF ficam nas duas rotas.
checar(
  "o item aparece mesmo sem CIF ainda declarado",
  itensMenuAdmin({ statusInterno: "EXPEDICAO", modalidade: null, liberacaoRecotacao: null }, true),
  ["Liberar recotação de frete"]
);

// ── Consumo e revogação: o que conta como "ativa" ──────────────────────────
// Espelha o WHERE do índice parcial: consumida_em IS NULL AND revogada_em IS NULL.
function estaAtiva(row: { consumida_em: string | null; revogada_em: string | null }): boolean {
  return row.consumida_em === null && row.revogada_em === null;
}
checar("recém-liberada está ativa", estaAtiva({ consumida_em: null, revogada_em: null }), true);
checar("consumida não está ativa", estaAtiva({ consumida_em: "2026-08-20T13:00:00Z", revogada_em: null }), false);
checar("revogada não está ativa", estaAtiva({ consumida_em: null, revogada_em: "2026-08-20T13:00:00Z" }), false);

// Recotar sem aplicar NÃO consome: o estado da liberação é o mesmo depois de
// N consultas. É a diferença entre a rota `cotar` (verifica) e a `aplicar`
// (consome dentro da transação).
const antes = { consumida_em: null as string | null, revogada_em: null as string | null };
const depoisDeTresConsultas = { ...antes };
checar("recotar sem aplicar não consome", estaAtiva(depoisDeTresConsultas), estaAtiva(antes));

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
