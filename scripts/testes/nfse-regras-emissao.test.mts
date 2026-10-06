/**
 * NFS-e pela Fila — src/features/nfse/lib/regras-emissao.ts
 *
 *   node --experimental-strip-types scripts/testes/nfse-regras-emissao.test.mts
 *
 * O QUE PROVA
 *   1. Empresa: só a Ideal Birô (id 2) é liberada, e o texto da proposta vira
 *      id pela mesma regra da NF-e (`resolverEmpresaEmitente`).
 *   2. Status: cada valor que o banco e o n8n gravam cai na situação certa, e
 *      status desconhecido NUNCA vira permissão para emitir de novo.
 *   3. O pedido: autorizada recusa; em análise recusa; rascunho reabre; erro de
 *      envio reenvia a mesma; recusada pela prefeitura e cancelada permitem
 *      rascunho novo. Com várias notas, autorizada e em análise mandam.
 *   4. O texto do botão da Fila.
 *   5. Descrição: preenchida com os itens, de 1 a 1000 caracteres.
 *   6. Valor, documento do tomador e endereço.
 *   7. Serviço: inativo, sem código de tributação, sem NBS de 9 dígitos ou com
 *      NBS diferente do que o banco grava não cria rascunho.
 *   8. O nome do arquivo baixado: número da NFS-e e do pedido.
 */
import {
  EMPRESAS_NFSE_LIBERADAS,
  LIMITE_DESCRICAO_NFSE,
  conferirDescricao,
  conferirEndereco,
  conferirServico,
  conferirValor,
  decidirNfseDoPedido,
  decisaoPermiteRascunhoNovo,
  descricaoDosItens,
  documentoDoTomador,
  empresaEmitenteDoTexto,
  empresaLiberadaParaNfse,
  nomeDoArquivoNfse,
  rotuloDoBotaoNfse,
  situacaoDoStatus,
  statusPedeConsulta,
  valorDifereDoPedido
} from "../../src/features/nfse/lib/regras-emissao.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas += 1;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : `\n       obtido:   ${JSON.stringify(obtido)}\n       esperado: ${JSON.stringify(esperado)}`}`);
}

// 1. Empresa
checar("empresa: lista fechada so com a Biro", EMPRESAS_NFSE_LIBERADAS, [2]);
checar(
  "empresa: textos reais de propostas.empresa",
  ["IDEAL BIRÔ SERV. GRAFICOS", "Ideal Biro", "E3 BRINDES LTDA", "E3 Brindes", "IDEAL GRÁFICA EXPRESSA EIRELI", "Ideal Grafica", "", null].map(empresaEmitenteDoTexto),
  [2, 2, 3, 3, 1, 1, 1, 1]
);
checar("empresa: so a 2 e liberada", [1, 2, 3, 4, null, undefined].map(empresaLiberadaParaNfse), [false, true, false, false, false, false]);
checar("empresa: texto nao reconhecido nao libera", empresaLiberadaParaNfse(empresaEmitenteDoTexto("DSEG IMPRESSOS")), false);

// 2. Status
const situacoes = (lista: (string | null)[]) => lista.map(situacaoDoStatus);
checar("status: autorizada", situacoes(["AUTORIZADA", "autorizada", " Autorizada "]), ["AUTORIZADA", "AUTORIZADA", "AUTORIZADA"]);
checar("status: rascunho", situacoes(["PENDENTE", "PRONTA_PARA_ENVIO"]), ["RASCUNHO", "RASCUNHO"]);
checar("status: erro de envio e bloqueio da conferencia reenviam a mesma nota", situacoes(["ERRO_ENVIO", "ERRO_VALIDACAO"]), ["REENVIAR", "REENVIAR"]);
checar(
  "status: recusada, cancelada, rejeitada e denegada encerram a nota",
  situacoes(["ERRO_AUTORIZACAO", "CANCELADA", "REJEITADA", "DENEGADA"]),
  ["ENCERRADA", "ENCERRADA", "ENCERRADA", "ENCERRADA"]
);
checar(
  "status: processando, retorno nao reconhecido, vazio e desconhecido ficam em analise",
  situacoes(["PROCESSANDO", "PROCESSANDO_AUTORIZACAO", "RETORNO_FOCUS", "", null, "STATUS_QUE_NAO_EXISTE"]),
  ["EM_ANALISE", "EM_ANALISE", "EM_ANALISE", "EM_ANALISE", "EM_ANALISE", "EM_ANALISE"]
);
checar(
  "status: so nota em analise e consultada na Focus",
  ["PROCESSANDO", "RETORNO_FOCUS", "XPTO", "PENDENTE", "AUTORIZADA", "ERRO_ENVIO", "ERRO_AUTORIZACAO", "CANCELADA"].map(statusPedeConsulta),
  [true, true, true, false, false, false, false, false]
);

