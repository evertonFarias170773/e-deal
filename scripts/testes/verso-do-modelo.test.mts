/**
 * Verso do modelo e o "Frente e Verso" do produto — src/features/orcamentos/lib/verso-do-modelo.ts
 *
 *   node --experimental-strip-types scripts/testes/verso-do-modelo.test.mts
 *
 * O QUE PROVA
 *   1. A lista é a dos quatro valores de sempre, na mesma ordem.
 *   2. Produto com valor pré-carrega o modelo NOVO; produto sem valor (ou com
 *      valor fora da lista) segue como hoje: SÓ FRENTE.
 *   3. Modelo existente não muda: a pré-carga só é lida ao criar.
 *   4. Linha duplicada/copiada leva o verso da origem e não relê o catálogo —
 *      na Lista rápida (função) e no card (o Duplicar não chama a pré-carga).
 *   5. O cadastro do produto grava vazio como nulo e não apaga valor antigo.
 */
import { readFileSync } from "node:fs";
import {
  OPCOES_DE_VERSO,
  VERSO_SEM_CADASTRO,
  ehOpcaoDeVerso,
  opcoesDeVersoDoProduto,
  versoDaLinhaNova,
  versoInicialDoModelo,
  versoPadraoParaGravar
} from "../../src/features/orcamentos/lib/verso-do-modelo.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}
const ler = (caminho: string) => readFileSync(new URL(`../../${caminho}`, import.meta.url), "utf8");

// 1. A lista
checar("a lista e a dos quatro valores, na ordem da tela", [...OPCOES_DE_VERSO], ["SÓ FRENTE", "FRENTE E VERSO", "VERSO FIXO", "VERSO VARIÁVEL"]);
checar("residuo antigo nao e opcao", ["Frente", "FxVerso", "VERSO COMUM", "", null, undefined, 1].map(ehOpcaoDeVerso), [false, false, false, false, false, false, false]);
checar("o campo Verso do modelo le a lista da constante", /OPCOES_DE_VERSO\.map/.test(ler("src/features/orcamentos/components/ModeloCampos.tsx")), true);
checar("nenhuma opcao de verso escrita a mao no campo do modelo", /<option value="(SÓ FRENTE|FRENTE E VERSO|VERSO FIXO|VERSO VARIÁVEL)">/.test(ler("src/features/orcamentos/components/ModeloCampos.tsx")), false);

// 2. A pré-carga
checar("produto com valor pre-carrega o modelo novo", OPCOES_DE_VERSO.map((v) => versoInicialDoModelo(v)), [...OPCOES_DE_VERSO]);
checar("produto sem valor: igual a hoje (SO FRENTE)", [null, undefined, "", "   "].map(versoInicialDoModelo), [VERSO_SEM_CADASTRO, VERSO_SEM_CADASTRO, VERSO_SEM_CADASTRO, VERSO_SEM_CADASTRO]);
checar("produto com valor fora da lista: igual a hoje", ["Frente", "FxVerso", "frente e verso", 7].map(versoInicialDoModelo), ["SÓ FRENTE", "SÓ FRENTE", "SÓ FRENTE", "SÓ FRENTE"]);
checar("espaco em volta do valor do cadastro nao atrapalha", versoInicialDoModelo("  VERSO FIXO "), "VERSO FIXO");

// 3. Modelo existente não muda: a pré-carga só é chamada na criação
const aba = ler("src/features/orcamentos/components/PedidoModelosTab.tsx");
checar("a pre-carga e lida em um ponto so (padroesDeNovoLote)", (aba.match(/versoInicialDoModelo\(/g) ?? []).length, 1);
checar("nenhum outro arquivo do app le produtos.verso_padrao para o modelo", ["src/features/orcamentos/components/LotesGrid.tsx", "src/features/orcamentos/components/ModeloCampos.tsx", "src/features/orcamentos/services/pedidos-modelos.service.ts", "src/app/api/pedidos/lotes-em-massa/route.ts"].map((a) => ler(a).includes("verso_padrao")), [false, false, false, false]);

// 4. Duplicar/copiar não relê o catálogo
checar("linha nova a partir de outra leva o verso da origem", versoDaLinhaNova("VERSO FIXO", "FRENTE E VERSO"), "VERSO FIXO");
checar("linha de origem com residuo antigo: copia como esta", versoDaLinhaNova("Frente", "FRENTE E VERSO"), "Frente");
checar("sem linha de origem: usa o valor inicial do produto", [versoDaLinhaNova(undefined, "FRENTE E VERSO"), versoDaLinhaNova(null, "FRENTE E VERSO")], ["FRENTE E VERSO", "FRENTE E VERSO"]);
const duplicarDoCard = aba.slice(aba.indexOf("function startCopy("), aba.indexOf("onModelosChange", aba.indexOf("function startCopy(")));
checar("o Duplicar do card copia o modelo e nao chama a pre-carga", [duplicarDoCard.length > 0, /padroesDeNovoLote|versoInicialDoModelo|verso_padrao/.test(duplicarDoCard), /anularColunasEscondidas\(modelo,/.test(duplicarDoCard)], [true, false, true]);

// 5. O cadastro do produto
checar("vazio grava nulo", [versoPadraoParaGravar(""), versoPadraoParaGravar("  "), versoPadraoParaGravar(null), versoPadraoParaGravar(undefined)], [null, null, null, null]);
checar("valor da lista grava como esta", OPCOES_DE_VERSO.map((v) => versoPadraoParaGravar(v)), [...OPCOES_DE_VERSO]);
checar("produto sem valor: o campo oferece so a lista", opcoesDeVersoDoProduto(""), [...OPCOES_DE_VERSO]);
checar("produto com valor da lista: sem opcao repetida", opcoesDeVersoDoProduto("VERSO FIXO"), [...OPCOES_DE_VERSO]);
checar("produto com valor fora da lista: ele continua no campo e nao e apagado ao salvar", [opcoesDeVersoDoProduto("Frente"), versoPadraoParaGravar("Frente")], [[...OPCOES_DE_VERSO, "Frente"], "Frente"]);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
