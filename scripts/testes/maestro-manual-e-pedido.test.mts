/**
 * Maestro: manual de uso, trava contra passo a passo inventado e consulta por pedido.
 *
 *   src/features/maestro/core/agent/maestro-agent-trava-manual.ts
 *   src/features/maestro/core/agent/maestro-agent-manual.server.ts
 *   src/features/maestro/core/agent/maestro-agent-acesso.server.ts
 *   src/features/maestro/core/agent/maestro-agent-pedido.server.ts
 *
 * NÃO TOCA EM BANCO NEM EM MODELO. As tabelas são listas em memória e o
 * "cliente Supabase" abaixo só filtra por igualdade e anota quais tabelas foram
 * lidas. O manual é lido dos arquivos reais de docs/manual.
 *
 * O QUE PROVA
 *   1. A resposta inventada de 01/10/2026 (boletos do pedido 22812, zero
 *      consultas) é barrada como passo a passo sem manual.
 *   2. Com a página lida, nome de botão que está na página passa; nome que não
 *      está é apontado. Orçamento e resposta de dados não disparam a trava.
 *   3. Vendedor consulta o próprio pedido e NÃO recebe nada do pedido de outro:
 *      nem cliente, nem valor, e nenhuma tabela além de propostas é lida.
 *   4. Cada parte exige a permissão da tela: vendedor dono vê situação e
 *      cobranças, não vê títulos da Carteira.
 *   5. Quem tem visão geral vê tudo, e nada sensível sai (linha digitável,
 *      nosso número, CPF/CNPJ).
 *   6. O índice do manual sai dos arquivos e a leitura acha a página pelo
 *      identificador ou pelo título.
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/maestro-manual-e-pedido.test.mts
 */
import {
  avaliarTravaDoManual,
  contarPassosImperativos,
  extrairRotulosDeTela,
  removerOfertaFinal,
} from "../../src/features/maestro/core/agent/maestro-agent-trava-manual.ts";
import {
  indiceDoManual,
  interpretarPagina,
  lerPaginasDoManual,
} from "../../src/features/maestro/core/agent/maestro-agent-manual.server.ts";
import {
  escopoDePedidos,
  pedidoEDoVendedor,
  podeNaTela,
  type AcessoUsuario,
} from "../../src/features/maestro/core/agent/maestro-agent-acesso.server.ts";
import { consultarPedido } from "../../src/features/maestro/core/agent/maestro-agent-pedido.server.ts";
import {
  conferirAssuntoDaResposta,
  lerVeredito,
  montarPedidoDeConferencia,
  respostaDeAssuntoSemPagina,
} from "../../src/features/maestro/core/agent/maestro-agent-conferencia.server.ts";

let falhas = 0;
function checar(nome: string, obtido: unknown, esperado: unknown) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok   " : "FALHA"} ${nome}${ok ? "" : `\n        obtido:   ${JSON.stringify(obtido)}\n        esperado: ${JSON.stringify(esperado)}`}`);
}

// ─── 1 e 2. Trava do manual ──────────────────────────────────────────────────

// Texto real que o Maestro devolveu em 01/10/2026 (maestro_mensagens 1698).
const RESPOSTA_INVENTADA = [
  "Para cancelar boletos de um pedido (como o 22812) no módulo Contas a Receber do ERP, é necessário seguir o fluxo oficial do sistema.",
  "",
  "O procedimento padrão é:",
  "",
  "1. **Acesse o módulo Contas a Receber** no ERP.",
  "2. **Localize o pedido** ou a cobrança pelo número do pedido (22812) ou pelo cliente.",
  "3. **Selecione o(s) boleto(s)** que deseja cancelar.",
  "4. **Utilize a opção de cancelamento** disponível na tela (normalmente um botão ou menu de ação).",
  "5. **Confirme o cancelamento** conforme solicitado pelo sistema.",
].join("\n");

checar("resposta inventada tem 5 passos no imperativo", contarPassosImperativos(RESPOSTA_INVENTADA), 5);
checar(
  "resposta inventada, sem manual lido → barrada",
  avaliarTravaDoManual({ texto: RESPOSTA_INVENTADA, manualLido: false, fontes: [] }).tipo,
  "passos_sem_manual"
);