// 3. O pedido
const nota = (ref: string, status: string, created_at: string, numero_nfse: string | null = null) => ({ ref, status, created_at, numero_nfse });
const resumo = (notas: ReturnType<typeof nota>[]) => {
  const d = decidirNfseDoPedido(notas);
  return [d.acao, d.nota?.ref ?? null];
};
checar("pedido: sem nota cria", resumo([]), ["CRIAR", null]);
checar("pedido: autorizada mostra a nota", resumo([nota("NFS-1-001", "AUTORIZADA", "2026-10-05", "11")]), ["MOSTRAR_AUTORIZADA", "NFS-1-001"]);
checar("pedido: rascunho pendente reabre", resumo([nota("NFS-1-001", "PENDENTE", "2026-10-05")]), ["REABRIR_RASCUNHO", "NFS-1-001"]);
checar("pedido: pronta para envio reabre", resumo([nota("NFS-1-001", "PRONTA_PARA_ENVIO", "2026-10-05")]), ["REABRIR_RASCUNHO", "NFS-1-001"]);
checar("pedido: processando fica em analise", resumo([nota("NFS-1-001", "PROCESSANDO", "2026-10-05")]), ["EM_ANALISE", "NFS-1-001"]);
checar("pedido: RETORNO_FOCUS fica em analise", resumo([nota("NFS-1-001", "RETORNO_FOCUS", "2026-10-05")]), ["EM_ANALISE", "NFS-1-001"]);
checar("pedido: status desconhecido fica em analise", resumo([nota("NFS-1-001", "ALGO_NOVO", "2026-10-05")]), ["EM_ANALISE", "NFS-1-001"]);
checar("pedido: erro de envio reenvia a mesma", resumo([nota("NFS-1-001", "ERRO_ENVIO", "2026-10-05")]), ["REENVIAR", "NFS-1-001"]);
checar("pedido: recusada pela prefeitura permite rascunho novo", resumo([nota("NFS-1-001", "ERRO_AUTORIZACAO", "2026-10-05")]), ["CRIAR", null]);
checar("pedido: cancelada permite rascunho novo", resumo([nota("NFS-1-001", "CANCELADA", "2026-10-05")]), ["CRIAR", null]);
checar(
  "pedido: rascunho novo depois de um errado — vale o mais recente",
  resumo([nota("NFS-1-001", "PENDENTE", "2026-10-05T10:00:00"), nota("NFS-1-002", "ERRO_ENVIO", "2026-10-05T11:00:00")]),
  ["REENVIAR", "NFS-1-002"]
);
checar(
  "pedido: recusada antiga e rascunho novo — reabre o novo",
  resumo([nota("NFS-1-001", "ERRO_AUTORIZACAO", "2026-10-05T10:00:00"), nota("NFS-1-002", "PENDENTE", "2026-10-05T11:00:00")]),
  ["REABRIR_RASCUNHO", "NFS-1-002"]
);
checar(
  "pedido: autorizada manda, mesmo com rascunho mais novo",
  resumo([nota("NFS-1-001", "AUTORIZADA", "2026-10-05T10:00:00", "12"), nota("NFS-1-002", "PENDENTE", "2026-10-05T11:00:00")]),
  ["MOSTRAR_AUTORIZADA", "NFS-1-001"]
);
checar(
  "pedido: em analise manda sobre rascunho mais novo",
  resumo([nota("NFS-1-001", "PROCESSANDO", "2026-10-05T10:00:00"), nota("NFS-1-002", "PENDENTE", "2026-10-05T11:00:00")]),
  ["EM_ANALISE", "NFS-1-001"]
);
checar(
  "pedido: cancelada depois de autorizada? a autorizada que sobrou ainda manda",
  resumo([nota("NFS-1-001", "CANCELADA", "2026-10-05T10:00:00"), nota("NFS-1-002", "AUTORIZADA", "2026-10-05T11:00:00", "13")]),
  ["MOSTRAR_AUTORIZADA", "NFS-1-002"]
);
checar(
  "pedido: sem data, desempata pela referencia",
  resumo([nota("NFS-1-001", "PENDENTE", ""), nota("NFS-1-002", "ERRO_ENVIO", "")]),
  ["REENVIAR", "NFS-1-002"]
);
checar(
  "rascunho novo a pedido: so quando nao ha autorizada nem nota em analise",
  (["CRIAR", "REABRIR_RASCUNHO", "REENVIAR", "EM_ANALISE", "MOSTRAR_AUTORIZADA"] as const).map(decisaoPermiteRascunhoNovo),
  [true, true, true, false, false]
);

