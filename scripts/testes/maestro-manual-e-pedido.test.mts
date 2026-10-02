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
 *   7. A resposta de 02/10/2026 que entregou os dados do pedido 23020 com o
 *      número 23071, sem consultar nada, é barrada; "Fonte" sem consulta também.
 *   8. Cobrança paga e ainda não confirmada pelo financeiro sai como tal, e não
 *      como pedido "totalmente pago".
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/maestro-manual-e-pedido.test.mts
 */
import {
  avaliarTravaDoManual,
  contarPassosImperativos,
  extrairRotulosDeTela,
  instrucaoDeCorrecao,
  paginasDoIndiceCitadas,
  removerOfertaFinal,
  soNegaOManual,
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
  citaFonteSemConsulta,
  coletarNumerosDosArgumentos,
  correcaoDePedidoSemConsulta,
  extrairNumerosSoltosDePedido,
  extrairPedidosCitados,
  pedidosCitadosSemConsulta,
  removerLinhasDeFonte,
  respostaDePedidoSemConsulta,
} from "../../src/features/maestro/core/agent/maestro-agent-trava-pedido.ts";
import {
  escopoDoClienteNaConsulta,
  RecusaDeEscopoDoMaestro,
  registrarUsuarioDoMaestro,
} from "../../src/features/maestro/core/agent/maestro-agent-escopo.server.ts";
import { buscarBoletosCliente, resumoDeTitulosDoCliente } from "../../src/features/maestro/core/simple/maestro-simple-boletos.server.ts";
import {
  diasDeAtraso,
  hojeEmBrasilia,
  tituloCancelado,
  tituloEmAberto,
  tituloEmAtraso,
} from "../../src/features/maestro/core/simple/maestro-regra-titulos.ts";
import { buscarDetalheProposta, listarPropostasCliente } from "../../src/features/maestro/core/simple/maestro-simple-propostas.server.ts";
import {
  calcularFaturamentoOficial,
  calcularRecebimentoPeriodo,
  compararRecebimentoClienteMeses,
  diaCivilDoLimite,
  diasCivisDoIntervalo,
} from "../../src/features/maestro/core/simple/maestro-simple-pagamentos.server.ts";
import { buscarContaCorrenteCliente } from "../../src/features/maestro/core/simple/maestro-simple-conta-corrente.server.ts";
import { executeAgentTool } from "../../src/features/maestro/core/agent/maestro-agent-tools.ts";
import { resumirConsulta } from "../../src/features/maestro/core/agent/maestro-agent-loop.ts";
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
      let ordenado = false;
      let faixa: [number, number] | null = null;
      // Carimbo de tempo com fuso ("...-03:00" x "...Z") compara pelo instante; o resto, como texto.
      const cmp = (x: unknown, y: unknown) => {
        const a = String(x ?? ""), c = String(y ?? "");
        if (a.includes("T") && c.includes("T")) return Date.parse(a) - Date.parse(c);
        return a < c ? -1 : a > c ? 1 : 0;
      };
      const b: Record<string, unknown> = {
        select: () => b,
        // Só a PRIMEIRA ordenação vale (é a principal no PostgREST); as demais são desempate.
        order: (coluna: string, opcoes?: { ascending?: boolean }) => {
          if (ordenado) return b;
          ordenado = true;
          const sinal = opcoes?.ascending === false ? -1 : 1;
          linhas = [...linhas].sort((x, y) => sinal * cmp(x[coluna], y[coluna]));
          return b;
        },
        limit: () => b,
        eq: (coluna: string, valor: unknown) => {
          linhas = linhas.filter(l => l[coluna] === valor);
          return b;
        },
        in: (coluna: string, valores: unknown[]) => {
          linhas = linhas.filter(l => valores.includes(l[coluna]));
          return b;
        },
        // "id_cliente.eq.100,id_faturado.eq.100" ou "status.is.null,status.not.in.(A,B)"
        or: (expr: string) => {
          const termos = expr.split(/,(?![^(]*\))/);
          linhas = linhas.filter(l => termos.some(termo => {
            const eq = /^(\w+)\.eq\.(.*)$/.exec(termo);
            if (eq) return String(l[eq[1]]) === eq[2];
            const nulo = /^(\w+)\.is\.null$/.exec(termo);
            if (nulo) return l[nulo[1]] == null;
            const fora = /^(\w+)\.not\.in\.\((.*)\)$/.exec(termo);
            if (fora) return l[fora[1]] != null && !fora[2].split(",").includes(String(l[fora[1]]));
            throw new Error("or() nao previsto no banco em memoria: " + termo);
          }));
          return b;
        },
        range: (de: number, ate: number) => {
          faixa = [de, ate];
          return b;
        },
        is: (coluna: string, valor: unknown) => {
          linhas = linhas.filter(l => (l[coluna] ?? null) === valor);
          return b;
        },
        not: (coluna: string, _op: string, valor: unknown) => {
          linhas = linhas.filter(l => (l[coluna] ?? null) !== valor);
          return b;
        },
        gt: (coluna: string, valor: number) => {
          linhas = linhas.filter(l => Number(l[coluna] ?? 0) > valor);
          return b;
        },
        gte: (coluna: string, valor: string) => {
          linhas = linhas.filter(l => cmp(l[coluna], valor) >= 0);
          return b;
        },
        lte: (coluna: string, valor: string) => {
          linhas = linhas.filter(l => cmp(l[coluna], valor) <= 0);
          return b;
        },
        lt: (coluna: string, valor: string) => {
          linhas = linhas.filter(l => cmp(l[coluna], valor) < 0);
          return b;
        },
        maybeSingle: async () => ({ data: linhas[0] ?? null, error: null }),
        then: (resolver: (r: { data: Linha[]; error: null }) => unknown) =>
          resolver({ data: faixa ? linhas.slice(faixa[0], faixa[1] + 1) : linhas, error: null }),
      };
      return b;
    },
    rpc: async () => ({ data: null, error: null }),
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
    { id_int: 22812, parcela: 1, total_parcelas: 2, valor: 3972, vencimento: "2099-10-14", status: "A_VENCER", id_empresa: 1, id_boleto_c6: "01ABC", nosso_numero: "340945472", linha_digitavel: LINHA_DIGITAVEL, id_pagamento: "22812-B", documento: "37248444000150" },
    { id_int: 22812, parcela: 2, total_parcelas: 2, valor: 3972, vencimento: "2099-11-21", status: "A_VENCER", id_empresa: 1, id_boleto_c6: "01ABD", nosso_numero: "340945476", linha_digitavel: LINHA_DIGITAVEL, id_pagamento: "22812-B", documento: "37248444000150" },
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
  checar("financeiro: resumo das cobranças pronto", s.cobrancas.resumo, {
    ativas: 1, soma_das_ativas: 7944,
    confirmadas_pelo_financeiro: { quantidade: 1, soma: 7944 },
    pagas_aguardando_conferencia: { quantidade: 0, soma: 0 },
    a_vencer_aguardando_conferencia: { quantidade: 0, soma: 0 },
    aguardando_pagamento: { quantidade: 0, soma: 0 },
    canceladas: 1,
  });
  checar("financeiro: faturado aprovado cobre o pedido",
    [(s.cobrancas.cobertura as Linha).situacao, (s.cobrancas.cobertura as Linha).falta_confirmar], ["COBERTO_E_CONFIRMADO", 0]);
  checar("financeiro: resumo dos títulos pronto", s.titulos.resumo,
    { em_aberto: 2, soma_em_aberto: 7944, a_vencer: 2, vencidos: 0, pagos: 0, soma_dos_pagos: 0, cancelados: 0 });
  const titulo = (s.titulos.titulos as Record<string, unknown>[])[0];
  checar("título: situação, registro e banco calculados",
    [titulo.situacao_na_carteira, titulo.registrado_no_banco, titulo.banco, titulo.vencimento], ["Boleto registrado", true, "C6 Bank", "14/10/2099"]);
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
  checar("texto fixo cita a página lida e não ensina clique", [fixo.includes("Carteira (contas a receber)"), contarPassosImperativos(fixo) + extrairRotulosDeTela(fixo).length], [true, 0]);

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

