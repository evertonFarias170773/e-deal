/**
 * Acabamento/Acessorio no boletim do TEXTIL (21/10/2026): "Acb:"/"Ace:" em 10 pt.
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/variacao-textil.test.mts
 */
import { readFileSync } from "node:fs";
import { linhaDeVariacaoNoCard } from "../../src/features/pedidos/lib/variacao-textil.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHA"} ${nome}${ok ? "" : `\n      esperado ${JSON.stringify(esperado)}\n      veio     ${JSON.stringify(real)}`}`);
}
checar("TEXTIL: Acabamento vira Acb: em destaque", linhaDeVariacaoNoCard("Acabamento: Mosquete Metal Ponta Dupla", "TEXTIL"), { texto: "Acb: Mosquete Metal Ponta Dupla", destaque: true });
checar("TEXTIL: Acessórios vira Ace: em destaque", linhaDeVariacaoNoCard("Acessórios: Chapinha Metálica", "textil"), { texto: "Ace: Chapinha Metálica", destaque: true });
checar("TEXTIL: singular e sem acento tambem", [linhaDeVariacaoNoCard("Acessorio: X", "TEXTIL").texto, linhaDeVariacaoNoCard("acabamentos : Y", "TEXTIL").texto], ["Ace: X", "Acb: Y"]);
checar("TEXTIL: outra variacao fica como esta", linhaDeVariacaoNoCard("Cor do Cordão: Azul", "TEXTIL"), { texto: "Cor do Cordão: Azul", destaque: false });
checar("outros setores: nada muda", ["PVC", "LASER", "FLEXO", null].map((s) => linhaDeVariacaoNoCard("Acabamento: Mosquete", s)), Array(4).fill({ texto: "Acabamento: Mosquete", destaque: false }));
const pdf = readFileSync(new URL("../../src/features/pedidos/pdf/OsPdfDocument.tsx", import.meta.url), "utf8");
checar("PDF: 10 pt sem limite de linhas, e o setor chega ao card", [
  /modeloVariacaoTextil: \{ fontSize: 10,/.test(pdf) && !/modeloVariacaoTextil:[^}]*maxLines/.test(pdf),
  pdf.includes("setor={vm.boletim.setor}"),
  /modeloVariacao: \{ fontSize: 6, fontFamily: "Helvetica-Bold", color: "#3d4f5e", marginTop: 1 \}/.test(pdf)
], [true, true, true]);
console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo."); if (falhas) process.exitCode = 1;