const PAGINA = [
  "# Carteira (contas a receber)",
  "> **Onde fica:** menu Financeiro → Carteira (endereço `/contas-a-receber`)",
  "1. Na aba **Carteira**, abra o menu de ações e clique em **Cancelar recebível**.",
  "2. Leia o aviso da janela e clique em **Confirmar cancelamento**.",
  "Veja também o Registro de recebíveis, botão **Gerar títulos**.",
].join("\n");

const RESPOSTA_BOA = [
  "O pedido 22812 tem dois boletos em aberto.",
  "",
  "1. Abra **Financeiro → Carteira** e busque 22812.",
  "2. Em cada parcela, abra o menu de ações e escolha **Cancelar recebível**.",
  "3. Confirme em **Confirmar cancelamento**.",
  "4. Depois, no Registro de recebíveis, clique em **Gerar títulos**.",
].join("\n");

checar(
  "nomes extraídos da resposta boa",
  extrairRotulosDeTela(RESPOSTA_BOA).sort(),
  ["Cancelar recebível", "Carteira", "Confirmar cancelamento", "Financeiro", "Gerar títulos"]
);
checar(
  "resposta com nomes da página, manual lido → passa",
  avaliarTravaDoManual({ texto: RESPOSTA_BOA, manualLido: true, fontes: [PAGINA] }),
  { tipo: "ok" }
);
checar(
  "mesma resposta SEM manual lido → barrada",
  avaliarTravaDoManual({ texto: RESPOSTA_BOA, manualLido: false, fontes: [PAGINA] }).tipo,
  "passos_sem_manual"
);
checar(
  "botão que não está na página → apontado pelo nome",
  avaliarTravaDoManual({
    texto: RESPOSTA_BOA + "\n5. Por fim, clique em **Estornar título**.",
    manualLido: true,
    fontes: [PAGINA],
  }),
  { tipo: "nomes_fora_da_pagina", nomes: ["Estornar título"] }
);
checar(
  "acento e caixa diferentes não geram falso alarme",
  avaliarTravaDoManual({ texto: "Clique em **CANCELAR RECEBIVEL**.", manualLido: true, fontes: [PAGINA] }),
  { tipo: "ok" }
);

// Dois alarmes falsos vistos nas rodadas reais de 02/10/2026.
checar(
  "título em negrito no começo da linha não herda o verbo do parágrafo de cima",
  extrairRotulosDeTela("Você pode escolher entre dois caminhos:\n\n**1. Cancelar o título por inteiro (Cancelar recebível)**\n- Cancela a parcela."),
  []
);
checar(
  "verbo grudado no destaque não vira parte do nome",
  extrairRotulosDeTela("1. **Acesse o menu Financeiro → Carteira**.").sort(),
  ["Carteira", "Financeiro"]
);

checar(
  "despedida no fim sai, com o separador pendurado",
  removerOfertaFinal("1. Clique em **Cancelar recebível**.\n\n---\n\nQualquer dúvida sobre o caminho, só avisar!"),
  "1. Clique em **Cancelar recebível**."
);
checar(
  "pergunta de verdade no fim fica",
  removerOfertaFinal("Segue o orçamento.\n\nQuer que eu salve como proposta?"),
  "Segue o orçamento.\n\nQuer que eu salve como proposta?"
);
checar(
  "aviso com conteúdo no fim fica",
  removerOfertaFinal("Passos acima.\n\n- Título pago não pode ser cancelado.\n- Qualquer dúvida sobre a parcela paga, veja a Conferência."),
  "Passos acima.\n\n- Título pago não pode ser cancelado.\n- Qualquer dúvida sobre a parcela paga, veja a Conferência."
);

