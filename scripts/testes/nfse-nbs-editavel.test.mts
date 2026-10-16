/**
 * NBS da NFS-e editável pelo administrador (16/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/nfse-nbs-editavel.test.mts
 *
 * SEM banco: cliente Supabase falso. Roda a ROTA de verdade (`PATCH
 * /api/fiscal/rascunho-nfse`), não uma cópia da regra.
 *
 * O QUE PROVA
 *   1. Regras puras: 9 dígitos; só rascunho sem número; mensagens das recusas.
 *   2. A rota recusa quem não é administrador, ANTES de ler ou gravar a nota.
 *   3. Recusa NBS fora de 9 dígitos e nota que não é rascunho, sem chamar o banco.
 *   4. Administrador com rascunho: chama `fn_definir_nbs_rascunho_nfse` com o
 *      id relido do banco, o NBS e o status lido — e nada grava direto na tabela.
 *   5. A recusa do banco (nota mudou) chega à tela como 409 com texto.
 *   6. Função ainda não criada (migration não aplicada): 503 com texto.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FALSO_JS = pathToFileURL(path.join(AQUI, "_supabase-js-falso.mts")).href;
const FALSO_NEXT = pathToFileURL(path.join(AQUI, "_next-server-falso-classe.mts")).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: FALSO_JS, shortCircuit: true };
    if (especificador === "next/server") return { url: FALSO_NEXT, shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { falso } = await import("./_supabase-falso.mts");
const { PATCH } = await import("../../src/app/api/fiscal/rascunho-nfse/route.ts");
const { conferirNbsDigitado, nbsEditavelNaNota, mensagemDaRecusaDoNbs } = await import("../../src/features/nfse/lib/regras-emissao.ts");

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";

// ── 1. Regras puras ──────────────────────────────────────────────────────────
checar("9 digitos passam", [conferirNbsDigitado("121011000").ok, conferirNbsDigitado(" 123456789 ").ok], [true, true]);
checar("fora do formato nao passa",
  ["12101100", "1210110000", "1.2101.10.00", "12101100a", "", null].map((v) => conferirNbsDigitado(v as string).ok),
  [false, false, false, false, false, false]);
checar("so rascunho sem numero e editavel",
  [
    nbsEditavelNaNota({ status: "PENDENTE", numero_nfse: null }),
    nbsEditavelNaNota({ status: "pronta_para_envio", numero_nfse: "" }),
    nbsEditavelNaNota({ status: "ERRO_VALIDACAO" }),
    nbsEditavelNaNota({ status: "ERRO_ENVIO", numero_nfse: null }),
    nbsEditavelNaNota({ status: "AUTORIZADA", numero_nfse: "138" }),
    nbsEditavelNaNota({ status: "PROCESSANDO" }),
    nbsEditavelNaNota({ status: "ERRO_AUTORIZACAO" }),
    nbsEditavelNaNota({ status: "CANCELADA" }),
    nbsEditavelNaNota({ status: "PENDENTE", numero_nfse: "10" })
  ],
  [true, true, true, true, false, false, false, false, false]);
checar("mensagem da nota que mudou", mensagemDaRecusaDoNbs("NOTA_MUDOU").startsWith("A nota mudou"), true);

// ── Rota ─────────────────────────────────────────────────────────────────────
const pedir = (corpo: unknown) =>
  PATCH(new Request("https://vibe.exemplo/api/fiscal/rascunho-nfse", {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: "Bearer token-de-teste" },
    body: JSON.stringify(corpo)
  }));
const corpoBom = { id_int: 23800, ref: "NFS-23800-001", codigo_nbs: "123456789" };
const escritasDiretas = () => falso.chamadas.filter((c) => c.tabela === "notas_servico" && c.op !== "select");
const rpcs = () => falso.chamadas.filter((c) => c.tabela === "rpc:fn_definir_nbs_rascunho_nfse");
const lerCorpo = async (r: Response) => (await r.json()) as Record<string, unknown>;

function cenario(usuario: Record<string, unknown>, nota: Record<string, unknown> | null) {
  falso.zerar();
  falso.responder("usuarios:select", { data: usuario, error: null });
  falso.responder("perfis:select", { data: { permissoes: ["fiscal.emit_nfse"] }, error: null });
  falso.responder("notas_servico:select", { data: nota, error: null });
}
const operador = { id_perfil: 5, is_super_adm: false, is_admin: false, nome_usuario: "Operador" };
const admin = { id_perfil: null, is_super_adm: false, is_admin: true, nome_usuario: "Admin" };
const rascunho = { id: "aaaaaaaa-0000-0000-0000-000000000001", ref: "NFS-23800-001", id_int: 23800, status: "PENDENTE", numero_nfse: null };

// ── 2. Quem não é administrador ──────────────────────────────────────────────
{
  cenario(operador, rascunho);
  const r = await pedir(corpoBom);
  const nadaDaNota = falso.chamadas.filter((c) => c.tabela === "notas_servico").length;
  checar("2. operador com fiscal.emit_nfse: 403, sem ler a nota nem chamar o banco",
    [r.status, (await lerCorpo(r)).code, nadaDaNota, rpcs().length], [403, "SEM_PERMISSAO_NBS", 0, 0]);
}

// ── 3. NBS invalido e nota fora de rascunho ──────────────────────────────────
{
  cenario(admin, rascunho);
  const r = await pedir({ ...corpoBom, codigo_nbs: "12345" });
  checar("3. NBS de 5 digitos: 422, sem chamar o banco", [r.status, (await lerCorpo(r)).code, rpcs().length], [422, "NBS_INVALIDO", 0]);

  cenario(admin, { ...rascunho, status: "AUTORIZADA", numero_nfse: "138" });
  const r2 = await pedir(corpoBom);
  checar("3. nota autorizada: 409, sem chamar o banco", [r2.status, (await lerCorpo(r2)).code, rpcs().length], [409, "STATUS_NAO_EDITAVEL", 0]);

  cenario(admin, null);
  const r3 = await pedir(corpoBom);
  checar("3. nota de outro pedido ou inexistente: 404", [r3.status, rpcs().length], [404, 0]);
}

// ── 4. Administrador com rascunho ────────────────────────────────────────────
{
  cenario(admin, rascunho);
  falso.responder("rpc:fn_definir_nbs_rascunho_nfse", { data: { alterada: true, codigo_nbs: "123456789", codigo_nbs_anterior: "121011000" }, error: null });
  const r = await pedir(corpoBom);
  const corpo = await lerCorpo(r);
  checar("4. administrador: 200 com o NBS gravado", [r.status, corpo.success, corpo.codigo_nbs], [200, true, "123456789"]);
  checar("4. a funcao recebe o id relido, o NBS e o status lido",
    rpcs().map((c) => c.payload), [{ p_id: rascunho.id, p_codigo_nbs: "123456789", p_status_lido: "PENDENTE" }]);
  checar("4. nenhuma escrita direta em notas_servico", escritasDiretas().length, 0);
  const leitura = falso.chamadas.find((c) => c.tabela === "notas_servico");
  checar("4. a nota e relida pela ref E pelo pedido",
    leitura?.filtros.filter(([f]) => f === "eq").map(([, a]) => a), [["ref", "NFS-23800-001"], ["id_int", 23800]]);
}

// ── 5. O banco recusa ────────────────────────────────────────────────────────
{
  cenario(admin, rascunho);
  falso.responder("rpc:fn_definir_nbs_rascunho_nfse", { data: { alterada: false, motivo: "NOTA_MUDOU" }, error: null });
  const r = await pedir(corpoBom);
  const corpo = await lerCorpo(r);
  checar("5. nota mudou: 409 com o texto", [r.status, corpo.code, String(corpo.message).startsWith("A nota mudou")], [409, "NOTA_MUDOU", true]);
}

// ── 6. Migration ainda nao aplicada ──────────────────────────────────────────
{
  cenario(admin, rascunho);
  falso.responder("rpc:fn_definir_nbs_rascunho_nfse", { data: null, error: { message: "Could not find the function public.fn_definir_nbs_rascunho_nfse", code: "PGRST202" } });
  const r = await pedir(corpoBom);
  checar("6. funcao ausente: 503", [r.status, (await lerCorpo(r)).code], [503, "NBS_INDISPONIVEL"]);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
