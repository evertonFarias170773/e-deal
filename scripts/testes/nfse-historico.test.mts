/**
 * Histórico NFS-e — src/features/nfse/lib/historico-nfse.ts
 *
 *   node --experimental-strip-types scripts/testes/nfse-historico.test.mts
 *
 * O QUE PROVA
 *   1. O selo do ambiente: só "producao" é PRODUÇÃO; vazio, nulo ou desconhecido
 *      é HOMOLOGAÇÃO (nunca se diz produção por engano).
 *   2. O filtro de ambiente: Todos, Produção, Homologação.
 *   3. O status: os conhecidos como sempre; ERRO_AUTORIZACAO, RETORNO_FOCUS e
 *      qualquer desconhecido viram "Em análise", guardando o status real; nenhum
 *      some da lista e o filtro "Em análise" acha todos eles.
 *   4. O item "Cancelar NFS-e": à vista, desligado, sem ação, com a dica.
 */
import { readFileSync } from "node:fs";
import {
  DICA_CANCELAR_NFSE,
  FILTRO_AMBIENTE_NFSE,
  FILTRO_AMBIENTE_NFSE_PADRAO,
  nfsePassaNaBusca,
  ordenarNfsePorEmissao,
  FILTRO_STATUS_NFSE,
  STATUS_CONHECIDOS_NFSE,
  ambienteDaNfse,
  itemCancelarNfse,
  notaPassaNoFiltroDeAmbiente,
  notaPassaNoFiltroDeStatus,
  seloDoAmbiente,
  statusExibidoDaNfse
} from "../../src/features/nfse/lib/historico-nfse.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

// 1. Selo
checar("selo: homologacao", seloDoAmbiente("homologacao"), { ambiente: "homologacao", rotulo: "HOMOLOGAÇÃO" });
checar("selo: producao", seloDoAmbiente("producao"), { ambiente: "producao", rotulo: "PRODUÇÃO" });
checar("selo: producao com caixa e espaco", seloDoAmbiente("  PRODUCAO "), { ambiente: "producao", rotulo: "PRODUÇÃO" });
checar(
  "selo: vazio, nulo, indefinido e desconhecido caem em HOMOLOGACAO",
  ["", null, undefined, "teste", "produção", "prod", "1"].map((v) => seloDoAmbiente(v).rotulo),
  ["HOMOLOGAÇÃO", "HOMOLOGAÇÃO", "HOMOLOGAÇÃO", "HOMOLOGAÇÃO", "HOMOLOGAÇÃO", "HOMOLOGAÇÃO", "HOMOLOGAÇÃO"]
);
checar("ambiente: so o texto exato producao e producao", [ambienteDaNfse("producao"), ambienteDaNfse("producao2")], ["producao", "homologacao"]);

// 2. Filtro de ambiente
checar("filtro de ambiente: opcoes (Todos tem valor proprio)", FILTRO_AMBIENTE_NFSE, ["todos", "producao", "homologacao"]);
checar("filtro de ambiente: a aba abre em Producao", FILTRO_AMBIENTE_NFSE_PADRAO, "producao");
const notas = [{ a: "homologacao" }, { a: "producao" }, { a: null }, { a: "" }, { a: "xpto" }];
const passam = (filtro: string) => notas.filter((n) => notaPassaNoFiltroDeAmbiente(n.a, filtro)).length;
checar("filtro de ambiente: Todos mostra tudo", passam("todos"), 5);
checar("filtro de ambiente: Producao", passam("producao"), 1);
checar("filtro de ambiente: Homologacao inclui vazio e desconhecido", passam("homologacao"), 4);
checar("filtro de ambiente: valor estranho na URL nao esconde nada", passam("qualquer"), 5);
checar("filtro de ambiente: nenhuma nota fica fora dos dois", passam("producao") + passam("homologacao"), 5);

// 3. Status
checar(
  "status: os conhecidos aparecem como sempre",
  STATUS_CONHECIDOS_NFSE.map((s) => statusExibidoDaNfse(s.valor).rotulo),
  ["Pendente", "Pronta para envio", "Processando", "Autorizada", "Erro de Envio", "Rejeitada", "Cancelada"]
);
checar("status: conhecido nao e em analise e guarda o real", statusExibidoDaNfse("autorizada"), { chave: "AUTORIZADA", rotulo: "Autorizada", real: "AUTORIZADA", emAnalise: false });
checar("status: ERRO_AUTORIZACAO vira Em analise", statusExibidoDaNfse("ERRO_AUTORIZACAO"), { chave: "EM_ANALISE", rotulo: "Em análise", real: "ERRO_AUTORIZACAO", emAnalise: true });
checar("status: RETORNO_FOCUS vira Em analise", statusExibidoDaNfse("RETORNO_FOCUS"), { chave: "EM_ANALISE", rotulo: "Em análise", real: "RETORNO_FOCUS", emAnalise: true });
checar(
  "status: desconhecido, vazio e nulo viram Em analise",
  ["ALGO_NOVO", "ERRO_VALIDACAO", "PROCESSANDO_AUTORIZACAO", "", null, undefined].map((s) => statusExibidoDaNfse(s).rotulo),
  ["Em análise", "Em análise", "Em análise", "Em análise", "Em análise", "Em análise"]
);
checar("status: vazio mostra (sem status) na dica", statusExibidoDaNfse("  ").real, "(sem status)");
checar("filtro de status: Em analise e a ultima opcao", FILTRO_STATUS_NFSE[FILTRO_STATUS_NFSE.length - 1], "EM_ANALISE");