// ─── 8. Trava de vendedor nas consultas POR CLIENTE ──────────────────────────
// Cliente 100: carteira da Emily, mas com um pedido do André e um pedido do
//   André faturado para ele. Cliente 200: do André. Cliente 300: carteira do
//   André, onde a Emily tem um pedido.

{
  const U_EMILY = "u-emily", U_FIN = "u-fin", U_DESIGNER = "u-des";
  const agora = new Date().toISOString();
  const boleto = (idCliente: number, idInt: number | null) =>
    ({ id_cliente: idCliente, id_int: idInt, paid_at: null, status: "A_VENCER", valor: 10, vencimento: "2099-12-01", dias_atraso: 0 });
  const TAB: Record<string, Linha[]> = {
    usuarios: [
      { user_id: U_EMILY, id_perfil: 4, is_super_adm: false, is_admin: false, is_vendedor: true, nome_usuario: "Emily Boeira", meu_vendedor: "Emily Boeira" },
      { user_id: U_FIN, id_perfil: 3, is_super_adm: false, is_admin: false, is_vendedor: false, nome_usuario: "Fin", meu_vendedor: null },
      { user_id: U_DESIGNER, id_perfil: 6, is_super_adm: false, is_admin: false, is_vendedor: false, nome_usuario: "Des", meu_vendedor: null },
    ],
    perfis: [
      { id: 4, ativo: true, nome: "Vendedor", permissoes: VENDEDOR },
      { id: 3, ativo: true, nome: "Financeiro", permissoes: ["propostas.view", "propostas.view_all", "contas_receber.view"] },
      { id: 6, ativo: true, nome: "Designer", permissoes: ["propostas.view", "pedidos.view"] },
    ],
    clientes: [
      { id_cliente: 100, nome_vendedor: "Emily Boeira" },
      { id_cliente: 200, nome_vendedor: "André Toniazzo" },
      { id_cliente: 300, nome_vendedor: "André Toniazzo" },
    ],
    propostas: [
      { id_int: 1001, id_cliente: 100, vendedor: "Emily Boeira", is_reproved: false, is_prd_aprovado: true, valor_total: 100, status_interno: "APROVADO", created_at: agora },
      { id_int: 1002, id_cliente: 100, vendedor: "André Toniazzo", is_reproved: false, is_prd_aprovado: true, valor_total: 900, status_interno: "APROVADO", created_at: agora },
      { id_int: 2001, id_cliente: 200, vendedor: "André Toniazzo", is_reproved: false, is_prd_aprovado: true, valor_total: 500, status_interno: "APROVADO", created_at: agora },
      { id_int: 3001, id_cliente: 300, vendedor: "Emily Boeira", is_reproved: false, is_prd_aprovado: true, valor_total: 70, status_interno: "NOVO", created_at: agora },
      { id_int: 3002, id_cliente: 300, vendedor: "André Toniazzo", is_reproved: false, is_prd_aprovado: true, valor_total: 80, status_interno: "NOVO", created_at: agora },
      { id_int: 4001, id_cliente: 999, id_faturado: 100, vendedor: "André Toniazzo", is_reproved: false, valor_total: 40, created_at: agora },
    ],
    boletos: [boleto(100, 1001), boleto(100, 1002), boleto(100, 4001), boleto(100, 5555), boleto(200, 2001), boleto(300, 3001), boleto(300, 3002), boleto(300, 6666)],
    pagamentos_v2: [
      { id_cliente: 100, id_int: 1001, valor: 100, status: "PAID", confirmado: true, paid_at: agora, tipo_cobranca: "PIX" },
      { id_cliente: 100, id_int: 1002, valor: 900, status: "PAID", confirmado: true, paid_at: agora, tipo_cobranca: "PIX" },
    ],
    conta_corrente_pendencias: [
      { id_cliente: 100, id_int: 1001, direcao: "FAVOR_CLIENTE", status: "ABERTA", valor_saldo: 5, created_at: agora },
      { id_cliente: 100, id_int: 1002, direcao: "FAVOR_CLIENTE", status: "ABERTA", valor_saldo: 50, created_at: agora },
    ],
    movimento_credito: [],
  };

  const sessao = (userId: string | null) => {
    const banco = bancoFalso(TAB);
    if (userId) registrarUsuarioDoMaestro(banco.cliente, userId);
    return banco;
  };
  const recusaDe = async (f: () => Promise<unknown>): Promise<string> => {
    try {
      await f();
      return "SEM RECUSA";
    } catch (e) {
      return e instanceof RecusaDeEscopoDoMaestro ? e.codigo : `outro erro: ${String(e)}`;
    }
  };
  const ids = (r: { items: Array<{ id_int: number | null }> }) => r.items.map(i => i.id_int).sort();

  // Cliente que não é dela: recusa antes de ler qualquer dado financeiro.
  {
    const { cliente, lidas } = sessao(U_EMILY);
    checar("vendedora, cliente de outro vendedor: boletos recusados", await recusaDe(() => buscarBoletosCliente(cliente, 200, "todos")), "CLIENTE_DE_OUTRO_VENDEDOR");
    checar("... propostas recusadas", await recusaDe(() => listarPropostasCliente(cliente, 200)), "CLIENTE_DE_OUTRO_VENDEDOR");
    checar("... recebimentos recusados", await recusaDe(() => calcularRecebimentoPeriodo(cliente, 200, { tipo: "mes_atual", label: "mês atual" })), "CLIENTE_DE_OUTRO_VENDEDOR");
    checar("... comparação de meses recusada (não vira 'sem dados')", await recusaDe(() => compararRecebimentoClienteMeses(cliente, 200, [{ startDate: "2026-09-01", endDate: "2026-10-01", label: "set" }])), "CLIENTE_DE_OUTRO_VENDEDOR");
    checar("... conta corrente recusada", await recusaDe(() => buscarContaCorrenteCliente(cliente, 200)), "CLIENTE_DE_OUTRO_VENDEDOR");
    checar("... faturamento do cliente recusado", await recusaDe(() => calcularFaturamentoOficial(cliente, { desde: "2026-01-01", periodoLabel: "ano", idCliente: 200 })), "CLIENTE_DE_OUTRO_VENDEDOR");
    checar("... e nenhuma tabela financeira foi lida", lidas.filter(t => ["boletos", "pagamentos_v2", "conta_corrente_pendencias", "movimento_credito"].includes(t)), []);
  }

  // Cliente da carteira dela, com pedidos de outro vendedor no meio.
  {
    const { cliente } = sessao(U_EMILY);
    checar("carteira dela: boletos só dos pedidos dela e o avulso", ids(await buscarBoletosCliente(cliente, 100, "todos")), [1001, 5555]);
    const props = await listarPropostasCliente(cliente, 100);
    checar("carteira dela: só as propostas dela", [props.count, props.totalValor, ids(props)], [1, 100, [1001]]);
    checar("carteira dela: recebimento só do pedido dela", (await calcularRecebimentoPeriodo(cliente, 100, { tipo: "mes_atual", label: "mês atual" })).totalValor, 100);
    const cc = await buscarContaCorrenteCliente(cliente, 100);
    checar("carteira dela: pendência só do pedido dela", [cc.pendencias.length, cc.pendencias_abertas.favor_cliente.saldo], [1, 5]);
    const detalhe = await buscarDetalheProposta(cliente, 100, 1002);
    checar("proposta do outro vendedor no cliente dela: recusada", [detalhe.found, detalhe.proposta, String(detalhe.error).split(":")[0]], [false, null, "PEDIDO_DE_OUTRO_VENDEDOR"]);
    checar("a proposta dela abre", (await buscarDetalheProposta(cliente, 100, 1001)).found, true);
  }

  // Cliente da carteira de outro, mas com pedido dela: só o pedido dela, sem o avulso.
  {
    const { cliente } = sessao(U_EMILY);
    checar("pedido dela em cliente de outro: só o boleto do pedido dela", ids(await buscarBoletosCliente(cliente, 300, "todos")), [3001]);
  }

  // Visão geral e quem não vende: tudo como antes.
  {
    const { cliente } = sessao(U_FIN);
    checar("visão geral: todos os boletos do cliente", ids(await buscarBoletosCliente(cliente, 100, "todos")), [1001, 1002, 4001, 5555]);
    checar("visão geral: cliente de qualquer vendedor", ids(await buscarBoletosCliente(cliente, 200, "todos")), [2001]);
    checar("visão geral: todas as propostas", (await listarPropostasCliente(cliente, 100)).count, 2);
  }
  {
    const { cliente } = sessao(U_DESIGNER);
    checar("quem não vende: sem recorte por vendedor (como antes)", ids(await buscarBoletosCliente(cliente, 200, "todos")), [2001]);
  }

  // Falha fechada.
  {
    const { cliente } = sessao(null);
    checar("requisição sem usuário registrado: recusada", await recusaDe(() => buscarBoletosCliente(cliente, 100, "todos")), "USUARIO_NAO_IDENTIFICADO");
    const desconhecido = sessao("u-que-nao-existe");
    checar("usuário que não existe: recusado", await recusaDe(() => buscarBoletosCliente(desconhecido.cliente, 100, "todos")), "USUARIO_NAO_IDENTIFICADO");
    checar("escopo sem recorte para quem tem visão geral", (await escopoDoClienteNaConsulta(sessao(U_FIN).cliente, 200)).restrito, false);
  }

  // Pela ferramenta do agente: a recusa chega ao modelo com o código, sem dado.
  {
    const { cliente, lidas } = bancoFalso(TAB);
    const ctx = {
      supabase: cliente,
      userId: U_EMILY,
      state: { activeClient: null, resolvedClientIds: new Set([100, 200]), pendingClientCandidates: null, pendingWriteAction: null, currentTurnId: "t1" },
    };
    const negada = await executeAgentTool("boletos_cliente", { id_cliente: 200 }, ctx as never);
    checar("ferramenta boletos_cliente em cliente de outro: recusa com código", [negada.ok, String(negada.error).split(":")[0], negada.result], [false, "CLIENTE_DE_OUTRO_VENDEDOR", undefined]);
    checar("... sem ler a tabela de boletos", lidas.includes("boletos"), false);
    checar("... e a auditoria guarda só o código", resumirConsulta("boletos_cliente", { id_cliente: 200 }, false, null, negada.error),
      { ferramenta: "boletos_cliente", ok: false, recusa: "CLIENTE_DE_OUTRO_VENDEDOR" });

    const aceita = await executeAgentTool("boletos_cliente", { id_cliente: 100 }, ctx as never);
    const r = (aceita.result ?? {}) as { count?: number; escopo_aplicado?: string };
    checar("ferramenta no cliente dela: só os dela, com o aviso do recorte", [aceita.ok, r.count, typeof r.escopo_aplicado], [true, 2, "string"]);

    const cadastro = await executeAgentTool("enderecos_cliente", { id_cliente: 200 }, ctx as never);
    checar("cadastro do cliente de outro continua disponível (cotação e frete dependem dele)", cadastro.ok, true);
  }
}

