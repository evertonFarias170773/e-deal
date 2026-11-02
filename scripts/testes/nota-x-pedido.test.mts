/**
 * Salvar proposta com NF-e de venda viva: aviso quando total, desconto ou frete mudam.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/nota-x-pedido.test.mts
 *
 * A. regra (pura).
 * B. dados reais, SO LEITURA (GET), com o MESMO select da rota nota-do-pedido:
 *    o 24221 (NF-e autorizada) avisa com total alterado; um pedido sem nota nao avisa.
 */
import { config as carregarEnv } from "dotenv";
import {
  deveAvisarNotaDivergente,
  notasDeVendaVivas,
  rotuloDaNotaViva,
  textoLinhaDoTempoNotaDivergente,
  valoresMudaram,
  type NotaDoBanco
} from "../../src/features/orcamentos/lib/nota-x-pedido.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

const nota = (status: string, extra: Partial<NotaDoBanco> = {}): NotaDoBanco => ({
  ref: "NFE-1-001", numero_nf: "41170", status, tipo_nota: null, ambiente: "producao", valor_total_nf: 285.37, ...extra
});
const antes = { total: 285.37, desconto: 0, frete: 20 };

// ── A ──
checar("autorizada de producao conta", notasDeVendaVivas([nota("AUTORIZADA")]).length, 1);
checar("em processamento conta", notasDeVendaVivas([nota("PROCESSANDO", { ambiente: "homologacao" })]).length, 1);
checar("pronta para envio conta", notasDeVendaVivas([nota("PRONTA_PARA_ENVIO", { ambiente: "homologacao" })]).length, 1);
checar("cancelada nao conta", notasDeVendaVivas([nota("CANCELADA")]).length, 0);
checar("denegada nao conta", notasDeVendaVivas([nota("DENEGADA")]).length, 0);
checar("rascunho nao conta", notasDeVendaVivas([nota("PENDENTE")]).length, 0);
checar("remessa nao conta", notasDeVendaVivas([nota("AUTORIZADA", { tipo_nota: "REMESSA" })]).length, 0);
checar("autorizada de homologacao nao conta", notasDeVendaVivas([nota("AUTORIZADA", { ambiente: "homologacao" })]).length, 0);
checar("total mudou", valoresMudaram(antes, { ...antes, total: 164.56 }), true);
checar("desconto mudou", valoresMudaram(antes, { ...antes, desconto: 120.81 }), true);
checar("frete mudou", valoresMudaram(antes, { ...antes, frete: 0 }), true);
checar("nada mudou (menos de 1 centavo)", valoresMudaram(antes, { ...antes, total: 285.371 }), false);
const vivas = notasDeVendaVivas([nota("AUTORIZADA")]);
checar("com NF viva e total alterado: avisa", deveAvisarNotaDivergente(vivas, antes, { ...antes, total: 164.56 }), true);
checar("com NF viva e nada alterado: nao avisa", deveAvisarNotaDivergente(vivas, antes, antes), false);
checar("sem NF e total alterado: nao avisa", deveAvisarNotaDivergente([], antes, { ...antes, total: 164.56 }), false);
checar("rotulo da nota", rotuloDaNotaViva(vivas[0]).replace(/\s/g, " "), "NF-e 41170 (R$ 285,37)");
checar(
  "texto da linha do tempo",
  textoLinhaDoTempoNotaDivergente("Edina", vivas, 164.56).replace(/\s/g, " "),
  "⚠️ Pedido salvo por Edina com valor diferente da NF-e: pedido R$ 164,56; NF-e 41170 (R$ 285,37). A nota não foi alterada."
);

// ── B ──
carregarEnv({ path: ".env.local", quiet: true });
const B = process.env.NEXT_PUBLIC_SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!B || !K) {
  console.log("(parte B pulada: .env.local sem chaves)");
} else {
  const ler = async (tabela: string, qs: string) => {
    const r = await fetch(`${B}/rest/v1/${tabela}?${qs}`, { method: "GET", headers: { apikey: K, Authorization: `Bearer ${K}` } });
    return r.json();
  };
  const SELECT = "ref,numero_nf,status,tipo_nota,ambiente,valor_total_nf"; // o mesmo da rota
  const comNota = 24221;
  const [p1] = await ler("propostas", `select=valor_total&id_int=eq.${comNota}`);
  const notas1 = notasDeVendaVivas(await ler("notas_fiscais", `select=${SELECT}&id_int=eq.${comNota}`));
  console.log(`#${comNota}: pedido ${p1?.valor_total}; notas vivas ${notas1.map(rotuloDaNotaViva).join(", ") || "nenhuma"}`);
  const atual = { total: Number(p1?.valor_total), desconto: 0, frete: 0 };
  checar(`#${comNota} com NF viva e total alterado: avisa`, deveAvisarNotaDivergente(notas1, atual, { ...atual, total: atual.total + 10 }), true);
  checar(`#${comNota} com NF viva e nada alterado: nao avisa`, deveAvisarNotaDivergente(notas1, atual, atual), false);

  // Pedido sem nota escolhido na hora (dado vivo muda: o 24495 da prova anterior ganhou NF-e).
  const recentes = (await ler("propostas", "select=id_int&status_interno=eq.AGUARDANDO&order=id_int.desc&limit=30")) as Array<{ id_int: number }>;
  const comAlgumaNota = new Set(
    ((await ler("notas_fiscais", `select=id_int&id_int=in.(${recentes.map((r) => r.id_int).join(",")})`)) as Array<{ id_int: number }>).map((n) => n.id_int)
  );
  const semNota = recentes.find((r) => !comAlgumaNota.has(r.id_int))?.id_int ?? 0;
  console.log(`pedido sem nota: #${semNota}`);
  const [p2] = await ler("propostas", `select=valor_total&id_int=eq.${semNota}`);
  const notas2 = notasDeVendaVivas(await ler("notas_fiscais", `select=${SELECT}&id_int=eq.${semNota}`));
  const atual2 = { total: Number(p2?.valor_total), desconto: 0, frete: 0 };
  checar(`#${semNota} sem NF e total alterado: nao avisa`, deveAvisarNotaDivergente(notas2, atual2, { ...atual2, total: atual2.total + 10 }), false);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntudo certo");
process.exitCode = falhas ? 1 : 0;