const lista = ["AUTORIZADA", "ERRO_AUTORIZACAO", "RETORNO_FOCUS", "PENDENTE", "ALGO_NOVO", "", "CANCELADA"];
const comStatus = (filtro: string) => lista.filter((s) => notaPassaNoFiltroDeStatus(s, filtro));
checar("filtro de status: Todos mostra tudo, inclusive o desconhecido", comStatus("").length, 7);
checar("filtro de status: Em analise acha todos os desconhecidos", comStatus("EM_ANALISE"), ["ERRO_AUTORIZACAO", "RETORNO_FOCUS", "ALGO_NOVO", ""]);
checar("filtro de status: Autorizada", comStatus("AUTORIZADA"), ["AUTORIZADA"]);
checar("filtro de status: valor estranho na URL nao esconde nada", comStatus("NAO_EXISTE").length, 7);
checar(
  "filtro de status: toda nota aparece em exatamente uma opcao",
  lista.map((s) => FILTRO_STATUS_NFSE.filter((f) => f !== "" && notaPassaNoFiltroDeStatus(s, f)).length),
  [1, 1, 1, 1, 1, 1, 1]
);

// 4. Cancelar NFS-e
const item = itemCancelarNfse();
checar("cancelar: item a vista, desligado, com a dica", item, { label: "Cancelar NFS-e", disabled: true, title: DICA_CANCELAR_NFSE });
checar("cancelar: nao tem acao (nao chama rota)", "onClick" in item, false);
checar(
  "cancelar: a dica manda ao portal nacional e ao fiscal",
  [DICA_CANCELAR_NFSE.includes("www.nfse.gov.br"), DICA_CANCELAR_NFSE.includes("avise o fiscal"), DICA_CANCELAR_NFSE.startsWith("Cancelamento de NFS-e ainda não está disponível no Vibe.")],
  [true, true, true]
);

// 5. Busca e ordem da aba NFS-e (04/11/2026)
const n24623 = { numero_nfse: "149", ref: "NFS-24623-001", id_int: 24623, id_cliente: 17610, nome: "COMPANHIA ZAFFARI COMERCIO E INDUSTRIA", fantasia: "Zaffari", created_at: "2026-11-04T14:36:00Z", payload_retorno: { data_emissao: "2026-11-04T11:38:38-03:00" } };
const n23671 = { numero_nfse: null, ref: "NFS-23671-001", id_int: 23671, id_cliente: 17610, nome: "COMPANHIA ZAFFARI", fantasia: null, created_at: "2026-10-15T13:16:00Z", payload_retorno: null };
const n23733 = { numero_nfse: "138", ref: "NFS-23733-001", id_int: 23733, id_cliente: 14, nome: "Cliente Teste", fantasia: null, created_at: "2026-10-14T20:48:00Z", payload_retorno: { data_emissao: "2026-10-14T17:49:25-03:00" } };
checar("busca: pedido 24623", nfsePassaNaBusca(n24623, "24623"), true);
checar("busca: referencia", nfsePassaNaBusca(n24623, "nfs-24623-001"), true);
checar("busca: numero da nota", nfsePassaNaBusca(n24623, "149"), true);
checar("busca: ID do cliente", nfsePassaNaBusca(n24623, "17610"), true);
checar("busca: nome sem acento e sem caixa", nfsePassaNaBusca(n24623, "zaffari"), true);
checar("busca: quem nao bate fica fora", nfsePassaNaBusca(n23733, "zaffari"), false);
checar("busca vazia passa tudo", nfsePassaNaBusca(n23733, "  "), true);
checar("busca: pedido pelo id_int mesmo sem ref", nfsePassaNaBusca({ ...n23733, ref: null }, "23733"), true);
checar("ordem: emissao mais nova primeiro; sem emissao entra pela criacao", ordenarNfsePorEmissao([n23733, n23671, n24623]).map((n) => n.ref), ["NFS-24623-001", "NFS-23671-001", "NFS-23733-001"]);

// 6. Pagina: abas do historico e busca da Fila intocada
const pagina = readFileSync("src/features/fiscal/NotasFiscaisPage.tsx", "utf8");
checar("pagina: abas NF-e e NFS-e na URL (hist), abre em NF-e", pagina.includes('hist: { codec: codecs.enumOf(ABAS_HISTORICO), default: "nfe"'), true);
checar("pagina: rotulos das abas", pagina.includes('nfe: "NF-e (Produtos)", nfse: "NFS-e (Serviços)"'), true);
checar("pagina: secoes nao empilham mais", pagina.includes('historicoAba === "nfe"') && pagina.includes('historicoAba === "nfse"'), true);
checar("pagina: a Fila segue com a busca da NF-e (nfe-q)", /if \(nfeSearch\) \{\s*const search = nfeSearch/.test(pagina), true);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
