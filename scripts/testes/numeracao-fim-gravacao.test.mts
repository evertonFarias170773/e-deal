/**
 * Nº final na gravação (29/10/2026): Ticket gravado com Nº final = QTD (×1)
 * nos pedidos 24054, 24420 e 24500.
 *
 * Uso: node --experimental-strip-types scripts/testes/numeracao-fim-gravacao.test.mts
 *
 * (a) numerador fora da lista não gera Nº final ×1 nem é repassado ao Salvar;
 * (b) o servidor recusa Nº final divergente em linha nova ou alterada;
 * (c) o servidor aceita linha antiga não tocada;
 * (d) Ticket PRATA com QTD 4000 e inicial 1 dá 20000.
 */
import { readFileSync } from "node:fs";
import {
  calcularNumeracaoFim,
  conferirFimDosLotes,
  fimDaGradeParaLote,
  loteFoiTocado,
  loteSeguradoPeloNumerador,
  mensagemDaRecusaDoFim,
  recusaDoFim,
  resolverMultiplicadorNumeracao
} from "../../src/features/orcamentos/numeracao-modelo-utils.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok ? "" : `\n        obtido:   ${JSON.stringify(obtido)}\n        esperado: ${JSON.stringify(esperado)}`}`);
}

// O cadastro como está no banco (lido em 29/10/2026).
const PRATA = { name: "Ticket PRATA", tipo: "TICKET", ticket_qtd: 5 };
const TICKET2 = { name: "Ticket 2", tipo: "TICKET", ticket_qtd: 2 };
const SEQ = { name: "Up Sequencial", tipo: "SEQUENCIAL", ticket_qtd: null };
const CADASTRO = [PRATA, TICKET2, SEQ];

// O modelo #1005237 do pedido 24420, como está gravado.
const GRAVADO_24420 = { id: 1005237, quantidade: 4000, numeracao_inicio: 1, numeracao_fim: 4000, gabarito_operacional: "Ticket PRATA" };
const lote = (extra: Record<string, unknown> = {}) => ({
  nome_modelo: "VALE 01 REFEIÇÃO",
  quantidade: 4000,
  tipo_numeracao: "SEQUENCIAL",
  numeracao_inicio: 1,
  gabarito_operacional: "Ticket PRATA",
  ...extra
});

// ── (d) a conta ─────────────────────────────────────────────────────────────
console.log("\n(d) Ticket PRATA, QTD 4000, inicial 1");
checar("multiplicador do cadastro", resolverMultiplicadorNumeracao(PRATA).multiplicador, 5);
checar("Nº final pela regra", calcularNumeracaoFim(1, 4000, 5), 20000);
checar("a grade calcula 20000 com o numerador na lista", fimDaGradeParaLote(1, 4000, lote(), null, CADASTRO), 20000);
checar("o servidor aceita 20000", recusaDoFim(lote({ numeracao_fim: 20000 }), CADASTRO), null);

// ── (a) numerador fora da lista na grade ────────────────────────────────────
console.log("\n(a) numerador fora da lista");
checar("lista carregando: linha nova fica sem Nº final (nunca 4000)", fimDaGradeParaLote(1, 4000, lote(), null, []), null);
checar("nome ausente da lista: linha nova fica sem Nº final", fimDaGradeParaLote(1, 4000, lote(), null, [SEQ]), null);
checar("lista carregando: linha nova é segurada", loteSeguradoPeloNumerador(lote(), null, []), true);
checar("linha do banco com QTD alterada é segurada", loteSeguradoPeloNumerador(lote({ id: 1005237, quantidade: 3000 }), GRAVADO_24420, []), true);
checar("linha do banco intocada NÃO é segurada", loteSeguradoPeloNumerador(lote({ id: 1005237, numeracao_fim: 4000 }), GRAVADO_24420, []), false);
checar("linha do banco intocada mantém o Nº final gravado", fimDaGradeParaLote(1, 4000, lote({ id: 1005237, numeracao_fim: 4000 }), GRAVADO_24420, []), 4000);
checar("sem numerador escolhido não é segurada (×1 é a regra)", loteSeguradoPeloNumerador(lote({ gabarito_operacional: null }), null, []), false);
checar("Mapa de Teatro não é segurado", loteSeguradoPeloNumerador(lote({ mapa_teatro_setor_id: "s1" }), null, []), false);
checar("lista chegou: a mesma linha volta a calcular 20000", fimDaGradeParaLote(1, 4000, lote(), null, CADASTRO), 20000);

