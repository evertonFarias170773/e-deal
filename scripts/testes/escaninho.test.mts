/**
 * Escaninho de encontro dos pedidos compostos (17/11/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/escaninho.test.mts
 */
import { readFileSync } from "node:fs";
import {
  boletimEhComposto,
  lerRespostaDoEscaninho,
  textoDaTarjaDoEscaninho,
  ROTULO_ESCANINHO,
  SEM_ESCANINHO_LIVRE
} from "../../src/features/pedidos/lib/escaninho.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else console.log(`ok      ${nome}`);
}

checar("composto: setor do boletim + outro setor", boletimEhComposto({ setor: "LASER", outrosSetores: [{}] }), true);
checar("um setor só: sem outros setores", boletimEhComposto({ setor: "LASER", outrosSetores: [] }), false);
checar("sem setor no boletim (legado): não é composto", boletimEhComposto({ setor: null, outrosSetores: [{}] }), false);

checar("RPC devolve lista: lê a primeira linha", lerRespostaDoEscaninho([{ situacao: "OCUPADO", nome: "ÁGUIA AMERICANA" }]), { situacao: "OCUPADO", nome: "ÁGUIA AMERICANA" });
checar("situação desconhecida: null", lerRespostaDoEscaninho([{ situacao: "OUTRA", nome: "X" }]), null);
checar("vazio: null", [lerRespostaDoEscaninho([]), lerRespostaDoEscaninho(null)], [null, null]);

checar("tarja com o nome", textoDaTarjaDoEscaninho({ situacao: "OCUPADO", nome: "ALCE" }), "ALCE");
checar("28 ocupados: SEM ESCANINHO LIVRE", textoDaTarjaDoEscaninho({ situacao: "SEM_LIVRE", nome: null }), SEM_ESCANINHO_LIVRE);
checar("liberado, um setor, não liberado ou falha: sem tarja",
  [textoDaTarjaDoEscaninho({ situacao: "LIBERADO", nome: null }), textoDaTarjaDoEscaninho({ situacao: "UM_SETOR", nome: null }), textoDaTarjaDoEscaninho({ situacao: "NAO_LIBERADO", nome: null }), textoDaTarjaDoEscaninho(null)],
  [null, null, null, null]);
checar("rótulo da tarja", ROTULO_ESCANINHO, "Escaninho de encontro das OS.");
{
  const fonte = readFileSync("src/features/pedidos/pdf/OsPdfDocument.tsx", "utf8");
  const r = fonte.slice(fonte.indexOf("function ResumoDemaisSetores"));
  checar("tarja: rótulo à esquerda e nome em caixa alta à direita",
    [r.indexOf("styles.escaninhoRotulo") > 0 && r.indexOf("styles.escaninhoRotulo") < r.indexOf("styles.escaninhoTexto"),
     r.includes("pdfSafe(escaninho).toUpperCase()"),
     /escaninhoTarja: \{[^}]*flexDirection: "row",\s*justifyContent: "space-between"/.test(fonte),
     /escaninhoTexto: \{[^}]*textAlign: "right"/.test(fonte),
     /escaninhoRotulo: \{ fontSize: 9, fontFamily: "Helvetica",/.test(fonte)],
    [true, true, true, true, true]);
  checar("tarja: verde com o nome, vermelha só com SEM ESCANINHO LIVRE",
    [/escaninhoTarja: \{\s*backgroundColor: "#15803d"/.test(fonte),
     /escaninhoTarjaAlerta: \{ backgroundColor: "#dc2626" \}/.test(fonte),
     /escaninho === SEM_ESCANINHO_LIVRE\s*\?\s*\[styles\.escaninhoTarja, styles\.escaninhoTarjaAlerta\]\s*:\s*styles\.escaninhoTarja\b/.test(r)],
    [true, true, true]);
}

const pdf = readFileSync("src/features/pedidos/pdf/OsPdfDocument.tsx", "utf8");
const pagina = pdf.slice(pdf.indexOf("export function OsPdfPaginaBoletim"));
const iCliente = pagina.indexOf("<OsPdfBlocoCliente");
const iResumo = pagina.indexOf("<ResumoDemaisSetores");
const iProduto = pagina.indexOf("<ProdutoCard");
checar("PDF: tarja e outros setores depois do cliente e antes do primeiro produto", iCliente > 0 && iCliente < iResumo && iResumo < iProduto, true);
checar("PDF: tarja dentro do bloco indivisível, antes do título do resumo",
  (() => { const r = pdf.slice(pdf.indexOf("function ResumoDemaisSetores")); return r.indexOf("styles.escaninhoTarja") > 0 && r.indexOf("styles.escaninhoTarja") < r.indexOf("styles.resumoBarra"); })(),
  true);

const rota = readFileSync("src/app/api/pedidos/imprimir-os/route.ts", "utf8");
checar("rota: pede o escaninho só para composto, uma vez por PDF, tolerante a falha",
  [rota.includes("vms.some((v) => boletimEhComposto(v.boletim))"), rota.includes('supabase.rpc("escaninho_do_boletim"'), rota.includes("escErr ? null")],
  [true, true, true]);

const sql = readFileSync("supabase/migrations/20261117c_escaninhos_encontro.sql", "utf8");
const nomes = [...sql.matchAll(/\((\d+),\s+'([^']+)'\)/g)].map((m) => `${m[1]} ${m[2]}`);
checar("migration: 28 escaninhos com a ordem explícita", [nomes.length, nomes[0], nomes[1], nomes[27]], [28, "1 ÁGUIA AMERICANA", "2 ALCE", "28 URSO POLAR"]);
checar("migration: único por escaninho e por pedido enquanto ocupado",
  [sql.includes("ON public.escaninhos_ocupacao (ordem) WHERE liberado_em IS NULL"), sql.includes("ON public.escaninhos_ocupacao (id_int) WHERE liberado_em IS NULL")],
  [true, true]);
checar("migration: libera no despacho e no cancelamento",
  [sql.includes("AFTER INSERT OR UPDATE OF data_despacho ON public.expedicoes"), sql.includes("AFTER UPDATE OF status_interno ON public.propostas")],
  [true, true]);
checar("migration: primeiro livre pela ordem, sob trava", [sql.includes("ORDER BY e.ordem"), sql.includes("pg_advisory_xact_lock")], [true, true]);

if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else console.log("\nTudo certo.");