const ORCAMENTO = [
  "Segue o orçamento:",
  "🎟️ Pulseira Triband (25x2cm)",
  "📦 Quantidade: 1000 unidades — R$ 400,00",
  "🚚 Sedex: R$ 38,00",
  "💰 Total final: R$ 438,00",
  "",
  "1. Pulseira Triband",
  "2. Pulseira Texband",
].join("\n");
checar("orçamento não dispara a trava", avaliarTravaDoManual({ texto: ORCAMENTO, manualLido: false, fontes: [] }), { tipo: "ok" });
checar(
  "negrito de ênfase e valor não contam como nome de tela",
  extrairRotulosDeTela("**Importante:** o total é **R$ 3.972,00** e a parcela **2/2** vence em **21/11/2026**."),
  []
);
checar(
  "uma menção solta a uma tela não é passo a passo",
  avaliarTravaDoManual({ texto: "A proposta foi criada. O PDF pode ser gerado na tela **Pedidos**.", manualLido: false, fontes: [] }),
  { tipo: "ok" }
);

// ─── Cliente Supabase em memória ─────────────────────────────────────────────

type Linha = Record<string, unknown>;
function bancoFalso(tabelas: Record<string, Linha[]>) {
  const lidas: string[] = [];
  const cliente = {
    from(tabela: string) {
      lidas.push(tabela);
      let linhas = [...(tabelas[tabela] ?? [])];
      const b: Record<string, unknown> = {
        select: () => b,
        order: () => b,
        limit: () => b,
        eq: (coluna: string, valor: unknown) => {
          linhas = linhas.filter(l => l[coluna] === valor);
          return b;
        },
        in: (coluna: string, valores: unknown[]) => {
          linhas = linhas.filter(l => valores.includes(l[coluna]));
          return b;
        },
        maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
        then: (resolver: (r: { data: Linha[]; error: null }) => unknown) => resolver({ data: linhas, error: null }),
      };
      return b;
    },
  };
  return { cliente: cliente as never, lidas };
}

const LINHA_DIGITAVEL = "33690000090000000000000000000000000000000000001";
const TABELAS: Record<string, Linha[]> = {
  propostas: [
    {
      id_int: 22812, cliente: "CLIENTE DO ANDRE LTDA", id_cliente: 61478, id_faturado: 66631, vendedor: "André Toniazzo",
      empresa: "IDEAL GRÁFICA", created_at: "2026-09-28T21:00:51Z", status_interno: "APROVADO", is_prd_aprovado: false,
      is_reproved: false, is_avulso: false, valor_total: 7944, valor_frete: 0, libera_nf: false, faturado_fora_em: null,
    },
    { id_int: 30001, cliente: "CLIENTE DO JR", id_cliente: 1, vendedor: "Edison Jr", status_interno: "NOVO", valor_total: 100 },
  ],
  pagamentos_v2: [
    { id_int: 22812, id_pagamento: "22812-A", tipo_cobranca: "E-FATURADO", valor: 7944, status: "CANCELADO", confirmado: false, motivo_cancela: "erro", created_at: "2026-09-28T21:01:00Z" },
    { id_int: 22812, id_pagamento: "22812-B", tipo_cobranca: "E-FATURADO", valor: 7944, status: "A_VENCER", confirmado: true, boleto_enviadoo: true, vencimento: "2026-10-19", created_at: "2026-09-28T21:04:00Z" },
  ],
  boletos: [
    { id_int: 22812, parcela: 1, total_parcelas: 2, valor: 3972, vencimento: "2026-10-14", status: "A_VENCER", id_empresa: 1, id_boleto_c6: "01ABC", nosso_numero: "340945472", linha_digitavel: LINHA_DIGITAVEL, id_pagamento: "22812-B", documento: "37248444000150" },
    { id_int: 22812, parcela: 2, total_parcelas: 2, valor: 3972, vencimento: "2026-11-21", status: "A_VENCER", id_empresa: 1, id_boleto_c6: "01ABD", nosso_numero: "340945476", linha_digitavel: LINHA_DIGITAVEL, id_pagamento: "22812-B", documento: "37248444000150" },
  ],
  propostas_os: [],
  propostas_os_setores: [],
};

function acesso(parcial: Partial<AcessoUsuario> & { chaves?: string[] }): AcessoUsuario {
  return {
    encontrado: true, nome: null, nomeComercial: null, perfilNome: null, superAdmin: false, admin: false, ehVendedor: false,
    ...parcial,
    permissoes: new Set(parcial.chaves ?? []),
  };
}