const grade = readFileSync("src/features/orcamentos/components/LotesGrid.tsx", "utf8").replace(/\r\n/g, "\n");
checar("grade: o Nº final vem de fimDaGradeParaLote (sem ×1 escondido)", [
  grade.includes("fimDaGradeParaLote(inicio, qtd, linha,"),
  /resolverMultiplicadorNumeracao\(\s*findNumeracaoByName\(numeracoes, linha\.gabarito_operacional\)/.test(grade)
], [true, false]);
checar("grade: envio à rota segura a linha", grade.includes("const semNumerador = motivoDasSeguradas(enviaveis);\n    if (semNumerador) return { segurar: semNumerador };"), true);
checar("grade: o repasse ao Salvar tira a linha segurada", grade.includes("const lotes = gravaveis.filter((l) => !segurada(l))"), true);
checar("grade: o Salvar fica segurado pelo impedimento", grade.includes("const semNumerador = motivoDasSeguradas(numerar(linhasRef.current, modoRef.current)"), true);
checar("grade: a chegada da lista refaz o repasse", /useEffect\(\(\) => \{\n    if \(!onPendente \|\| !repassouRef\.current\) return;\n    repassarAoSalvar\(\);[\s\S]{0,80}\}, \[numeracoes\]\);/.test(grade), true);
checar("grade: numerar refaz a conta quando a lista muda", grade.includes("[numeracoes, mostraFaixa, gravadasPorId]"), true);

// ── (b) o servidor recusa linha nova ou alterada ────────────────────────────
console.log("\n(b) servidor recusa divergência em linha nova ou alterada");
const novaErrada = conferirFimDosLotes([lote({ numeracao_fim: 4000 })], [], CADASTRO);
checar("linha nova com 4000 é recusada, com o número certo", novaErrada.map((r) => [r.enviado, r.esperado]), [[4000, 20000]]);
checar("linha nova sem Nº final é recusada", conferirFimDosLotes([lote({ numeracao_fim: null })], [], CADASTRO).length, 1);
checar("linha alterada (QTD) com Nº final velho é recusada",
  conferirFimDosLotes([lote({ id: 1005237, quantidade: 3000, numeracao_fim: 4000 })], [GRAVADO_24420], CADASTRO).map((r) => r.esperado), [15000]);
checar("linha alterada (numerador) é conferida pelo numerador novo",
  conferirFimDosLotes([lote({ id: 1005237, gabarito_operacional: "Ticket 2", numeracao_fim: 4000 })], [GRAVADO_24420], CADASTRO).map((r) => r.esperado), [8000]);
checar("linha alterada (Nº inicial) é conferida",
  conferirFimDosLotes([lote({ id: 1005237, numeracao_inicio: 5, numeracao_fim: 4004 })], [GRAVADO_24420], CADASTRO).map((r) => r.esperado), [20004]);
checar("numerador que não está no cadastro, em linha nova, é recusado",
  conferirFimDosLotes([lote({ gabarito_operacional: "Apagado", numeracao_fim: 4000 })], [], CADASTRO).map((r) => r.esperado), [null]);
checar("mensagem clara, com modelo, numerador e o número do cadastro",
  mensagemDaRecusaDoFim(novaErrada).includes('VALE 01 REFEIÇÃO (Ticket PRATA): Nº final 4000, o cadastro dá 20000') &&
  mensagemDaRecusaDoFim(novaErrada).startsWith("Nada foi gravado"), true);
checar("linha nova certa passa", conferirFimDosLotes([lote({ numeracao_fim: 20000 })], [], CADASTRO), []);
checar("Sequencial certo passa", conferirFimDosLotes([lote({ gabarito_operacional: "Up Sequencial", numeracao_fim: 4000 })], [], CADASTRO), []);
checar("SEM_NUMERACAO e Mapa de Teatro não são conferidos", conferirFimDosLotes([
  lote({ tipo_numeracao: "SEM_NUMERACAO", numeracao_fim: 1 }),
  lote({ mapa_teatro_id: "m", mapa_teatro_setor_id: "s", numeracao_fim: 1 })
], [], CADASTRO), []);

// ── (c) o servidor aceita linha antiga não tocada ───────────────────────────
console.log("\n(c) servidor aceita linha antiga não tocada");
checar("o 24420 como está gravado (4000) passa sem tocar", conferirFimDosLotes([lote({ id: 1005237, numeracao_fim: 4000 })], [GRAVADO_24420], CADASTRO), []);
checar("intocada mesmo com outros campos mudados (cor, nome)", conferirFimDosLotes([lote({ id: 1005237, numeracao_fim: 4000, padrao: "Outra", nome_modelo: "X" })], [GRAVADO_24420], CADASTRO), []);
checar("intocada com o Nº final já corrigido pela tela também passa", conferirFimDosLotes([lote({ id: 1005237, numeracao_fim: 20000 })], [GRAVADO_24420], CADASTRO), []);
checar("número e texto equivalentes contam como intocados", loteFoiTocado(lote({ id: 1005237, quantidade: "4000", numeracao_inicio: "1", gabarito_operacional: " Ticket PRATA " }), GRAVADO_24420), false);
checar("na mesma lista, só a nova é recusada", conferirFimDosLotes([
  lote({ id: 1005237, numeracao_fim: 4000 }),
  lote({ nome_modelo: "NOVO", numeracao_fim: 100, quantidade: 100 })
], [GRAVADO_24420], CADASTRO).map((r) => r.nome), ["NOVO"]);

// ── ligação no servidor ─────────────────────────────────────────────────────
console.log("\nservidor: a conferência roda antes de qualquer escrita");
const rota = readFileSync("src/app/api/pedidos/lotes-em-massa/route.ts", "utf8");
checar("lotes-em-massa: confere antes de gravarLotesDoItem", rota.indexOf("conferirFimAntesDeGravar(supabase, lotes)") > 0 && rota.indexOf("conferirFimAntesDeGravar(supabase, lotes)") < rota.indexOf("await gravarLotesDoItem("), true);
const save = readFileSync("src/features/orcamentos/services/orcamentos.service.ts", "utf8");
const iParcial = save.indexOf("recusaDoFimNoSave(client, formState, checklist, (item) =>");
const iParcialEscrita = save.indexOf("const modelosSincronizados: ModeloSincronizado[] = [];\n  try {".replace(/\n/g, save.includes("\r\n") ? "\r\n" : "\n"));
checar("Salvar parcial (editar-paga com cobrança): confere antes de gravar", iParcial > 0 && iParcial < iParcialEscrita, true);
const iCompleto = save.indexOf("const recusaDoFim = await recusaDoFimNoSave(client, formState, checklistDosLotes);");
const iPrimeiraEscrita = save.indexOf("let clienteNome = \"\";");
checar("Salvar completo: confere antes do bloco que escreve", iCompleto > 0 && iCompleto < iPrimeiraEscrita, true);
const editarPaga = readFileSync("src/app/api/orcamentos/editar-paga/route.ts", "utf8");
checar("editar-paga grava pelo saveProposta (herda a conferência)", editarPaga.includes("await saveProposta("), true);

// ── o aviso da impressão continua como está ─────────────────────────────────
const aviso = readFileSync("src/features/orcamentos/hooks/useFimDivergente.ts", "utf8");
checar("aviso gravado x calculado segue em divergenciaDoFim/modelosComFimDivergente", aviso.includes("modelosComFimDivergente"), true);

console.log(falhas === 0 ? "\ntodos os testes passaram" : `\n${falhas} falha(s)`);
process.exitCode = falhas === 0 ? 0 : 1;
