/**
 * Produção imprime o boletim de qualquer OS liberada (15/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/alcance-impressao-os.test.mts
 *
 * O QUE PROVA
 *   1. Perfil Produção (print_os + producao.view, nenhuma propostas.view_*):
 *      passa nas duas checagens da rota de impressão. O alcance de proposta
 *      sozinho continua negando — é o acesso de produção que libera.
 *   2. Sem pedidos.print_os (vendedor; Produção sem a permissão) segue recusado
 *      no primeiro passo, com ou sem alcance.
 *   3. As outras rotas que usam `verificarEscopoPropostaServerSide` continuam
 *      iguais: o helper não mudou, não conhece `producao.view`, e só a rota de
 *      impressão consulta o acesso de produção.
 *   4. A rota mantém a ordem: print_os (403), não encontrada (404), não
 *      liberada (409), alcance (403).
 *   5. O botão da tela segue a mesma regra.
 *
 * Sem banco: cliente Supabase falso que responde `usuarios` e `perfis`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verificarPermissaoServerSide } from "../../src/lib/auth/verificar-permissao.ts";
import { verificarEscopoPropostaServerSide } from "../../src/lib/auth/verificar-escopo-proposta.ts";
import {
  PERMISSAO_ACESSO_PRODUCAO,
  PERMISSAO_IMPRIMIR_OS,
  alcanceDeImpressaoPelaProducao,
  podeImprimirOsNaTela
} from "../../src/lib/auth/alcance-impressao-os.ts";
import { falso, getSupabaseClient } from "./_supabase-falso.mts";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fonte = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r\n/g, "\n");

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

// Permissões reais dos perfis (lidas do banco em 15/10/2026).
const PRODUCAO = ["pedidos.view", "producao.view", "producao.mover", "producao.admin", "pedidos.edit_data", "pedidos.edit_obs", "pedidos.print_os", "pedidos.edit"];
const PRODUCAO_SEM_PRINT = PRODUCAO.filter((p) => p !== "pedidos.print_os");
const VENDEDOR = ["propostas.view", "propostas.view_own", "propostas.edit"];
const EXPEDIDOR = ["pedidos.view", "pedidos.print_os", "propostas.view"];
const PROPOSTA = { empresa: "Ideal Grafica", vendedor: "Alguem De Vendas" };

/** O mesmo par de checagens que a rota faz, com o banco respondendo o perfil dado. */
async function rota(permissoes: string[]) {
  falso.zerar();
  falso.responder("usuarios:select", {
    data: { id_perfil: 5, is_super_adm: false, is_admin: false, id_empresa: null, nome_usuario: "Operador Producao" },
    error: null
  });
  falso.responder("perfis:select", { data: { permissoes }, error: null });
  const sb = getSupabaseClient() as never;
  const printOs = await verificarPermissaoServerSide(sb, "u1", PERMISSAO_IMPRIMIR_OS);
  if (!printOs) return { status: 403, motivo: "print_os" };
  const alcance =
    (await verificarPermissaoServerSide(sb, "u1", PERMISSAO_ACESSO_PRODUCAO)) ||
    (await verificarEscopoPropostaServerSide(sb, "u1", PROPOSTA));
  return alcance ? { status: 200 } : { status: 403, motivo: "alcance" };
}

// ── 1. Produção sem propostas.view_* imprime ────────────────────────────────
checar("Produção: imprime OS liberada", await rota(PRODUCAO), { status: 200 });
falso.zerar();
falso.responder("usuarios:select", { data: { id_perfil: 5, is_super_adm: false, id_empresa: null, nome_usuario: "Operador Producao" }, error: null });
falso.responder("perfis:select", { data: { permissoes: PRODUCAO }, error: null });
checar(
  "Produção: o alcance de proposta sozinho segue negando (era o 403 de antes)",
  await verificarEscopoPropostaServerSide(getSupabaseClient() as never, "u1", PROPOSTA),
  false
);