const VENDEDOR = ["propostas.view_own", "propostas.create", "cobrancas.create", "cobrancas.cancel", "expedicao.view", "tarefas.participar"];
const andre = acesso({ nome: "André Toniazzo", nomeComercial: "André Toniazzo", perfilNome: "Vendedor", ehVendedor: true, chaves: VENDEDOR });
const emily = acesso({ nome: "Emily Boeira", nomeComercial: "Emily Boeira", perfilNome: "Vendedor", ehVendedor: true, chaves: VENDEDOR });
const edison = acesso({ nome: "Edison", nomeComercial: "Edison Jr.", perfilNome: "Vendedor", ehVendedor: true, chaves: VENDEDOR });
const financeiro = acesso({ nome: "Fin", perfilNome: "Financeiro", chaves: ["propostas.view", "propostas.view_all", "cobrancas.view", "contas_receber.view", "fiscal.view"] });
const designer = acesso({ nome: "Des", perfilNome: "Designer", chaves: ["propostas.view", "pedidos.view", "fiscal.view"] });
const pendente = acesso({ nome: "Novo", perfilNome: "Acesso Pendente", chaves: [] });

// ─── 3. Escopo por vendedor ──────────────────────────────────────────────────

checar("vendedor sem visão geral → só os próprios", escopoDePedidos(andre), "proprios");
checar("financeiro com Ver Todas as Propostas → todos", escopoDePedidos(financeiro), "todos");
checar("quem não vende → pela permissão de cada tela", escopoDePedidos(designer), "pela_tela");
checar("'Edison Jr.' casa com 'Edison Jr' do pedido", pedidoEDoVendedor(edison, "Edison Jr"), true);
checar("nome vazio nunca casa", pedidoEDoVendedor(acesso({ ehVendedor: true }), ""), false);
checar("administrador passa em qualquer tela", podeNaTela(acesso({ admin: true }), ["contas_receber.view"]), true);
checar("usuário não identificado não passa", podeNaTela({ ...andre, encontrado: false }, ["propostas.view_own"]), false);

{
  const { cliente, lidas } = bancoFalso(TABELAS);
  const r = await consultarPedido(cliente, emily, 22812, ["situacao", "cobrancas", "titulos"]);
  const texto = JSON.stringify(r);
  checar("vendedora em pedido de outro: recusado", [r.ok, r.motivo], [false, "PEDIDO_DE_OUTRO_VENDEDOR"]);
  checar("recusa não traz partes", r.secoes, undefined);
  checar("recusa não cita o cliente", texto.includes("CLIENTE DO ANDRE"), false);
  checar("recusa não cita o vendedor do pedido", texto.includes("Toniazzo"), false);
  checar("recusa não cita o valor", texto.includes("7944"), false);
  checar("só a tabela de propostas foi lida", lidas, ["propostas"]);
}

{
  const { cliente } = bancoFalso(TABELAS);
  const r = await consultarPedido(cliente, edison, 30001, ["situacao"]);
  checar("vendedor com ponto no nome consulta o próprio pedido", r.ok, true);
}

// ─── 4. Permissão por parte ──────────────────────────────────────────────────

{
  const { cliente, lidas } = bancoFalso(TABELAS);
  const r = await consultarPedido(cliente, andre, 22812, ["situacao", "cobrancas", "titulos"]);
  const s = (r.secoes ?? {}) as Record<string, Record<string, unknown>>;
  checar("vendedor dono: consulta aceita", r.ok, true);
  checar("vendedor dono vê a situação", [s.situacao.disponivel, s.situacao.valor_total], [true, 7944]);
  checar("vendedor dono vê as cobranças", [s.cobrancas.disponivel, s.cobrancas.quantidade], [true, 2]);
  checar("vendedor dono NÃO vê os títulos da Carteira", [s.titulos.disponivel, s.titulos.motivo, s.titulos.permissao_necessaria], [false, "SEM_PERMISSAO", "Visualizar Títulos"]);
  checar("a tabela de boletos nem é lida", lidas.includes("boletos"), false);
}

