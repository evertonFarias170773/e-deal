#!/usr/bin/env node
/**
 * Checagem do manual de uso (docs/manual/).
 *
 * AVISA quando ha arquivo de TELA alterado sem nenhuma pagina do manual
 * alterada junto. NAO bloqueia: sai sempre com codigo 0. A decisao de atualizar
 * o manual e de quem esta commitando — mudanca so interna nao precisa.
 *
 * O que conta como "arquivo de tela": todo .tsx em src/app (fora de src/app/api),
 * src/features e src/components. Servico, rota de API, migration e teste nao
 * disparam o aviso, mesmo que mudem uma regra visivel — nesses casos a regra do
 * AGENTS.md continua valendo, so nao ha como o script adivinhar.
 *
 * Uso:
 *   node scripts/checar-manual.mjs            # tudo que mudou na arvore (com e sem stage, e arquivos novos)
 *   node scripts/checar-manual.mjs --staged   # so o que esta no stage (e o que o hook de pre-commit usa)
 */
import { execFileSync } from "node:child_process";

const soStaged = process.argv.includes("--staged");

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function listar() {
  const saidas = soStaged
    ? [git(["diff", "--cached", "--name-only", "--diff-filter=ACMRD"])]
    : [
        git(["diff", "--cached", "--name-only", "--diff-filter=ACMRD"]),
        git(["diff", "--name-only", "--diff-filter=ACMRD"]),
        git(["ls-files", "--others", "--exclude-standard"])
      ];
  const arquivos = new Set();
  for (const saida of saidas) {
    for (const linha of saida.split(/\r?\n/)) {
      const caminho = linha.trim().replace(/\\/g, "/");
      if (caminho) arquivos.add(caminho);
    }
  }
  return [...arquivos].sort();
}

const ehTela = (caminho) =>
  caminho.endsWith(".tsx") &&
  !caminho.startsWith("src/app/api/") &&
  (caminho.startsWith("src/app/") || caminho.startsWith("src/features/") || caminho.startsWith("src/components/"));

const ehManual = (caminho) => caminho.startsWith("docs/manual/") && caminho.endsWith(".md");

/**
 * De qual pagina do manual cada pedaco do codigo costuma tratar. So uma
 * sugestao para o aviso — o primeiro prefixo que casar vence, entao os mais
 * especificos vem antes. Tela sem pagina ainda aparece como "sem pagina".
 */
const PAGINAS_POR_PREFIXO = [
  ["src/features/orcamentos/OrcamentosListPageReal", ["pedidos.md"]],
  ["src/features/orcamentos/components/LotesGrid", ["proposta-pedido.md"]],
  ["src/features/orcamentos/components/PedidoModelosTab", ["proposta-pedido.md"]],
  ["src/features/orcamentos/components/ModeloCampos", ["proposta-pedido.md"]],
  ["src/features/orcamentos/components/Artes", ["proposta-artes.md"]],
  ["src/features/orcamentos/", ["proposta.md", "proposta-geral.md", "proposta-produtos.md", "proposta-fretes.md"]],
  ["src/app/(erp)/orcamentos/", ["pedidos.md", "proposta.md"]],
  ["src/features/cobrancas/PropostaCobrancaPanel", ["proposta-pagamentos.md"]],
  ["src/features/cobrancas/", ["conferencia.md", "proposta-pagamentos.md"]],
  ["src/app/(erp)/cobrancas/", ["conferencia.md"]],
  ["src/features/contas-a-receber/registro-recebiveis/", ["registro-de-recebiveis.md"]],
  ["src/app/(erp)/contas-a-receber/registro/", ["registro-de-recebiveis.md"]],
  ["src/features/contas-a-receber/", ["carteira.md"]],
  ["src/app/(erp)/contas-a-receber/", ["carteira.md"]],
  ["src/features/fiscal/", ["notas-fiscais.md"]],
  ["src/features/nfe/", ["notas-fiscais.md"]],
  ["src/features/nfse/", ["notas-fiscais.md"]],
  ["src/app/(erp)/notas-fiscais/", ["notas-fiscais.md"]],
  ["src/features/expedicao/", ["expedicao.md"]],
  ["src/app/(erp)/expedicao/", ["expedicao.md"]],
  ["src/features/pedidos/BoletimFormPage", ["proposta-producao-boletim-historico.md", "producao.md"]],
  ["src/features/pedidos/", ["producao.md"]],
  ["src/features/producao/", ["producao.md"]],
  ["src/app/(erp)/pedidos/", ["producao.md"]],
  ["src/features/tarefas/", ["tarefas.md"]],
  ["src/app/(erp)/tarefas/", ["tarefas.md"]]
];

function paginasSugeridas(caminho) {
  const achado = PAGINAS_POR_PREFIXO.find(([prefixo]) => caminho.startsWith(prefixo));
  return achado ? achado[1] : null;
}

const alterados = listar();
const telas = alterados.filter(ehTela);
const manual = alterados.filter(ehManual);

if (telas.length === 0 || manual.length > 0) {
  // Nada de tela mudou, ou o manual ja foi mexido junto: nada a avisar.
  process.exit(0);
}

const linhas = [];
linhas.push("");
linhas.push("AVISO (manual): ha arquivo de tela alterado e nenhuma pagina de docs/manual/ alterada.");
linhas.push("Se a mudanca aparece para o usuario (tela, botao, aviso, fluxo ou regra visivel),");
linhas.push('atualize a pagina correspondente e a data de "Ultima revisao" no mesmo commit.');
linhas.push("Mudanca so interna nao precisa. Este aviso nao bloqueia o commit.");
linhas.push("");
for (const tela of telas) {
  const paginas = paginasSugeridas(tela);
  linhas.push(
    paginas
      ? `  ${tela}\n      -> docs/manual/${paginas.join(", docs/manual/")}`
      : `  ${tela}\n      -> sem pagina no manual ainda (crie a partir de docs/manual/_MODELO.md se for tela de uso)`
  );
}
linhas.push("");
console.warn(linhas.join("\n"));
process.exit(0);