// ── 2. Sem print_os segue recusado ──────────────────────────────────────────
checar("vendedor (sem print_os): recusado no print_os", await rota(VENDEDOR), { status: 403, motivo: "print_os" });
checar("Produção sem print_os: recusado no print_os", await rota(PRODUCAO_SEM_PRINT), { status: 403, motivo: "print_os" });
checar("Expedidor (print_os, sem producao.view, sem view_*): segue recusado no alcance", await rota(EXPEDIDOR), { status: 403, motivo: "alcance" });

// ── 3. Outras rotas iguais ──────────────────────────────────────────────────
const helper = fonte("src/lib/auth/verificar-escopo-proposta.ts");
checar("verificar-escopo-proposta não conhece producao.view", helper.includes("producao.view"), false);
for (const rel of [
  "src/app/api/cobrancas/cancelar-externo/route.ts",
  "src/app/api/cobrancas/pode-cancelar/route.ts",
  "src/app/api/expedicao/correios/rastro/route.ts",
  "src/app/api/orcamentos/cancelar-proposta/route.ts",
  "src/app/api/pedidos/os-qr/rotacionar/route.ts"
]) {
  const r = fonte(rel);
  checar(`${rel}: segue no alcance de proposta, sem o acesso de produção`, [r.includes("verificarEscopoPropostaServerSide("), /producao\.view|PERMISSAO_ACESSO_PRODUCAO|alcance-impressao-os/.test(r)], [true, false]);
}

// ── 4. Ordem das recusas na rota ────────────────────────────────────────────
const imprimir = fonte("src/app/api/pedidos/imprimir-os/route.ts");
const pos = [
  imprimir.indexOf('"pedidos.print_os");'),
  imprimir.indexOf('"Proposta não encontrada.", 404'),
  imprimir.indexOf("OS não pode ser impressa.\",\n      409"),
  imprimir.indexOf("PERMISSAO_ACESSO_PRODUCAO)) ||"),
  imprimir.indexOf('"Acesso negado a esta proposta.", 403')
];
checar("rota: print_os → 404 → 409 → alcance (produção ou proposta) → 403", pos.every((p, i) => p > 0 && (i === 0 || p > pos[i - 1])), true);

// ── 5. Botão da tela ────────────────────────────────────────────────────────
checar("tela: Produção vê o botão", podeImprimirOsNaTela({ permissoes: PRODUCAO }), true);
checar("tela: vendedor não vê", podeImprimirOsNaTela({ permissoes: VENDEDOR }), false);
checar("tela: Produção sem print_os não vê", podeImprimirOsNaTela({ permissoes: PRODUCAO_SEM_PRINT }), false);
checar("tela: Expedidor sem alcance não vê (o servidor recusaria)", podeImprimirOsNaTela({ permissoes: EXPEDIDOR }), false);
checar("tela: admin com view_all vê", podeImprimirOsNaTela({ permissoes: ["pedidos.print_os", "propostas.view_all"] }), true);
checar("tela: super admin e is_admin como sempre", [podeImprimirOsNaTela({ isSuperAdmin: true }), podeImprimirOsNaTela({ isAdmin: true })], [true, true]);
checar("tela: sem usuário não vê", podeImprimirOsNaTela(null), false);
checar("acesso de produção: producao.view ou *", [alcanceDeImpressaoPelaProducao(["producao.view"]), alcanceDeImpressaoPelaProducao(["*"]), alcanceDeImpressaoPelaProducao(["pedidos.view"])], [true, true, false]);
for (const tela of ["src/features/pedidos/BoletimFormPage.tsx", "src/features/pedidos/PedidosListPage.tsx"]) {
  checar(`${tela}: botão usa a regra do servidor`, fonte(tela).includes("const canPrintOS = podeImprimirOsNaTela(user);"), true);
}

if (falhas > 0) {
  console.log(`\n${falhas} verificacao(oes) falharam.`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