{
  const { cliente } = bancoFalso(TABELAS);
  const r = await consultarPedido(cliente, designer, 22812, ["situacao", "producao", "titulos", "cobrancas"]);
  const s = (r.secoes ?? {}) as Record<string, Record<string, unknown>>;
  checar("designer: situação e produção sim, financeiro não",
    [s.situacao.disponivel, s.producao.disponivel, s.titulos.disponivel, s.cobrancas.disponivel], [true, true, false, false]);
}

{
  const { cliente } = bancoFalso(TABELAS);
  const r = await consultarPedido(cliente, pendente, 22812, ["situacao", "titulos"]);
  const s = (r.secoes ?? {}) as Record<string, Record<string, unknown>>;
  checar("Acesso Pendente: nenhuma parte liberada", [s.situacao.disponivel, s.titulos.disponivel], [false, false]);
}

// ─── 5. Visão geral e campos sensíveis ───────────────────────────────────────

{
  const { cliente } = bancoFalso(TABELAS);
  const r = await consultarPedido(cliente, financeiro, 22812, ["cobrancas", "titulos"]);
  const texto = JSON.stringify(r);
  const s = (r.secoes ?? {}) as Record<string, Record<string, unknown>>;
  checar("financeiro: resumo das cobranças pronto", s.cobrancas.resumo, { ativas: 1, soma_das_ativas: 7944, pagas: 0, soma_das_pagas: 0, canceladas: 1 });
  checar("financeiro: resumo dos títulos pronto", s.titulos.resumo,
    { em_aberto: 2, soma_em_aberto: 7944, a_vencer: 2, vencidos: 0, pagos: 0, soma_dos_pagos: 0, cancelados: 0 });
  const titulo = (s.titulos.titulos as Record<string, unknown>[])[0];
  checar("título: situação, registro e banco calculados",
    [titulo.situacao_na_carteira, titulo.registrado_no_banco, titulo.banco, titulo.vencimento], ["Boleto registrado", true, "C6 Bank", "14/10/2026"]);
  checar("linha digitável não sai", texto.includes(LINHA_DIGITAVEL), false);
  checar("nosso número não sai", texto.includes("340945472"), false);
  checar("identificador do banco não sai", texto.includes("01ABC"), false);
  checar("CPF/CNPJ não sai", texto.includes("37248444000150"), false);
}

{
  const { cliente } = bancoFalso(TABELAS);
  checar("pedido que não existe", (await consultarPedido(cliente, financeiro, 99999, ["situacao"])).motivo, "PEDIDO_NAO_ENCONTRADO");
  checar("número inválido", (await consultarPedido(cliente, financeiro, "abc", ["situacao"])).motivo, "NUMERO_INVALIDO");
  checar("usuário não identificado não consulta", (await consultarPedido(cliente, { ...financeiro, encontrado: false }, 22812, ["situacao"])).motivo, "USUARIO_NAO_IDENTIFICADO");
}

// ─── 6. Manual ───────────────────────────────────────────────────────────────

