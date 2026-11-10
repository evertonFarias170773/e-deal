/**
 * NFS-e: item com valor fixo segue a regra da NF-e (10/11/2026, pedido 24847).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/nfse-valor-fixo.test.mts
 *
 * O 24847 tem um item "Tirante 120cm": 1.100 x R$ 3,50 + R$ 20,00 de valor fixo
 * = R$ 3.870,00. A descrição saía "1.100 x Tirante 120cm - R$ 3,50 un.", que não
 * fecha com a nota. A NF-e usa o subtotal gravado e divide pela quantidade em 10
 * casas (NF 41470: 900 x R$ 0,2044444444 = R$ 184,00). A NFS-e agora faz igual,
 * na tabela da janela e na descrição, e cada linha fecha com "- Subtotal R$ ...".
 */
import { descricaoDosItens, moedaDoUnitario, valoresDoItemNaNota } from "../../src/features/nfse/lib/regras-emissao.ts";
import { valoresDosItensDaNota } from "../../src/features/nfe/lib/valor-item-nfe.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`}`);
}

/** Lê o unitário e o subtotal de volta da linha da descrição e confere a conta no centavo. */
function linhaFecha(linha: string): boolean {
  const m = linha.match(/^([\d.]+) x .* - R\$ ([\d.]+,\d+) un\. - Subtotal R\$ ([\d.]+,\d{2})$/);
  if (!m) return false;
  const num = (t: string) => Number(t.replace(/\./g, "").replace(",", "."));
  return Math.round(num(m[1]) * num(m[2]) * 100) === Math.round(num(m[3]) * 100);
}

// 1. O 24847 (dados do banco em 10/11/2026: qtd 1100, valor_unt 3,50, valor_sub_total 3870,00)
const tirante = { nome: "Tirante 120cm", quantidade: 1100, valorUnitario: 3.5, subtotal: 3870 };
const desc24847 = descricaoDosItens(24847, [tirante]);
checar("24847: descricao", desc24847, "Pedido 24847\n1.100 x Tirante 120cm - R$ 3,5181818182 un. - Subtotal R$ 3.870,00");
checar("24847: a linha fecha a conta", linhaFecha(desc24847.split("\n")[1]), true);
checar("24847: soma das linhas = R$ 3.870,00", valoresDoItemNaNota(tirante)?.subtotal, 3870);
checar("24847: unitario da tabela", moedaDoUnitario(valoresDoItemNaNota(tirante)!.unitario), "R$ 3,5181818182");

// 2. Mesmo numero que a NF-e
const casos = [
  tirante,
  { nome: "Pulseira Triband", quantidade: 900, valorUnitario: 0.16, subtotal: 184 },
  { nome: "Cordão Plus 85cm", quantidade: 16, valorUnitario: 4.7, subtotal: 95.2 },
  { nome: "Ingresso MOBI", quantidade: 1520, valorUnitario: 0.23, subtotal: 349.6 }
];
const daNfe = valoresDosItensDaNota(casos, 0);
checar("unitario igual ao da NF-e (sem bonus)", casos.map((c) => valoresDoItemNaNota(c)?.unitario), daNfe.map((v) => v.valorUnitario));
checar("subtotal igual ao da NF-e", casos.map((c) => valoresDoItemNaNota(c)?.subtotal), daNfe.map((v) => v.valorBruto));
checar("NF 41470: R$ 0,2044444444", moedaDoUnitario(daNfe[1].valorUnitario), "R$ 0,2044444444");

// 3. Sem valor fixo: o unitario e o do pedido
const semFixo = { nome: "Ingresso MOBI", quantidade: 1520, valorUnitario: 0.23, subtotal: 349.6 };
checar("sem fixo: unitario de sempre", descricaoDosItens(24623, [semFixo]), "Pedido 24623\n1.520 x Ingresso MOBI - R$ 0,23 un. - Subtotal R$ 349,60");
checar("sem subtotal gravado: quantidade x unitario", descricaoDosItens(1, [{ nome: "Pulseira", quantidade: 3, valorUnitario: 1.5 }]), "Pedido 1\n3 x Pulseira - R$ 1,50 un. - Subtotal R$ 4,50");

// 4. Varios itens: todas as linhas fecham e a soma bate
const varios = descricaoDosItens(2, casos).split("\n").slice(1);
checar("varios: toda linha fecha", varios.map(linhaFecha), [true, true, true, true]);

// 5. Formato do unitario
checar("unitario: casas", [3.5, 0.2044444444, 1234.5, 0.23, 2].map(moedaDoUnitario), ["R$ 3,50", "R$ 0,2044444444", "R$ 1.234,50", "R$ 0,23", "R$ 2,00"]);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