// ─── 9. Regra única de título em aberto e em atraso (02/10/2026) ─────────────

{
  const HOJE = "2026-10-02";
  // A regra, sem banco.
  checar("a receber sem pagamento está em aberto (era o caso do cliente 63708)", tituloEmAberto({ status: "A_RECEBER", paid_at: null }), true);
  checar("a vencer, vencido e sem status estão em aberto",
    [tituloEmAberto({ status: "A_VENCER" }), tituloEmAberto({ status: "VENCIDO" }), tituloEmAberto({ status: null })], [true, true, true]);
  checar("cancelado não está em aberto, em qualquer grafia",
    [tituloEmAberto({ status: "CANCELADO" }), tituloEmAberto({ status: "CANCELADA" }), tituloEmAberto({ status: " cancelado " }), tituloCancelado({ status: "Cancelado" })],
    [false, false, false, true]);
  checar("pago não está em aberto", [tituloEmAberto({ status: "A_VENCER", paid_at: "2026-09-30T10:00:00Z" }), tituloEmAberto({ status: "PAID" })], [false, false]);
  checar("vence hoje: ainda não está em atraso", [tituloEmAtraso({ status: "A_VENCER", vencimento: HOJE }, HOJE), diasDeAtraso({ vencimento: HOJE }, HOJE)], [false, 0]);
  checar("venceu ontem: 1 dia de atraso, em qualquer status",
    [diasDeAtraso({ status: "A_VENCER", vencimento: "2026-10-01" }, HOJE), diasDeAtraso({ status: "A_RECEBER", vencimento: "2026-10-01" }, HOJE)], [1, 1]);
  checar("atraso atravessa mês e ano", [diasDeAtraso({ vencimento: "2026-08-02" }, HOJE), diasDeAtraso({ vencimento: "2025-12-31" }, "2026-01-01")], [61, 1]);
  checar("cancelado com vencimento antigo não está em atraso", [tituloEmAtraso({ status: "CANCELADO", vencimento: "2026-08-02" }, HOJE), diasDeAtraso({ status: "CANCELADO", vencimento: "2026-08-02" }, HOJE)], [false, 0]);
  checar("pago depois do vencimento não está em atraso", tituloEmAtraso({ status: "PAID", paid_at: "2026-09-01T00:00:00Z", vencimento: "2026-08-02" }, HOJE), false);
  checar("sem vencimento não está em atraso", tituloEmAtraso({ status: "A_VENCER", vencimento: null }, HOJE), false);
  // 02:30 UTC de 03/10 ainda é 23:30 de 02/10 em Brasília: o dia que vale é o de Brasília.
  checar("hoje é o dia de Brasília, não o de UTC", hojeEmBrasilia(new Date("2026-10-03T02:30:00Z")), "2026-10-02");

  // As três consultas, com o banco em memória. Vencimentos relativos a hoje.
  const dia = (delta: number) => {
    const d = new Date(hojeEmBrasilia() + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  };
  const T: Record<string, Linha[]> = {
    usuarios: [{ user_id: "u-fin", id_perfil: 3, is_super_adm: false, is_admin: false, is_vendedor: false, nome_usuario: "Fin", meu_vendedor: null }],
    perfis: [{ id: 3, ativo: true, nome: "Financeiro", permissoes: ["propostas.view_all"] }],
    boletos: [
      { id_cliente: 700, id_int: 1, status: "A_VENCER", paid_at: null, valor: 100, vencimento: dia(10), dias_atraso: 0 },
      { id_cliente: 700, id_int: 2, status: "A_RECEBER", paid_at: null, valor: 1710.69, vencimento: dia(1), dias_atraso: 0 },
      { id_cliente: 700, id_int: 3, status: "A_RECEBER", paid_at: null, valor: 50, valor_atualizado: 55, vencimento: dia(-3), dias_atraso: 0 },
      { id_cliente: 700, id_int: 4, status: "VENCIDO", paid_at: null, valor: 200, valor_atualizado: 210, vencimento: dia(-20), dias_atraso: 20 },
      // Cancelado com dias de atraso congelados pela rotina antiga: não é dívida.
      { id_cliente: 700, id_int: 5, status: "CANCELADO", paid_at: null, valor: 119.27, vencimento: dia(-48), dias_atraso: 48 },
      // O "Substituído" do Refazer boleto: cancelado com a marca.
      { id_cliente: 700, id_int: 6, status: "CANCELADO", paid_at: null, valor: 300, vencimento: dia(-5), dias_atraso: 5, motivo_prorg: "Substituído pelo Refazer boleto em 01/10/2026" },
      { id_cliente: 700, id_int: 7, status: "PAID", paid_at: "2026-09-05T12:00:00Z", valor: 540.01, vencimento: dia(-27), dias_atraso: 0 },
    ],
  };
  const banco = bancoFalso(T);
  registrarUsuarioDoMaestro(banco.cliente, "u-fin");

  const abertos = await buscarBoletosCliente(banco.cliente, 700, "aberto");
  const todos = await buscarBoletosCliente(banco.cliente, 700, "todos");
  const naoLiquidados = await buscarBoletosCliente(banco.cliente, 700, "nao_liquidado");
  const atrasados = await buscarBoletosCliente(banco.cliente, 700, "atraso");

  checar("em aberto: os quatro sem pagamento e não cancelados, do vencimento mais antigo ao mais novo",
    abertos.items.map(i => i.id_int), [4, 3, 2, 1]);
  checar("em aberto inclui o título A_RECEBER de R$ 1.710,69", abertos.items.some(i => i.valor === 1710.69 && i.status === "A_RECEBER"), true);
  checar("em aberto não traz o cancelado, o substituído nem o pago", abertos.items.some(i => [5, 6, 7].includes(i.id_int)), false);
  checar("'todos' e 'não liquidados' são a mesma lista do em aberto",
    [todos.items.map(i => i.id_int), naoLiquidados.items.map(i => i.id_int), todos.filtro], [[4, 3, 2, 1], [4, 3, 2, 1], "em aberto"]);
  checar("em atraso: só os em aberto com vencimento antes de hoje", [atrasados.items.map(i => i.id_int), atrasados.count], [[4, 3], 2]);
  checar("dias de atraso pelo vencimento, não pela coluna da rotina", atrasados.items.map(i => [i.id_int, i.dias_atraso, i.em_atraso]), [[4, 20, true], [3, 3, true]]);
  checar("quem vence amanhã ou depois não está em atraso", abertos.items.filter(i => !i.em_atraso).map(i => [i.id_int, i.dias_atraso]), [[2, 0], [1, 0]]);
  const resumoEsperado = { em_aberto: { quantidade: 4, soma_valor: 2060.69 }, em_atraso: { quantidade: 2, soma_valor: 265 } };
  checar("resumo pronto e igual nas três consultas", [abertos.resumo, atrasados.resumo, todos.resumo], [resumoEsperado, resumoEsperado, resumoEsperado]);
  checar("resumo da visão geral sai da mesma regra", (await resumoDeTitulosDoCliente(banco.cliente, 700)).resumo, resumoEsperado);

  // A consulta por pedido usa a mesma regra para vencido e para dias de atraso.
  const TP: Record<string, Linha[]> = {
    propostas: [{ id_int: 9001, cliente: "X", id_cliente: 700, vendedor: "Y", status_interno: "APROVADO", valor_total: 1 }],
    boletos: [
      { id_int: 9001, parcela: 1, total_parcelas: 3, valor: 50, status: "A_RECEBER", paid_at: null, vencimento: dia(-3), dias_atraso: 0 },
      { id_int: 9001, parcela: 2, total_parcelas: 3, valor: 60, status: "A_VENCER", paid_at: null, vencimento: dia(30) },
      { id_int: 9001, parcela: 3, total_parcelas: 3, valor: 70, status: "CANCELADO", paid_at: null, vencimento: dia(-40), dias_atraso: 40, motivo_prorg: "Substituído pelo Refazer boleto em 01/10/2026" },
    ],
  };
  const pedido = await consultarPedido(bancoFalso(TP).cliente, financeiro, 9001, ["titulos"]);
  const st = ((pedido.secoes ?? {}) as Record<string, Record<string, unknown>>).titulos;
  const lista = st.titulos as Record<string, unknown>[];
  checar("pedido: a receber vencido conta como vencido; o substituído fica como cancelado",
    st.resumo, { em_aberto: 2, soma_em_aberto: 110, a_vencer: 1, vencidos: 1, pagos: 0, soma_dos_pagos: 0, cancelados: 1 });
  checar("pedido: situação e dias de atraso de cada título",
    lista.map(t => [t.parcela, t.situacao_na_carteira, t.dias_de_atraso, t.substituido_pelo_refazer_boleto]),
    [[1, "Vencido", 3, false], [2, "A receber criado — boleto não registrado", null, false], [3, "Cancelado", null, true]]);
}

// ─── 10. Faturamento: leitura até o fim, dia de Brasília e total da visão do Dashboard ──
// Defeito de 02/10/2026: setembro tinha 1.335 cobranças, o banco entrega 1.000
// por leitura, e o Maestro respondeu R$ 780.657,05 no lugar de R$ 1.121.100,46.

{
  checar("meia-noite UTC do dia 1 vale como o dia 1 do calendário", diaCivilDoLimite("2026-09-01T00:00:00.000Z"), "2026-09-01");
  checar("23:56 de 30/09 em Brasília é 30/09, mesmo já sendo 01/10 em UTC", diaCivilDoLimite("2026-10-01T02:56:00.000Z"), "2026-09-30");
  checar("meia-noite de Brasília de 01/10 é 01/10", diaCivilDoLimite("2026-10-01T03:00:00.000Z"), "2026-10-01");
  checar("mês passado: do dia 1 ao dia 30", diasCivisDoIntervalo("2026-09-01T00:00:00.000Z", "2026-10-01T00:00:00.000Z"), { diaInicio: "2026-09-01", diaFim: "2026-09-30" });
  checar("um dia de Brasília: começa e termina nele", diasCivisDoIntervalo("2026-10-02T03:00:00.000Z", "2026-10-03T03:00:00.000Z"), { diaInicio: "2026-10-02", diaFim: "2026-10-02" });
  checar("sem fim: vai até hoje em Brasília", diasCivisDoIntervalo("2026-10-01T00:00:00.000Z", undefined, new Date("2026-10-03T01:00:00Z")), { diaInicio: "2026-10-01", diaFim: "2026-10-02" });

  // 2.300 cobranças em setembro (uma a cada 18 minutos), mais os casos de borda.
  const pagamentos: Linha[] = [];
  const inicioSet = Date.parse("2026-09-01T03:00:00Z"); // 00:00 de 01/09 em Brasília
  for (let i = 0; i < 2300; i++) {
    pagamentos.push({
      id: `p${String(i).padStart(5, "0")}`,
      // A cada 500, duas cobranças da MESMA proposta.
      id_int: 50000 + (i % 500 === 1 ? i - 1 : i),
      id_cliente: 1,
      valor: 100 + (i % 7),
      confirmado: true,
      status: i % 10 === 0 ? "A_VENCER" : "PAID",
      data_confirmacao: new Date(inicioSet + i * 18 * 60_000).toISOString(),
      id_empresa: 1 + (i % 3),
      empresa: `Empresa ${1 + (i % 3)}`,
      // 17 cortesias, todas entre as 1.000 mais recentes (era o que mascarava o aviso).
      tipo_cobranca: i >= 1300 && i % 60 === 0 ? "E-AMOSTRA" : "PIX",
    });
  }
  const borda = (id: string, quando: string, extra: Linha = {}) =>
    ({ id, id_int: 90000 + pagamentos.length, id_cliente: 1, valor: 120, confirmado: true, status: "PAID", data_confirmacao: quando, id_empresa: 1, empresa: "Empresa 1", tipo_cobranca: "PIX", ...extra });
  pagamentos.push(borda("b1", "2026-10-01T02:56:00.000Z"));                       // 30/09 23:56 em Brasília: DENTRO
  pagamentos.push(borda("b2", "2026-09-01T01:00:00.000Z"));                       // 31/08 22:00 em Brasília: fora
  pagamentos.push(borda("b3", "2026-10-01T03:00:00.000Z"));                       // 01/10 00:00 em Brasília: fora
  pagamentos.push(borda("b4", "2026-09-15T15:00:00.000Z", { status: "A_RECEBER" })); // não confirmada pelo status: fora
  pagamentos.push(borda("b5", "2026-09-15T15:01:00.000Z", { confirmado: false }));   // não confirmada: fora
  pagamentos.push(borda("b6", "2026-09-15T15:02:00.000Z", { id_int: null }));        // sem proposta: o valor conta
  pagamentos.push(borda("b7", "2026-09-15T15:03:00.000Z", { tipo_cobranca: null })); // sem tipo: conta

  // O que o banco responderia: a regra da visão do Dashboard, escrita à parte.
  const diaSP = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
  const naRegra = pagamentos.filter(p =>
    p.confirmado === true && ["PAID", "A_VENCER"].includes(String(p.status)) && p.data_confirmacao != null &&
    !["E-AMOSTRA", "E-RETRABALHO"].includes(String(p.tipo_cobranca ?? "").trim().toUpperCase()));
  const visao = new Map<string, Linha>();
  for (const p of naRegra) {
    const chave = `${diaSP(String(p.data_confirmacao))}|${p.id_empresa}|${p.status}`;
    const v = visao.get(chave) ?? { data: diaSP(String(p.data_confirmacao)), id_empresa: p.id_empresa, status: p.status, total: 0, quantidade: 0 };
    v.total = Number(v.total) + Number(p.valor);
    v.quantidade = Number(v.quantidade) + 1;
    visao.set(chave, v);
  }
  const deSetembro = naRegra.filter(p => diaSP(String(p.data_confirmacao)).startsWith("2026-09"));
  const esperado = {
    valor: Math.round(deSetembro.reduce((t, p) => t + Number(p.valor), 0) * 100) / 100,
    cobrancas: deSetembro.length,
    propostas: new Set(deSetembro.filter(p => p.id_int != null).map(p => p.id_int)).size,
  };
  checar("o cenário tem mais de 2.000 cobranças e proposta com duas cobranças", [esperado.cobrancas > 2000, esperado.propostas < esperado.cobrancas], [true, true]);

  const TF: Record<string, Linha[]> = {
    pagamentos_v2: pagamentos,
    view_pagamentos_pagos_v2: [...visao.values()],
    propostas: pagamentos.filter(p => p.id_int != null).map(p => ({ id_int: p.id_int, vendedor: Number(p.id_int) % 2 === 0 ? "Ana" : "Bia" })),
  };
  const SETEMBRO = { desde: "2026-09-01T00:00:00.000Z", ate: "2026-10-01T00:00:00.000Z", periodoLabel: "setembro" };

  const total = await calcularFaturamentoOficial(bancoFalso(TF).cliente, { ...SETEMBRO, agruparPorEmpresa: true, agruparPorVendedor: true });
  checar("faturamento do mês inteiro, sem cortar em 1.000 linhas", [total.faturamento, total.total_cobrancas, total.total_propostas], [esperado.valor, esperado.cobrancas, esperado.propostas]);
  checar("o período sai em dias de Brasília", total.dias, { inicio: "01/09/2026", fim: "30/09/2026" });
  checar("o total vem da visão do Dashboard e confere com a soma linha a linha", [total.conferencia?.confere, total.conferencia?.soma_linha_a_linha], [true, esperado.valor]);
  checar("leitura completa: sem aviso de incompleto", [total.truncado, total.aviso_truncamento], [false, undefined]);
  checar("a resposta nomeia a medida", [total.medida.startsWith("FATURAMENTO"), total.medida.includes("NÃO é o dinheiro que entrou em caixa")], [true, true]);
  const somaEmpresas = (total.por_empresa ?? []).reduce((t, e) => t + e.faturamento, 0);
  const cobrancasEmpresas = (total.por_empresa ?? []).reduce((t, e) => t + e.cobrancas, 0);
  checar("por empresa: valores e cobranças fecham com o total", [Math.round(somaEmpresas * 100) / 100, cobrancasEmpresas, (total.por_empresa ?? []).length], [esperado.valor, esperado.cobrancas, 3]);
  const somaVendedores = (total.por_vendedor ?? []).reduce((t, v) => t + v.faturamento, 0);
  checar("por vendedor: lido até o fim, fecha com o total", [Math.round(somaVendedores * 100) / 100, (total.por_vendedor ?? []).reduce((t, v) => t + v.cobrancas, 0)], [esperado.valor, esperado.cobrancas]);
  checar("a cobrança de 30/09 às 23:56 entra em setembro; as de 31/08 22h e 01/10 00h não",
    [deSetembro.some(p => p.id === "b1"), deSetembro.some(p => p.id === "b2"), deSetembro.some(p => p.id === "b3")], [true, false, false]);

  const ana = await calcularFaturamentoOficial(bancoFalso(TF).cliente, { ...SETEMBRO, vendedorNome: "Ana" });
  const esperadoAna = deSetembro.filter(p => p.id_int != null && Number(p.id_int) % 2 === 0);
  checar("um vendedor: soma dele no mês inteiro",
    [ana.faturamento, ana.total_cobrancas, ana.conferencia], [Math.round(esperadoAna.reduce((t, p) => t + Number(p.valor), 0) * 100) / 100, esperadoAna.length, undefined]);

  // O aviso de incompleto conta as linhas LIDAS. Com teto de 1 página: 1.000
  // lidas, cortesias saem, sobram menos de 1.000 — e o aviso tem de sair.
  const cortado = await calcularFaturamentoOficial(bancoFalso(TF).cliente, { ...SETEMBRO, agruparPorVendedor: true, maxPaginas: 1 });
  checar("leitura que para no teto avisa, mesmo sobrando menos de 1.000 depois das cortesias",
    [cortado.linhas_lidas, cortado.truncado, typeof cortado.aviso_truncamento, cortado.total_propostas < 1000], [1000, true, "string", true]);
  checar("mesmo com a leitura cortada, o total (da visão) continua certo", [cortado.faturamento, cortado.total_cobrancas], [esperado.valor, esperado.cobrancas]);
}

// ─── 11. Citar o manual sem ter lido nenhuma página ──────────────────────────

{
  // Texto real que o Maestro devolveu em 02/10/2026 (maestro_mensagens 1711), com zero consultas.
  const RESPOSTA_DO_CADASTRO = [
    "Everton, quando um cliente preenche o cadastro pelo link, ele não aparece automaticamente na lista de Clientes. O cadastro fica primeiro na tela **Recebidos pelo link**, aguardando conferência e aprovação manual.",
    "",
    "Veja o fluxo oficial conforme o manual do Vibe:",
    "",
    "---",
    "",
    "### O que acontece após o cliente preencher o cadastro pelo link?",
    "",
    "1. O cadastro chega na tela **Recebidos pelo link** (Clientes → botão **Recebidos pelo link** no topo da tela Cadastros).",
    "2. Um responsável precisa conferir os dados recebidos.",
    "3. Para CPF: é obrigatório aprovar ou recusar manualmente.",
    "4. Para CNPJ: pode ser aprovado manualmente ou, em alguns casos, aprovado automaticamente se os dados baterem com a Receita Federal.",
    "5. Só depois de aprovado, o cadastro entra na lista principal de Clientes.",
    "",
    "**Se não aparecer em Clientes:**",
    "- Verifique a tela **Recebidos pelo link** — o cadastro provavelmente está lá aguardando aprovação.",
    "- Se já foi aprovado, pode haver um filtro ativo na tela de Clientes (exemplo: mostrando só clientes ativos ou de um tipo específico).",
    "",
    "---",
    "",
    "**Resumo:**  ",
    "O cadastro preenchido pelo link só aparece em Clientes depois de aprovado manualmente na tela **Recebidos pelo link**.",
    "",
    'Fonte: página "Cadastros: Recebidos pelo link" do manual do Vibe.',
  ].join("\n");
  const INDICE = indiceDoManual();

  checar("a resposta real cita uma página do índice", paginasDoIndiceCitadas(RESPOSTA_DO_CADASTRO, INDICE), ["cadastros-recebidos-pelo-link"]);
  const veredito = avaliarTravaDoManual({ texto: RESPOSTA_DO_CADASTRO, manualLido: false, fontes: [], indice: INDICE });
  checar("resposta real, sem nenhuma página lida → barrada", veredito, { tipo: "cita_manual_sem_ler", paginas: ["cadastros-recebidos-pelo-link"], negativa: false });
  checar("a correção manda ler a página certa", String(instrucaoDeCorrecao(veredito)).includes("cadastros-recebidos-pelo-link"), true);
  checar("antes (trava sem o índice e sem a regra nova) ela passava", avaliarTravaDoManual({ texto: RESPOSTA_DO_CADASTRO.replace(/manual do Vibe/g, "sistema").replace("Fonte: página", "Origem:"), manualLido: false, fontes: [] }), { tipo: "ok" });
  checar("a mesma resposta com a página lida não cai nesta regra",
    avaliarTravaDoManual({ texto: RESPOSTA_DO_CADASTRO, manualLido: true, fontes: [RESPOSTA_DO_CADASTRO, INDICE], indice: INDICE }).tipo, "ok");

  checar("só dizer que o manual não tem a página é citação negativa",
    avaliarTravaDoManual({ texto: "Everton, o manual do Vibe não traz um passo a passo para alterar o NCM de um produto.", manualLido: false, fontes: [], indice: INDICE }),
    { tipo: "cita_manual_sem_ler", paginas: [], negativa: true });
  checar("negativa seguida de regra afirmada não é só negativa",
    soNegaOManual("O manual não traz esse passo. Conforme o manual do Vibe, CPF exige aprovação."), false);
  checar("'aprovação manual' e 'baixa manual' não são citar o manual",
    avaliarTravaDoManual({ texto: "A baixa manual é feita pelo financeiro e a aprovação manual fica com o gestor.", manualLido: false, fontes: [], indice: INDICE }), { tipo: "ok" });
  checar("resposta de dados sem tela nem manual passa", avaliarTravaDoManual({ texto: "O pedido 22943 está em trânsito pelos Correios desde 01/10/2026.", manualLido: false, fontes: [], indice: INDICE }), { tipo: "ok" });
  checar("orçamento continua passando", avaliarTravaDoManual({ texto: ORCAMENTO, manualLido: false, fontes: [], indice: INDICE }), { tipo: "ok" });
}

// ─── 7. Trava do pedido: citado = consultado nesta pergunta ──────────────────
{
  // Texto REAL de maestro_mensagens 1725 (02/10/2026 14:29, auditoria 761,
  // zero consultas): os dados são do pedido 23020, o número é o 23071.
  const RESPOSTA_DO_23071 = [
    "Pedido 23071 — Situação atual",
    "",
    "**Cliente:** Glaucius Ferreira De Alves Junior  ",
    "**Empresa:** IDEAL GRÁFICA EXPRESSA EIRELI  ",
    "**Vendedor:** André Toniazzo  ",
    "**Valor total:** R$ 146,18  ",
    "**Status:** APROVADO (proposta avulsa)  ",
    "**Frete:** Incluso (CIF)  ",
    "**Criado em:** 01/10/2026 16:16",
    "",
    "**Cobranças:**",
    "- 1 cobrança paga: R$ 146,18 (PIX), paga e confirmada em 01/10/2026",
    "",
    "**Produção:**  ",
    "O pedido ainda não foi liberado para produção (não está na fila de produção e não há data de liberação registrada).",
    "",
    "**Resumo:**  ",
    "O pedido 23071 está totalmente pago, mas ainda não foi liberado para produção.  ",
    "Se for necessário liberar, siga o fluxo oficial na tela de Pedidos para avançar para a produção.",
    "",
    "Fonte: Pedido 23071 e cobranças (ERP).",
  ].join("\n");

  const nada = new Set<string>();
  checar("a resposta real cita o pedido 23071", extrairPedidosCitados(RESPOSTA_DO_23071), ["23071"]);
  checar("resposta real, zero consultas → pedido barrado", pedidosCitadosSemConsulta(RESPOSTA_DO_23071, nada), ["23071"]);
  checar("resposta real, zero consultas → Fonte barrada", citaFonteSemConsulta(RESPOSTA_DO_23071, 0), true);

  // O furo antigo: o número digitado na pergunta contava como confirmado.
  // Na trava nova, a pergunta NÃO entra no conjunto dos consultados.
  const soOutroPedido = new Set<string>();
  coletarNumerosDosArgumentos(JSON.stringify({ numero: 23020, partes: ["situacao", "cobrancas"] }), soOutroPedido);
  checar("consultou o 23020 e respondeu o 23071 → barrado", pedidosCitadosSemConsulta(RESPOSTA_DO_23071, soOutroPedido), ["23071"]);

  const consultouOCerto = new Set<string>();
  coletarNumerosDosArgumentos(JSON.stringify({ numero: 23071, partes: ["situacao", "cobrancas"] }), consultouOCerto);
  checar("consultou o 23071 nesta pergunta → passa", pedidosCitadosSemConsulta(RESPOSTA_DO_23071, consultouOCerto), []);
  checar("com consulta feita, a Fonte passa", citaFonteSemConsulta(RESPOSTA_DO_23071, 1), false);

  const correcao = correcaoDePedidoSemConsulta(["23071"], true);
  checar("a correção manda consultar o número certo", [correcao.includes("numero=23071"), correcao.includes("Fonte")], [true, true]);
  checar("texto fixo da defesa final não traz dado nenhum", respostaDePedidoSemConsulta(["23071"]).includes("146,18"), false);
  checar("tirar a linha de Fonte preserva o resto",
    [removerLinhasDeFonte("O total é R$ 10,00.\n\nFonte: ERP — Pedido 1.").includes("Fonte"), removerLinhasDeFonte("O total é R$ 10,00.\n\n**Fonte:** ERP")], [false, "O total é R$ 10,00."]);

  checar("formas de citar pedido",
    extrairPedidosCitados("A proposta nº 22812, o Pedido #23020, a prop. 21833 e o orçamento 19795."), ["22812", "23020", "19795", "21833"]);
  checar("quantidade, valor, cliente e data não são pedido",
    extrairPedidosCitados("Pedido de 1000 unidades por R$ 23.071,00 para o cliente 63708, pedido 5000 pulseiras em 02/10/2026."), []);
  checar("resposta sem número de pedido e sem Fonte passa",
    [pedidosCitadosSemConsulta("Bom dia, Everton! Em que posso ajudar?", nada), citaFonteSemConsulta("Bom dia, Everton!", 0)], [[], false]);
  checar("a palavra fonte no meio da frase não é linha de Fonte", citaFonteSemConsulta("A fonte do cartão é Arial: confira na arte.", 0), false);

  // ── Número solto: sem as palavras pedido, proposta ou orçamento ────────────
  // Os dados do 23020 com o 23071 escrito sozinho (pergunta: "qual a situação do 23071?").
  const ERRADA_COM_NUMERO_SOLTO = [
    "23071 — Situação atual",
    "",
    "**Cliente:** Glaucius Ferreira De Alves Junior  ",
    "**Vendedor:** André Toniazzo  ",
    "**Valor total:** R$ 146,18  ",
    "**Status:** APROVADO (avulsa)  ",
    "",
    "**Cobranças:**",
    "- 1 cobrança paga: R$ 146,18 (PIX), paga e confirmada em 01/10/2026",
    "",
    "O 23071 está totalmente pago, mas ainda não foi liberado para produção.",
  ].join("\n");
  checar("número solto: a regra com rótulo não vê nada", extrairPedidosCitados(ERRADA_COM_NUMERO_SOLTO), []);
  checar("número solto ao lado de dados de pedido → visto", extrairNumerosSoltosDePedido(ERRADA_COM_NUMERO_SOLTO), ["23071"]);
  checar("número solto, zero consultas → barrado", pedidosCitadosSemConsulta(ERRADA_COM_NUMERO_SOLTO, nada), ["23071"]);
  checar("número solto, consultou o 23020 → barrado", pedidosCitadosSemConsulta(ERRADA_COM_NUMERO_SOLTO, soOutroPedido), ["23071"]);
  checar("número solto, consultou o 23071 → passa", pedidosCitadosSemConsulta(ERRADA_COM_NUMERO_SOLTO, consultouOCerto), []);

  const solto = (t: string) => extrairNumerosSoltosDePedido(t);
  checar("solto no meio da frase", solto("O 23071 está APROVADO, no valor de R$ 146,18, do cliente Glaucius."), ["23071"]);
  checar("solto depois de 'do', em maiúsculas", solto("SITUAÇÃO DO 23071: APROVADO, cobrança paga."), ["23071"]);
  checar("solto como título em negrito", solto("**23071**\nCliente: Glaucius\nValor: R$ 146,18"), ["23071"]);
  checar("rótulo com pontuação no meio", solto("**Pedido:** 23071\n**Status:** APROVADO"), ["23071"]);
  checar("dois soltos na mesma frase: basta um para barrar", solto("O 23020 e o 23071 estão pagos, R$ 146,18 e R$ 491,69."), ["23020", "23071"]);
  checar("sem dado de pedido ao lado não dispara", solto("Você quis dizer o 23071? Me confirme o número, por favor."), []);

  // Resposta REAL do loop a "quanto custam 5000 tribands para o cep 96810400?" (02/10/2026).
  const COTACAO_REAL = [
    "Segue o orçamento:",
    "",
    "📄 Orçamento conforme solicitação",
    "",
    "🎟️ Pulseira Triband (25×2cm)",
    "📦 Quantidade: 5.000 unidades — R$ 840,00",
    "🏭 Prazo de produção: 1 dia útil",
    "",
    "-----------------------------",
    "📌 Centro  |  Santa Cruz do Sul  /  RS",
    "-----------------------------",
    "",
    "🚚 Sedex: R$ 31,72",
    "Prazo de entrega: 1 dia útil (+ prazo de produção)",
    "",
    "🚚 Transportadora São Miguel: R$ 72,25",
    "Prazo de entrega sob consulta.",
    "",
    "🛵 Retira no balcão: R$ 0,00",
    "",
    "🧾 Subtotal produtos: R$ 840,00",
    "Frete padrão (Sedex): R$ 31,72",
    "",
    "💰 Total final: R$ 871,72",
    "",
    "Se quiser salvar essa cotação como proposta, preciso identificar o cliente primeiro. O frete final considera o endereço do cadastro.",
  ].join("\n");
  checar("cotação real, mesmo sem nenhuma consulta: nada dispara", pedidosCitadosSemConsulta(COTACAO_REAL, nada), []);

  // Pior caso: todos os números sem formatação e nenhuma consulta feita.
  const NAO_SAO_PEDIDO = [
    "5000 tribands para o CEP 96810400 saem por R$ 840,00.",
    "Quantidade: 5000 — R$ 840,00",
    "Entrega no CEP 96810-400, Santa Cruz do Sul.",
    "Total: R$ 5000 ou 5000,00 à vista; frete de 1200.50.",
    "Fale com o financeiro: (51) 99999-1234, 51 3333 4444 ou 0800 6421234.",
    "A cobrança foi paga em 02/10/2026 e vale para 2026.",
    "De 1000 a 5000 unidades o preço cai; acima de 5000, consulte.",
    "- 1000: R$ 250,00",
    "- 5000: R$ 840,00",
    "O cliente 63708 tem 12 boletos; código 12460.",
    "As 5000 pulseiras e os 1000 crachás ficam prontos em 3 dias.",
    "São 1324 cobranças no mês, com 1320 propostas.",
  ].join("\n");
  checar("quantidade, CEP, valor, telefone, data e código de cliente não são pedido", solto(NAO_SAO_PEDIDO), []);
  checar("as mesmas linhas não disparam a trava", pedidosCitadosSemConsulta(NAO_SAO_PEDIDO, nada), []);

  const CLIENTE_SEM_ROTULO = "O 63708 está com um boleto em aberto de R$ 1.710,69.";
  checar("código de cliente sem rótulo: barrado se o servidor não o conhece", pedidosCitadosSemConsulta(CLIENTE_SEM_ROTULO, nada), ["63708"]);
  checar("código de cliente sem rótulo: passa se é o cliente ativo da sessão", pedidosCitadosSemConsulta(CLIENTE_SEM_ROTULO, nada, new Set(["63708"])), []);
  checar("o cliente ativo não libera número COM rótulo de pedido", pedidosCitadosSemConsulta("O pedido 63708 está pago.", nada, new Set(["63708"])), ["63708"]);
}

// ─── 8. Pago x confirmado pelo financeiro ────────────────────────────────────
{
  const pedido = (id: number, status: string, valor: number) =>
    ({ id_int: id, cliente: "C", id_cliente: 1, vendedor: "V", status_interno: status, valor_total: valor, is_reproved: false });
  const cob = (id: number, letra: string, status: string, confirmado: boolean, valor: number) =>
    ({ id_int: id, id_pagamento: `${id}-${letra}`, tipo_cobranca: "PIX", valor, status, confirmado, created_at: "2026-10-02T17:23:00Z" });
  const T: Record<string, Linha[]> = {
    propostas: [pedido(23071, "AGUARDANDO", 491.69), pedido(23020, "APROVADO", 146.18), pedido(24000, "AGUARDANDO", 300), pedido(24001, "NOVO", 50), pedido(24002, "AGUARDANDO", 1000)],
    pagamentos_v2: [
      // O 23071 como estava às 14:30 de 02/10: PIX pago, financeiro ainda não conferiu.
      cob(23071, "A", "PAID", false, 491.69),
      // O 23020: um PIX cancelado e outro pago e confirmado.
      cob(23020, "A", "CANCELADO", false, 171.5),
      cob(23020, "B", "PAID", true, 146.18),
      cob(24000, "A", "A_RECEBER", false, 300),
      cob(24002, "A", "PAID", true, 400),
      cob(24002, "B", "PAID", false, 600),
    ],
  };
  const cobertura = async (numero: number) => {
    const { cliente } = bancoFalso(T);
    const r = await consultarPedido(cliente, financeiro, numero, ["cobrancas"]);
    const c = ((r.secoes ?? {}) as Record<string, Record<string, unknown>>).cobrancas;
    return { c, cobertura: c.cobertura as Linha, primeira: ((c.cobrancas as Linha[]) ?? [])[0] };
  };

  const a = await cobertura(23071);
  checar("23071 às 14:30: pago, aguardando a conferência",
    [a.cobertura.situacao, a.cobertura.confirmado_pelo_financeiro, a.cobertura.pago_aguardando_conferencia, a.cobertura.falta_confirmar, a.cobertura.status_do_pedido],
    ["PAGO_AGUARDANDO_CONFERENCIA", 0, 491.69, 491.69, "AGUARDANDO"]);
  checar("a leitura proíbe 'totalmente pago' e explica o status", [String(a.cobertura.leitura).includes("NÃO confirmou"), String(a.cobertura.leitura).includes('NÃO diga "totalmente pago"')], [true, true]);
  checar("a cobrança diz que falta a conferência", a.primeira.situacao, "Paga pelo cliente, ainda NÃO confirmada pelo financeiro");

  const b = await cobertura(23020);
  checar("23020: coberto e confirmado, a cancelada não conta",
    [b.cobertura.situacao, b.cobertura.confirmado_pelo_financeiro, b.cobertura.falta_confirmar, (b.c.resumo as Linha).canceladas], ["COBERTO_E_CONFIRMADO", 146.18, 0, 1]);

  const c = await cobertura(24000);
  checar("cobrança sem pagamento → falta pagamento", [c.cobertura.situacao, c.primeira.situacao], ["FALTA_PAGAMENTO", "Aguardando pagamento"]);
  const d = await cobertura(24001);
  checar("pedido sem cobrança", d.cobertura.situacao, "SEM_COBRANCA");
  const e = await cobertura(24002);
  checar("parte confirmada e parte aguardando conferência",
    [e.cobertura.situacao, e.cobertura.confirmado_pelo_financeiro, e.cobertura.pago_aguardando_conferencia, e.cobertura.falta_confirmar],
    ["PAGO_AGUARDANDO_CONFERENCIA", 400, 600, 600]);
}

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