{
  const p = interpretarPagina("carteira", PAGINA + "\n\n## Para que serve\n\nReúne os títulos.\n\n## Passo a passo\n\n### Cancelar um título\n\n1. ...\n");
  checar("página no formato antigo (Onde fica)", [p.titulo, p.ondeFica, p.paraQueServe, p.assuntos], [
    "Carteira (contas a receber)", "menu Financeiro → Carteira (endereço /contas-a-receber)", "Reúne os títulos.", ["Cancelar um título"],
  ]);

  const atual = interpretarPagina("tela", [
    "# Tela X", "", "> **Última revisão:** 02/10/2026", "> **Caminho no menu:** Financeiro → Tela X", "> **Endereço:** `/tela-x`", "",
    "## Passo a passo", "", "### Fazer algo", "", "1. Veja a [Carteira](carteira.md).", "",
    "## Arquivos de origem", "", "- `src/features/x/TelaX.tsx`", "- `src/app/api/x/route.ts`",
  ].join("\n"));
  checar("página no formato atual (Caminho no menu + Endereço)", [atual.ondeFica, atual.ultimaRevisao, atual.ligadas],
    ["Financeiro → Tela X, endereço /tela-x", "02/10/2026", ["carteira"]]);
  checar("a lista de arquivos de origem não vai para o modelo", [atual.conteudo.includes("Arquivos de origem"), atual.conteudo.includes("TelaX.tsx")], [false, false]);

  const indice = indiceDoManual();
  checar("índice lista a Carteira pelos arquivos reais", /^- carteira — Carteira/m.test(indice), true);
  checar("índice não lista o README nem o modelo", /^- (readme|_modelo)\b/im.test(indice), false);

  const porId = lerPaginasDoManual(["carteira"]);
  const porTitulo = lerPaginasDoManual(["Registro de recebíveis"]);
  checar("lê a página pelo identificador", [porId.encontradas.length, porId.encontradas[0]?.pagina], [1, "carteira"]);
  checar("lê a página pelo título", porTitulo.encontradas[0]?.pagina, "registro-de-recebiveis");
  checar("a página da Carteira traz o botão Cancelar recebível", porId.encontradas[0]?.conteudo.includes("**Cancelar recebível**"), true);
  const inexistente = lerPaginasDoManual(["../../.env.local", "pagina-que-nao-existe"]);
  checar("página inexistente (e caminho malicioso) não lê nada", [inexistente.encontradas.length, inexistente.nao_encontradas.length], [0, 2]);
}

// ─── 7. Conferência do assunto (sem chamar o modelo) ─────────────────────────

{
  checar("veredito: mesma tarefa", lerVeredito('{"tarefa_perguntada":"a","tarefa_ensinada":"a","mesma_tarefa":true}'), "mesma_tarefa");
  checar("veredito: outra tarefa", lerVeredito('{"mesma_tarefa":false}'), "outra_tarefa");
  checar("veredito ilegível não barra", [lerVeredito("não sei"), lerVeredito(null), lerVeredito('{"mesma_tarefa":"talvez"}')], ["nao_conferido", "nao_conferido", "nao_conferido"]);

  const pedido = montarPedidoDeConferencia({
    pergunta: "Como aprovo um cadastro de CPF que chegou pelo link?",
    historico: [],
    paginasLidas: ["carteira"],
    resposta: "1. Clique em **Cancelar recebível**.",
  });
  checar("pedido de conferência leva a pergunta, a página lida e a resposta",
    [pedido.includes("cadastro de CPF"), pedido.includes("Carteira (contas a receber)"), pedido.includes("Cancelar recebível")], [true, true, true]);

  const fixo = respostaDeAssuntoSemPagina(["carteira"]);
  checar("texto fixo cita a página lida e não ensina clique", [fixo.includes("Carteira (contas a receber)"), avaliarTravaDoManual({ texto: fixo, manualLido: false, fontes: [] }).tipo], [true, "ok"]);

  // Modelo simulado: falha e demora nunca derrubam a resposta.
  const entrada = { pergunta: "x", historico: [], paginasLidas: ["carteira"], resposta: "y" };
  const cliente = (conteudo: string | Error) => ({
    chat: { completions: { create: async () => { if (conteudo instanceof Error) throw conteudo; return { choices: [{ message: { content: conteudo } }] }; } } },
  });
  checar("modelo diz outra tarefa → barra", await conferirAssuntoDaResposta(cliente('{"mesma_tarefa":false}'), "m", entrada, 5000), "outra_tarefa");
  checar("modelo falha → não barra", await conferirAssuntoDaResposta(cliente(new Error("fora do ar")), "m", entrada, 5000), "nao_conferido");
  checar("sem tempo → nem chama", await conferirAssuntoDaResposta(cliente('{"mesma_tarefa":false}'), "m", entrada, 500), "nao_conferido");
  checar("sem página lida → nem chama", await conferirAssuntoDaResposta(cliente('{"mesma_tarefa":false}'), "m", { ...entrada, paginasLidas: [] }, 5000), "nao_conferido");
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
