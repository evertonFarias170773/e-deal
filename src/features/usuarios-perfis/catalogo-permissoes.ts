/**
 * Catalogo de permissoes do Vibe (chave, rotulo, descricao, criticidade).
 *
 * Morava dentro de components/PerfisPermissoesPanel.tsx. Saiu de la, sem mudar
 * nenhuma linha do conteudo, para o servidor tambem poder ler os ROTULOS: o
 * Maestro diz ao usuario qual permissao uma acao exige pelo nome que aparece em
 * Configuracoes > Perfis e Permissoes. Arquivo sem React, pode ser importado
 * de rota e de componente.
 */

export interface PermissionDefinition {
  key: string;
  label: string;
  desc: string;
  critica: boolean;
}

// ---------------------------------------------------------------------------
// CATÁLOGO DE PERMISSÕES V2.1 — Vibe
// Fase 1: expansão puramente visual do Editor de Perfis.
// Nenhuma permissão nova está conectada a telas operacionais nesta fase.
// A implementação operacional das novas permissões ocorre nas Fases 2 a 5.
// ---------------------------------------------------------------------------
export const CATALOGO_PERMISSOES: Record<string, PermissionDefinition[]> = {

  // ── Administração ─────────────────────────────────────────────────────────
  "Administração — Usuários e Perfis": [
    { key: "admin.usuarios.view",  label: "Visualizar Usuários",          desc: "Permite ver a listagem de usuários e seus perfis vinculados.",                          critica: false },
    { key: "admin.usuarios.edit",  label: "Gerenciar Usuários e Perfis",  desc: "Permite vincular perfis a usuários e editar permissões dos perfis.",                   critica: true  },
    { key: "admin.perfis.view",    label: "Visualizar Perfis",            desc: "Permite ver o catálogo de perfis e suas permissões (somente leitura).",                critica: false },
    { key: "admin.perfis.edit",    label: "Editar Permissões de Perfis",  desc: "Permite criar, editar e salvar permissões nos perfis do catálogo.",                    critica: true  }
  ],

  // ── Dashboard ─────────────────────────────────────────────────────────────
  "Dashboard": [
    { key: "dashboard.view",           label: "Visualizar Dashboard",              desc: "Permite acessar o painel de indicadores gerais do sistema.",                            critica: false },
    { key: "dashboard.view_financeiro", label: "Ver Indicadores Financeiros",      desc: "Permite visualizar cards e gráficos de faturamento e recebimentos no dashboard.",      critica: false },
    { key: "dashboard.view_producao",   label: "Ver Indicadores de Produção",      desc: "Permite visualizar cards e gráficos de pedidos e produção no dashboard.",             critica: false }
  ],

  "Cadastros (Clientes)": [
    { key: "cadastros.view",       label: "Visualizar Cadastros",         desc: "Permite visualizar listagem de clientes, fornecedores e vendedores.",                   critica: false },
    { key: "cadastros.create",     label: "Criar Cadastros",              desc: "Permite criar novos registros de clientes.",                                            critica: false },
    { key: "cadastros.edit",       label: "Editar Cadastros",             desc: "Permite editar informações de clientes, endereços e contatos.",                         critica: false },
    { key: "cadastros.edit_fiscal", label: "Editar Dados Fiscais",        desc: "Permite editar dados fiscais do cliente (CNPJ, IE, regime tributário).",                critica: true  },
    { key: "cadastros.view_socios", label: "Ver Sócios e Vínculos",       desc: "Permite visualizar sócios e vínculos comerciais cadastrados.",                          critica: false },
    { key: "cadastros.view_credito", label: "Visualizar Crédito / Financeiro", desc: "Permite visualizar o bloco Crédito / Financeiro do cadastro de clientes.",       critica: false },
    { key: "cadastros.edit_credito", label: "Editar Crédito / Financeiro", desc: "Permite editar campos do bloco Crédito / Financeiro do cadastro de clientes.",         critica: true  }
  ],

  // ── Produtos ──────────────────────────────────────────────────────────────
  "Produtos": [
    { key: "produtos.view",         label: "Visualizar Produtos",         desc: "Permite listar e visualizar o catálogo de produtos.",                                   critica: false },
    { key: "produtos.create",       label: "Criar Produtos",              desc: "Permite cadastrar novos produtos no catálogo.",                                         critica: false },
    { key: "produtos.edit",         label: "Editar Produtos",             desc: "Permite editar dados básicos de produtos existentes.",                                   critica: false },
    { key: "produtos.edit_preco",   label: "Editar Preço e Custo",        desc: "Permite alterar preço de venda e custo dos produtos (ação crítica de negócio).",        critica: true  },
    { key: "produtos.edit_fiscal",  label: "Editar Dados Fiscais",        desc: "Permite alterar NCM, CEST, CFOP e tributação dos produtos.",                            critica: true  },
    { key: "produtos.edit_producao", label: "Editar Dados de Produção",  desc: "Permite alterar formato, cor base, blocagem e dados de fabricação do produto.",         critica: false },
    { key: "produtos.inativar",     label: "Inativar Produtos",           desc: "Permite marcar produtos como inativos (exclusão lógica).",                              critica: true  },
    { key: "produtos.upload_foto",  label: "Upload de Fotos",             desc: "Permite fazer upload de imagens de produtos para o Storage.",                           critica: false }
  ],

  // ── Banco de Variações ────────────────────────────────────────────────────
  "Banco de Variações": [
    { key: "variacoes.view",     label: "Visualizar Variações",           desc: "Permite listar e visualizar o banco global de variações.",                              critica: false },
    { key: "variacoes.create",   label: "Criar Variações",                desc: "Permite criar novos grupos e opções de variação global.",                               critica: false },
    { key: "variacoes.edit",     label: "Editar Variações",               desc: "Permite editar grupos e opções de variação existentes.",                                critica: false },
    { key: "variacoes.inativar", label: "Inativar Variações",             desc: "Permite inativar grupos de variação global (exclusão lógica).",                         critica: true  }
  ],

  // ── Orçamentos / Propostas ────────────────────────────────────────────────
  "Orçamentos e Propostas": [
    { key: "propostas.view",             label: "Visualizar Propostas",            desc: "Permite visualizar a listagem e o detalhamento de propostas e orçamentos.",           critica: false },
    { key: "propostas.view_own",         label: "Ver Apenas Próprias Propostas",   desc: "Escopo de dados: limita a visualização às propostas do próprio atendente/vendedor.", critica: false },
    { key: "propostas.view_all",         label: "Ver Todas as Propostas",          desc: "Escopo de dados: permite visualizar propostas de todos os atendentes.",              critica: false },
    { key: "propostas.create",           label: "Criar Propostas",                 desc: "Permite iniciar novos orçamentos ou rascunhos de propostas.",                        critica: false },
    { key: "propostas.edit",             label: "Editar Propostas",                desc: "Permite editar itens, quantidades e descontos individuais nos itens.",               critica: false },
    { key: "propostas.desconto_geral",   label: "Aplicar Desconto Geral",          desc: "Permite aplicar descontos globais (em valor ou percentual) no fechamento.",          critica: true  },
    { key: "propostas.edit_vendedor",    label: "Alterar Vendedor Responsável",    desc: "Permite alterar o vendedor/atendente responsável pela proposta.",                    critica: true  },
    { key: "propostas.cancel",           label: "Cancelar Propostas",              desc: "Permite cancelar propostas comerciais ativas no sistema.",                           critica: true  },
    { key: "propostas.release_producao", label: "Liberar para Produção",           desc: "Permite aprovar a proposta para produção (campo is_prd_aprovado).",                  critica: true  },
    { key: "propostas.release_nf",       label: "Liberar para Nota Fiscal",        desc: "Permite marcar a proposta para faturamento (campo libera_nf).",                      critica: true  },
    { key: "propostas.devolver_revisao", label: "Devolver para Revisão",           desc: "Permite devolver a proposta para a etapa de revisão de atendente.",                  critica: true  },
    { key: "propostas.editar_paga",      label: "Editar Proposta Paga",            desc: "Permite alterar itens e valores de propostas comerciais com pagamentos confirmados.",critica: true  },
    // Usada desde 13/08/2026 (rota editar-paga e tela do orcamento); entrou no catalogo em 01/10/2026.
    { key: "propostas.editar_faturado",  label: "Editar Proposta com Faturado a Vencer", desc: "Permite alterar proposta cuja cobranca e faturada a vencer e ainda nao recebida; ajusta o valor da cobranca. Nao abre proposta paga de verdade.", critica: true  },
    { key: "propostas.cancelar_cobranca_nao_paga", label: "Cancelar Cobrança Não Paga", desc: "Permite cancelar cobrança emitida e comprovadamente NÃO paga da própria proposta, para corrigir o orçamento e gerar outra. Não alcança cobrança paga, confirmada, conciliada ou vinculada à Conta Corrente.", critica: true },
    { key: "propostas.complementar",     label: "Criar Pedido Complementar",       desc: "Permite criar, a partir de proposta paga e nao expedida, um pedido complementar do mesmo evento, com frete cobrado pela diferenca do peso somado.", critica: true },
    { key: "propostas.encerrar_teste",   label: "Encerrar pedido de teste",        desc: "Permite encerrar e reabrir pedido de TESTE (tira e devolve o pedido das listas operacionais). Nenhum perfil a recebe: so o Super Administrador, pelo curinga.", critica: true },
    // Permissões V1 mantidas para compatibilidade retroativa durante migração
    { key: "propostas.alterar_vendedor", label: "Alterar Vendedor",    desc: "Sera substituida por propostas.edit_vendedor na Fase 4.",     critica: true  },
    { key: "propostas.cancelar",         label: "Cancelar Propostas",  desc: "Sera substituida por propostas.cancel na Fase 4.",            critica: true  }
  ],

  // ── Chat Interno ──────────────────────────────────────────────────────────
  "Chat Interno": [
    { key: "chat.view",      label: "Visualizar Chat",              desc: "Permite acessar e read conversas do chat interno das propostas.",                       critica: false },
    { key: "chat.send",      label: "Enviar Mensagens",             desc: "Permite enviar mensagens no chat interno.",                                            critica: false },
    { key: "chat.mention",   label: "Mencionar Usuários",           desc: "Permite mencionar outros usuários em mensagens do chat.",                              critica: false },
    { key: "chat.view_all",  label: "Ver Chat de Todas as Propostas", desc: "Permite visualizar conversas de propostas de outros atendentes (escopo amplo).",  critica: false }
  ],

  // ── Cobranças ─────────────────────────────────────────────────────────────
  "Cobranças e Pagamentos": [
    { key: "cobrancas.view",       label: "Visualizar Cobranças",         desc: "Permite visualizar a lista e status das cobranças de propostas.",                   critica: false },
    { key: "cobrancas.create",     label: "Criar Cobranças",              desc: "Permite gerar novas cobranças (boleto, PIX, cartão) para propostas.",              critica: true  },
    { key: "cobrancas.emit",       label: "Emitir Cobranças",             desc: "Permite acionar o gateway de pagamento para emitir a cobrança.",                   critica: true  },
    { key: "cobrancas.confirm",    label: "Confirmar Recebimento",        desc: "Permite confirmar manualmente o recebimento de uma cobrança.",                     critica: true  },
    { key: "cobrancas.cancel",     label: "Cancelar / Estornar Cobranças", desc: "Permite cancelar ou estornar cobranças emitidas.",                               critica: true  },
    { key: "cobrancas.view_token", label: "Ver Link e Token da Cobrança", desc: "Permite visualizar o link público e o token de acesso da cobrança.",              critica: false },
    { key: "financeiro.resolver_credito", label: "Resolver Crédito / Diferença", desc: "Permite decidir o destino financeiro (manter crédito, abater débito etc.) para diferenças comerciais.", critica: true },
    { key: "financeiro.bonificar", label: "Bonificar Comercial",          desc: "Permite conceder bonificação comercial para diferenças financeiras a maior.",       critica: true },
    { key: "financeiro.devolver", label: "Solicitar Devolução",           desc: "Permite registrar solicitações de devolução física de valores pagos ao cliente.",     critica: true },
    { key: "financeiro.debito_futuro", label: "Registrar Débito Futuro",   desc: "Permite registrar débitos futuros para diferenças financeiras a menor.",             critica: true },
    { key: "credito.usar", label: "Usar Crédito Acumulado",               desc: "Permite aplicar o saldo de crédito do cliente como pagamento de propostas.",        critica: true },
    // Permissões V1 mantidas para compatibilidade retroativa durante migração
    { key: "cobrancas.aprovar",        label: "Liberar OS / Confirmar", desc: "Sera substituido por cobrancas.confirm na Fase 4.",         critica: true  },
    { key: "cobrancas.emitir_boleto",  label: "Emitir Boleto",          desc: "Sera substituido por cobrancas.emit na Fase 4.",             critica: false }
  ],

  // ── Conferência ───────────────────────────────────────────────────────────
  "Conferência de Pagamentos": [
    { key: "conferencia.view",    label: "Visualizar Conferência",       desc: "Permite ver a lista de pagamentos confirmados para conferência.",                    critica: false },
    { key: "conferencia.confirm", label: "Confirmar Pagamento",          desc: "Permite confirmar registros na tela de conferência.",                               critica: true  },
    { key: "conferencia.export",  label: "Exportar Relatório",           desc: "Permite exportar o relatório de conferência de pagamentos.",                        critica: false }
  ],

  // ── Contas a Receber ──────────────────────────────────────────────────────
  "Contas a Receber": [
    { key: "contas_receber.view",       label: "Visualizar Títulos",          desc: "Permite listar e visualizar os títulos a receber.",                                critica: false },
    { key: "contas_receber.baixa",      label: "Registrar Baixa",             desc: "Permite registrar a baixa de um título a receber.",                               critica: true  },
    { key: "contas_receber.send_email", label: "Disparar E-mail de Cobrança", desc: "Permite enviar e-mail de cobrança para clientes em atraso.",                     critica: false },
    // Verificada na tela de Contas a Receber; ate 01/10/2026 nenhum perfil a tinha e so admin passava.
    { key: "contas_receber.admin",      label: "Administrar Contas a Receber", desc: "Libera as acoes administrativas da tela: cancelar recebivel, registrar boleto, excluir boleto do banco e editar ou transformar deposito.", critica: true  },
    // Permissões V1 mantidas para compatibilidade retroativa durante migração
    { key: "financeiro.view",    label: "Relatorios Financeiros", desc: "Sera substituido por dashboard.view_financeiro + contas_receber.view.", critica: false },
    { key: "financeiro.aprovar", label: "Aprovacao Financeira",   desc: "Sera substituido por contas_receber.baixa na Fase 4.",                  critica: true  }
  ],

  // ── Fiscal ────────────────────────────────────────────────────────────────
  "Fiscal (NF-e / NFS-e)": [
    { key: "fiscal.view",       label: "Visualizar Painel Fiscal",     desc: "Permite ver a fila de faturamento e o histórico de notas fiscais.",                   critica: false },
    { key: "fiscal.simulate",   label: "Simular Emissão de NF",        desc: "Permite pré-visualizar e simular a emissão de notas fiscais antes de confirmar.",     critica: false },
    { key: "fiscal.emit_nfe",   label: "Emitir NF-e (Produto)",        desc: "Permite emitir oficialmente Notas Fiscais de Produto (NF-e).",                        critica: true  },
    { key: "fiscal.emit_nfse",  label: "Emitir NFS-e (Serviço)",       desc: "Permite emitir oficialmente Notas Fiscais de Serviço (NFS-e).",                       critica: true  },
    { key: "fiscal.cancel_nf",  label: "Cancelar Nota Fiscal",         desc: "Permite solicitar cancelamento de NF junto à Sefaz ou Prefeitura.",                   critica: true  },
    { key: "fiscal.admin",      label: "Configurar Parâmetros Fiscais", desc: "Permite configurar série, ambiente (produção/homologação) e CFOP padrão.",            critica: true  },
    // Permissão V1 mantida para compatibilidade retroativa durante migração
    { key: "fiscal.emitir", label: "Emitir NF", desc: "Sera substituido por fiscal.emit_nfe e fiscal.emit_nfse na Fase 4.",               critica: true  }
  ],

  // ── Pedidos / OS ──────────────────────────────────────────────────────────
  "Pedidos e Ordens de Serviço": [
    { key: "pedidos.view",          label: "Visualizar Pedidos e OS",     desc: "Permite listar pedidos e visualizar boletins de OS.",                                critica: false },
    { key: "pedidos.edit_data",     label: "Editar Datas de Entrega",     desc: "Permite alterar a data de entrega e data da OS.",                                    critica: false },
    { key: "pedidos.edit_obs",      label: "Editar Observações da OS",    desc: "Permite editar campos de observação internos da Ordem de Serviço.",                  critica: false },
    { key: "pedidos.approve_arte",  label: "Aprovar Arte junto ao Cliente", desc: "Permite registrar a aprovação de arte pelo cliente.",                            critica: true  },
    { key: "pedidos.release_nf",    label: "Liberar para Nota Fiscal",    desc: "Permite marcar o pedido como liberado para faturamento.",                           critica: true  },
    { key: "pedidos.admin",         label: "Ações Administrativas de OS", desc: "Permite reatribuir, encerrar ou reverter etapas de OS (ação crítica).",             critica: true  },
    { key: "pedidos.print_os",      label: "Imprimir OS (PDF de produção)", desc: "Permite gerar o PDF do boletim de OS (versão de produção, sem valores).",         critica: false },
    { key: "pedidos.qr_rotacionar", label: "Revogar/Gerar novo QR da OS",   desc: "Permite invalidar o QR Code público de produção e emitir nova versão (ação crítica).", critica: true  }
  ],

  // ── Produção (Kanban) ─────────────────────────────────────────────────────
  "Produção (Kanban)": [
    { key: "producao.view",  label: "Visualizar Kanban",          desc: "Permite visualizar o quadro Kanban de produção com todos os pedidos.",                 critica: false },
    { key: "producao.mover", label: "Mover Pedidos no Kanban",    desc: "Permite arrastar pedidos entre as etapas de produção no Kanban.",                     critica: false },
    { key: "producao.admin", label: "Configurar Etapas",          desc: "Permite configurar as etapas do Kanban e suas regras de transição.",                  critica: true  }
  ],

  // ── Impressão ─────────────────────────────────────────────────────────────
  "Impressão": [
    { key: "impressao.view",     label: "Visualizar Fila de Impressão", desc: "Permite ver a fila de impressão e os itens pendentes.",                           critica: false },
    { key: "impressao.iniciar",  label: "Iniciar Impressão",            desc: "Permite marcar um item como em processo de impressão.",                            critica: false },
    { key: "impressao.concluir", label: "Concluir Impressão",           desc: "Permite marcar a impressão de um item como concluída.",                           critica: false }
  ],

  // ── Expedição ─────────────────────────────────────────────────────────────
  "Expedição": [
    { key: "expedicao.view",      label: "Visualizar Expedição",       desc: "Permite ver a fila de expedição e os pedidos prontos para envio.",                  critica: false },
    { key: "expedicao.processar", label: "Processar Envio / Retirada", desc: "Permite registrar envios e confirmar retiradas na expedição.",                      critica: false },
    { key: "expedicao.admin",     label: "Configurar Expedição",       desc: "Permite configurar metodos de envio, integracoes logisticas e liberar a recotacao de frete de um pedido no despacho.", critica: true  }
  ],

  // ── Relatórios ────────────────────────────────────────────────────────────
  "Relatórios": [
    { key: "relatorios.view",       label: "Visualizar Relatórios",         desc: "Permite acessar e visualizar relatórios gerais do sistema.",                       critica: false },
    { key: "relatorios.financeiro", label: "Relatórios Financeiros",        desc: "Permite visualizar relatórios de faturamento, recebimentos e contas.",             critica: false },
    { key: "relatorios.producao",   label: "Relatórios de Produção",        desc: "Permite visualizar relatórios de pedidos, produção e expedição.",                  critica: false },
    { key: "relatorios.export",     label: "Exportar Dados (CSV / PDF)",    desc: "Permite exportar dados de relatórios em formato CSV ou PDF.",                      critica: false }
  ],

  // ── Tarefas ───────────────────────────────────────────────────────────────
  // Define quem participa da central de Tarefas (01/10/2026). A regra de
  // verdade esta no banco (`tarefas_equipe__eh_da_equipe`); ver
  // src/features/tarefas/lib/participacao.ts.
  "Tarefas": [
    { key: "tarefas.participar", label: "Participar das Tarefas", desc: "Aparece em Para quem, recebe e cria tarefas e entra em Todos da equipe. Contas @teste.com.br ficam de fora mesmo com a permissão.", critica: false }
  ],

  // ── Configurações Gerais ──────────────────────────────────────────────────
  "Configurações do Sistema": [
    { key: "config.view",        label: "Acessar Configurações",      desc: "Permite acessar o hub de Configurações do sistema.",                                   critica: false },
    { key: "config.empresas",    label: "Gerenciar Empresas",         desc: "Permite cadastrar e editar empresas e filiais do grupo.",                              critica: true  },
    { key: "config.integracoes", label: "Configurar Integrações",     desc: "Permite configurar integrações externas (N8N, gateways de pagamento, etc.).",          critica: true  },
    { key: "config.faturamento", label: "Configurar Faturamento",     desc: "Permite configurar parâmetros de cobrança, vencimentos e meios de pagamento.",         critica: true  }
  ]
};

const ROTULO_POR_CHAVE: ReadonlyMap<string, string> = new Map(
  Object.values(CATALOGO_PERMISSOES).flatMap((grupo) => grupo.map((p) => [p.key, p.label] as const))
);

/** Rotulo da permissao como aparece na tela de Perfis; a propria chave quando fora do catalogo. */
export function rotuloDaPermissao(chave: string): string {
  return ROTULO_POR_CHAVE.get(chave) ?? chave;
}