// 4. O botão
const botao = (notas: ReturnType<typeof nota>[]) => rotuloDoBotaoNfse(decidirNfseDoPedido(notas));
checar("botao: sem nota", botao([]), "NFS-e");
checar("botao: rascunho continua NFS-e", botao([nota("NFS-1-001", "PENDENTE", "x")]), "NFS-e");
checar("botao: autorizada mostra o numero da NFS-e", botao([nota("NFS-1-001", "AUTORIZADA", "x", "13")]), "NFS-e nº 13");
checar("botao: autorizada sem numero gravado", botao([nota("NFS-1-001", "AUTORIZADA", "x", null)]), "NFS-e autorizada");
checar("botao: em analise", botao([nota("NFS-1-001", "RETORNO_FOCUS", "x")]), "NFS-e em análise");
checar("botao: erro de envio", botao([nota("NFS-1-001", "ERRO_ENVIO", "x")]), "NFS-e (reenviar)");
checar("botao: recusada volta a NFS-e", botao([nota("NFS-1-001", "ERRO_AUTORIZACAO", "x")]), "NFS-e");

// 5. Descrição
checar(
  "descricao: uma linha por item, com quantidade e valor unitario",
  descricaoDosItens(22760, [
    { nome: "Ingresso  MOBI ", quantidade: 1500, valorUnitario: 0.35 },
    { nome: "Pulseira", quantidade: 2, valorUnitario: 1234.5 },
    { nome: "Arte", quantidade: null, valorUnitario: null },
    { nome: "", quantidade: 3, valorUnitario: 1 }
  ]),
  ["Pedido 22760", "1.500 x Ingresso MOBI - R$ 0,35 un.", "2 x Pulseira - R$ 1.234,50 un.", "Arte"].join("\n")
);
checar("descricao: pedido sem item", descricaoDosItens(1, []), "Pedido 1");
checar("descricao: limite da Focus", LIMITE_DESCRICAO_NFSE, 1000);
checar("descricao: vazia e recusada", conferirDescricao("   "), { ok: false, motivo: "Informe a descrição do serviço." });
checar("descricao: nao e texto", conferirDescricao(null).ok, false);
checar("descricao: 1000 caracteres passam", conferirDescricao("a".repeat(1000)).ok, true);
checar("descricao: 1001 caracteres bloqueiam", conferirDescricao("a".repeat(1001)), { ok: false, motivo: "A descrição tem 1001 caracteres. O limite é 1000." });
checar("descricao: espaco nas pontas nao conta", conferirDescricao(`  ${"a".repeat(1000)}\n\n`).ok, true);
checar("descricao: quebra de linha do Windows conta como uma", conferirDescricao("a\r\nb"), { ok: true, texto: "a\nb" });

// 6. Valor, documento e endereço
checar("valor: numero", conferirValor(151.13), { ok: true, valor: 151.13 });
checar("valor: texto com virgula e milhar", conferirValor("1.234,56"), { ok: true, valor: 1234.56 });
checar("valor: texto com ponto decimal", conferirValor("151.13"), { ok: true, valor: 151.13 });
checar("valor: arredonda para centavos", conferirValor("10,005"), { ok: true, valor: 10.01 });
checar("valor: zero, negativo, vazio e texto sao recusados", [0, -5, "", "abc", null, 0.001].map((v) => conferirValor(v).ok), [false, false, false, false, false, false]);
checar("valor: igual ao do pedido", valorDifereDoPedido(171.21, 171.209), false);
checar("valor: diferente do pedido", valorDifereDoPedido(171.2, 171.209), true);

checar("documento: CPF", documentoDoTomador("123.456.789-09"), { ok: true, tipo: "CPF" });
checar("documento: CNPJ", documentoDoTomador("12.345.678/0001-90"), { ok: true, tipo: "CNPJ" });
checar("documento: vazio, curto e longo bloqueiam", ["", null, "1234567890", "123456789012345"].map((d) => documentoDoTomador(d).ok), [false, false, false, false]);

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
checar("endereco: escolhido e do cliente", conferirEndereco(A, [A, B]), { ok: true, idEndereco: A });
checar("endereco: caixa diferente e o mesmo endereco", conferirEndereco(A.toUpperCase(), [A]), { ok: true, idEndereco: A });
checar("endereco: obrigatorio quando o cliente tem algum", conferirEndereco(null, [A]), { ok: false, motivo: "Escolha o endereço do tomador." });
checar("endereco: de outro cliente e recusado", conferirEndereco(B, [A]), { ok: false, motivo: "O endereço informado não pertence ao tomador." });
checar("endereco: cliente sem endereco segue sem", conferirEndereco(null, []), { ok: true, idEndereco: null });
checar("endereco: cliente sem endereco nao aceita um de fora", conferirEndereco(A, []).ok, false);

// 7. Serviço
const servicoOk = { id: 1, nome: "Serviços de impressão", codigo: "13.05.01", nbs: "121011000", descricao: "SERVICOS DE IMPRESSAO", ativo: true };
checar("servico: o cadastrado hoje passa", conferirServico(servicoOk), { ok: true });
checar("servico: que nao existe", conferirServico(null), { ok: false, motivo: "Serviço não encontrado no cadastro de serviços da NFS-e." });
checar("servico: inativo", conferirServico({ ...servicoOk, ativo: false }), { ok: false, motivo: 'O serviço "Serviços de impressão" está inativo.' });
checar(
  "servico: sem codigo de tributacao (nulo, vazio, so pontos)",
  [null, "", " ", ".."].map((codigo) => conferirServico({ ...servicoOk, codigo }).ok),
  [false, false, false, false]
);
checar("servico: sem NBS", conferirServico({ ...servicoOk, nbs: null }), { ok: false, motivo: 'O serviço "Serviços de impressão" está sem NBS de 9 dígitos no cadastro.' });
checar(
  "servico: NBS com 8 ou 10 digitos, ou vazio",
  ["21012200", "1210110000", "", "abc"].map((nbs) => conferirServico({ ...servicoOk, nbs }).ok),
  [false, false, false, false]
);
checar("servico: NBS com pontuacao e 9 digitos passa", conferirServico({ ...servicoOk, nbs: "1.2101.10.00" }).ok, true);
checar(
  "servico: NBS de 9 digitos diferente do que o banco grava e recusado",
  conferirServico({ ...servicoOk, nbs: "121012200" }).ok,
  false
);
checar(
  "servico: a recusa do NBS diferente diz qual e o do banco",
  /121012200.*121011000/.test((conferirServico({ ...servicoOk, nbs: "121012200" }) as { motivo: string }).motivo),
  true
);

// 8. Nome do arquivo baixado
checar("arquivo: PDF com numero da NFS-e e do pedido", nomeDoArquivoNfse({ numeroNfse: "14", idInt: 23248, ref: "NFS-23248-001", tipo: "pdf" }), "NFS-e-14-Pedido-23248.pdf");
checar("arquivo: XML", nomeDoArquivoNfse({ numeroNfse: 14, idInt: 23248, ref: "NFS-23248-001", tipo: "xml" }), "NFS-e-14-Pedido-23248.xml");
checar("arquivo: numero com lixo fica so com letras e numeros", nomeDoArquivoNfse({ numeroNfse: " 14/2026 ", idInt: 23248, ref: "NFS-23248-001", tipo: "pdf" }), "NFS-e-142026-Pedido-23248.pdf");
checar("arquivo: sem numero da NFS-e vai a referencia", nomeDoArquivoNfse({ numeroNfse: null, idInt: 23248, ref: "NFS-23248-001", tipo: "pdf" }), "NFS-e-NFS-23248-001-Pedido-23248.pdf");
checar("arquivo: sem pedido", nomeDoArquivoNfse({ numeroNfse: "14", idInt: null, ref: "NFS-23248-001", tipo: "xml" }), "NFS-e-14.xml");
checar(
  "arquivo: nada que o sistema de arquivos recuse",
  /^[0-9A-Za-z.-]+$/.test(nomeDoArquivoNfse({ numeroNfse: '1"4<>', idInt: 23248, ref: `NFS/..${String.fromCharCode(92)} x:*?`, tipo: "pdf" })),
  true
);

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
