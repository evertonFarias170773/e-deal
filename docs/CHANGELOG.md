# Changelog

## 2026-06-18

### Alterado
- **Verificação CPF/CNPJ**: Atualização do endpoint de consulta `/api/verificacao/route.ts` para conectar em tempo real com as APIs `publica.cnpj.ws` e `api.cpfhub.io` (removendo mocks). Reestruturação do painel visual (`VerificacaoPage.tsx`) listando exatamente a grade mapeada de CNPJ e exibição flexível para dados extras de CPF. Ausências padronizadas explicitamente como "Dados não disponíveis".

- **Página de Cadastros (Endereços e Vínculos)**:
  - **Endereços**: Adicionada validação rigorosa obrigatória para o campo `Número`. Transformado o campo `Recebedor` em apenas leitura, sendo preenchido automaticamente via integração com CPF usando o novo endpoint auxiliar `/api/cadastros/consultar-cpf-simples`.
  - **Dados da Nota Fiscal**: Seção renomeada de "Vínculos Comerciais". Busca de cadastro atrelado agora é estrita por documento, preenchendo automaticamente e bloqueando edição manual. Caso não encontre, oferece atalho rápido para criação de "+ Novo Cadastro" com documento já preenchido na URL.

## 2026-06-16

### Adicionado
- **Edição de Boletim/OS existente (`/pedidos/boletim?id_int={id_int}&modo=edicao`)**:
  - **Identificação do Modo**: Mapeamento do parâmetro `modo=edicao` e do identificador do pedido para habilitar a edição controlada.
  - **Banner de Alerta**: Exibição de cabeçalho informativo avisando que o Boletim está no modo de edição e que apenas orientações técnicas e de design estão editáveis.
  - **Lock System (19 bloqueios)**: Aplicação sistemática de bloqueio de escrita (readonly/disabled) e ocultamento de ações que alteram quantitativos, faturamento, financeiro, frete, volumes, ou que inserem/removem lotes na OS.
  - **Persistência de Observações**: Implementação no service das funções `parsePedidosObs`, `serializePedidosObs` e `atualizarOrientacoesBoletim` para ler e salvar as observações no campo `obs` de `public.pedidos` de forma isolada, em formato bracketed estruturado.
  - **Integração de Botões na Fila Geral**: Links/botões "Editar" colocados tanto na visualização padrão (card) quanto na visualização compacta de planilha.
  - **Aba "Anexos / Artes"**: Aba "Artes / Aprovação" renomeada na Ficha de OS (`PedidoDetailPage.tsx`) para "Anexos / Artes", com botão "Editar Boletim / OS" no cabeçalho.

## 2026-06-15

### Adicionado
- **Upload Inicial de Arte Versão 1 no Ficha de OS (`public.pedidos_artes`)**:
  - **Novo Service**: Criado o service `pedidos-artes.service.ts` contendo as funções `listarArtesDoModelo` e `anexarArteVersao1`.
  - **Fluxo de Upload e Registro de Arte**: Implementada validação de extensões permitidas (`jpeg`, `png`, `pdf`) e limite de tamanho de até 10MB. O upload ocorre no bucket público `chat-ideal` sob a pasta `pedidos-artes/{id_int}/{id_modelo}/...` e cria a respectiva linha de controle na tabela `public.pedidos_artes` com `versao = 1` e status `PENDENTE`.
  - **Segurança de Versão Única**: Bloqueio ativo caso o modelo já possua arte cadastrada.
  - **Identidade Segura**: Envio do UUID válido do usuário (`enviado_por_uid`) ou null se ausente/inválido.
  - **Aba Artes/Aprovação na Ficha**: Atualizada para renderizar os lotes e suas artes correspondentes vindos do Supabase. Botões e simuladores de mocks foram desativados para pedidos reais do banco.

- **Persistência Real de Modelos/Lotes no Boletim de Entrada (`public.pedidos_modelos`)**:
  - **Função no Service**: Adicionada a função `salvarModelosBoletim` no service `boletim-propostas.service.ts` para persistir dados estruturados em lote na tabela `public.pedidos_modelos`.
  - **Verificações de Segurança (Anti-duplicidade)**: Integrado no service (`obterPropostaLiberadaParaBoletim`, `criarPedidoParaBoletim` e `salvarModelosBoletim`) a consulta ativa em `public.pedidos_modelos` por `id_int` para abortar de forma segura em caso de existência prévia de lotes, exibindo a mensagem: `"Modelos/lotes já cadastrados para este pedido. Edição será liberada em etapa futura."`.
  - **Validação Rigorosa de Quantidades**: Implementada a validação de soma total de lotes por produto, abortando a inserção inteira antes de salvar qualquer modelo caso `modelsSum !== maxQty`.
  - **Transacionalidade Prática**: Execução do `INSERT` em lote em uma única chamada `insert(array)` para garantir atomicidade.

### Alterado
- **Desativação de Mocks e Alinhamento com Supabase (PCP/Produção)**:
  - **Fila de Impressão (`PainelImpressaoPage.tsx`)**: Conectada diretamente ao Supabase. Criada a função `listarModelosImpressao()` em `pedidos-producao.service.ts` para buscar dados reais na tabela `public.pedidos_modelos`. Como a tabela real está vazia, o painel exibe de forma consistente KPIs zerados e o estado vazio personalizado ("Nenhum item liberado para impressão"). Desativados e tornados no-op todos os botões de simulação operacional (iniciar, pausar, concluir, retomar) para pedidos reais do banco de dados.
  - **Painel de Expedição (`ExpedicaoPage.tsx`)**: Substituição de mock database (`usePedidosMockDb`) por leitura real no Supabase via `listarPedidosOperacionais()`. Pedidos com `status_expedicao === 'BLOQUEADO'` são filtrados e não aparecem na fila ativa. Quando não há itens ativos/concluídos para expedir, a tela exibe o estado vazio unificado ("Nenhum pedido em expedição"). Todos os inputs de peso e botões de despacho/balança foram desativados para dados do banco de dados, e o botão "Reset Mock" foi removido.
  - **Kanban de Produção (`PedidosKanbanPage.tsx`)**: Atualizado para carregar pedidos reais via `listarPedidosOperacionais()`. Adicionado o status `BOLETIM_FINALIZADO` ao mapeamento da coluna "Novo / Boletim" para possibilitar a exibição da OS real `#17799`. Todos os botões de mudança de status de coluna e ações rápidas (urgente, pausa) no card foram desativados/ocultados. Removido o botão "Resetar Base" do banner superior.
  - **Fila Geral (`PedidosListPage.tsx`)**: Removido o botão "Resetar Base" que executava limpeza de mock do `localStorage`.
  - **Validação Técnica**: Executado build de produção Next.js e verificação rigorosa de TypeScript. Toda a camada operando de forma segura no modo **somente leitura** sem qualquer escrita no banco de dados.

## 2026-06-14

### Adicionado
- **Conexão Real da Fila Geral de OS (Leitura no Supabase)**:
  - **Função no Service**: Adicionada a função `listarPedidosOperacionais()` em `pedidos-producao.service.ts` realizando `READ` na tabela `public.pedidos` ordenada por `data_pedido desc nulls last`.
  - **Enriquecimento Resiliente**: Busca opcional e tolerante a falhas/RLS na tabela `public.propostas` para obter `cliente`, `vendedor` e `empresa`. Caso a consulta a `propostas` falhe ou retorne vazio, o pedido continua sendo exibido com as informações disponíveis no próprio pedido.
  - **Modelos**: Exibição dos pedidos sem depender de `pedidos_modelos`. Se o pedido não possuir modelos cadastrados, apresenta a mensagem `"Ainda sem modelos"`.
  - **Remoção de Aviso Local**: Ocultado/removido o aviso de `localStorage` especificamente para a Fila Geral, mantendo as demais abas inalteradas.
  - **Badges de Status**: Mapeados os novos status `BOLETIM_FINALIZADO`, `BLOQUEADO`, `PENDENTE`, `APROVADO` em `humanizeStatus` e no `StatusBadge`.
- **Escrita Real Controlada na Abertura de OS (Salvar Boletim)**:
  - **Ação Salvar Boletim**: Integração com o banco de dados Supabase na ação de salvar da tela "Abertura de OS — Boletim de Entrada", realizando o `INSERT` real do registro pai na tabela `public.pedidos`.
  - **Função no Service**: Adicionada a função `criarPedidoParaBoletim` no service `boletim-propostas.service.ts` para persistir dados estruturados de cabeçalho, com `id_cliente = null` (preparado para UUID posterior) e campos operacionais (`status_pedido = 'BOLETIM_FINALIZADO'`, `status_pagamento = 'APROVADO'`, `status_arte = 'PENDENTE'`, `status_producao = 'BLOQUEADO'`, `status_expedicao = 'BLOQUEADO'`, `valor_total` recalculado e data do pedido automática).
  - **Prevenção de Duplicados e Validação Reativa**: Reavaliação rigorosa da elegibilidade e consulta de existência prévia do `id_int` na tabela `public.pedidos` antes do insert, bloqueando com toast explicativo `"Pedido já aberto para esta proposta"` em caso de duplicidade detectada.
  - **Tratamento de Erros e Confirmação**: Exibição de toasts informativos somente após o retorno do Supabase (tratando RLS com erro claro se necessário), impedindo sucessos falsos e redirecionando para `/pedidos` apenas após persistência real.
- **Abertura de OS (Boletim de Entrada — Fase 2)**:
  - **Gabarito / Setor PCP**: Implementada a integração dinâmica dos novos campos `id_gabarito` e `setor_pcp` (Setor PCP) em `public.produtos` e no formulário de Abertura de OS / Boletim.
  - **Loaders Dinâmicos do Banco**: Criadas as funções `listarDesigners` e `listarGabaritos` no `boletim-propostas.service.ts` para buscar dados operacionais do Supabase a partir das tabelas `public.usuarios` e `public.producao_numeracoes` respectivamente.
  - **Refatoração da Interface de Lotes**: Substituída a listagem tabular clássica de Lotes por um grid moderno de cards individuais, melhorando consideravelmente a legibilidade e usabilidade em telas maiores.
  - **Configurações Simplificadas do Setor PCP**: Substituição das configurações complexas por textareas padrão para Impressão e Acabamento, e vinculação do designer ativo no Bloco 5 com as opções dinâmicas.
  - **Padronização das Observações (obs)**: Concatenação estruturada de todas as observações no campo `obs` do pedido pai, utilizando os blocos `[Observações críticas]`, `[Impressão]` e `[Acabamento]`.
  - **Migration SQL**: Criação do script de migration `docs/migrations/20260614_add_gabarito_setor_pcp.sql` para execução manual pelo usuário no painel do Supabase.
- **Refinamento de Abertura de OS (Boletim de Entrada)**:
  - **Service Somente Leitura**: Criação de `src/features/pedidos/services/boletim-propostas.service.ts` com funções `listarPropostasLiberadasParaBoletim`, `buscarPropostasLiberadasParaBoletim` e `obterPropostaLiberadaParaBoletim` integradas ao Supabase.
  - **Regra Completa de Elegibilidade**: Validação estrita dos critérios: status 'APROVADO', `id_int` e `id_vendedor` não nulos, pelo menos 1 registro em `produtos_proposta` e nenhum registro em `pedidos`. Limitação final em 20 registros aplicada somente no JS após filtragem de elegibilidade.
  - **cnpjCpf Case-Sensitive**: Busca e tratamento case-sensitive da coluna `cnpjCpf` no banco de dados. Documentos nulos são tolerados e não bloqueiam propostas.
  - **Validação de Seleção Direta e Mensagens Amigáveis**: Integração de validação por ID em `BoletimFormPage.tsx` exibindo toasts de erro com motivos operacionais claros ("Proposta ainda não aprovada", "Proposta sem produtos", etc.) quando inelegível.
  - **Busca e Teclado**: Adicionados debounce de 400ms, mensagem de feedback no input se nada for encontrado, e atalho para a tecla `Enter` para validação e seleção direta por ID.
- **Módulo Produção / OS (Esvaziamento da Fila de Produção)**:
  - **Service Isolado**: Criação de `src/features/pedidos/services/pedidos-producao.service.ts` com a função `listarPedidosProducao` retornando array vazio (`[]`) e tipo `PedidoProducaoListItem`. Isso isola o módulo de pedidos de acoplamentos invertidos com a pasta de produção.
  - **Transição de PCP**: Alteração das telas `PedidosListPage.tsx` e `PedidosKanbanPage.tsx` para consumirem a listagem do novo service ao invés do mock de banco de dados do `localStorage` direto.
  - **Estado Vazio Conforme Fluxo**: Exibição do componente `<EmptyState />` abaixo dos filtros e badges de resumo (com totais zerados) com título `"Nenhum pedido em produção"` e descrição `"Os pedidos aparecerão aqui quando forem liberados pelo boletim finalizado."`.
  - **Documentação de Transição**: Registro de que as tabelas `public.pedidos` e `public.pedidos_modelos` estão vazias no Supabase e de que o fluxo do "boletim finalizado" ainda não foi conectado às tabelas.
- **Módulo Produtos / Orçamentos (Campos de Produção e Validação de Mínimo)**:
  - **Migration de Banco de Dados (Docs)**: Preparação do script SQL `docs/migrations/20260614_add_produtos_producao_fields.sql` para adicionar campos operacionais de produção (`id_formato`, `id_modelo_cor`, `quantidade_minima_venda`, `tipo_blocagem`) na tabela `public.produtos`, definindo chaves estrangeiras com os catálogos operacionais e check constraint `>= 1` para a quantidade mínima.
  - **Camada de Modelos e Serviços**: Atualização dos tipos `Produto` e `ProdutoFormState` em `src/features/produtos/types.ts` e `SupabaseProdutoRow` em `types.supabase.ts`; atualização do mapper de banco para converter os novos campos; inclusão das colunas de produção no `UPDATE` real (não no `INSERT`) no service de produtos; e implementação de listagem para formatos e cores (`listarFormatosProducao` e `listarCoresProducao`).
  - **Formulário de Edição de Produtos**: Adicionados selects integrados com os catálogos reais de formatos e cores no bloco "Dados principais" de `/produtos/[id]/editar`, com filtragem dinâmica de cores cruzando o UUID de formatos, input numérico com validação estrita (inteiro >= 1) de quantidade mínima, e input de texto livre para tipo de blocagem.
  - **Validação em Orçamentos**: Inicialização dinâmica da quantidade do produto adicionado em `OrcamentoFormPage.tsx` respeitando o mínimo `produto.quantidade_minima_venda` (com fallback para 1000); validação do item ao salvar individualmente e validação global antes de salvar o orçamento geral, barrando a operação com toast explicativo apontando o produto e o mínimo exigido.
  - **Matriz de Segurança**: Registro da liberação controlada de escrita do `UPDATE` em `docs/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`.
  - **Tratamento de Erro na Listagem**: Correção para que falhas de RLS, schema ou conexão não sejam confundidas com catálogo vazio. Implementação de exibição de banner de erro claro no topo da listagem de produtos e rodapé correspondente caso a leitura falhe.
- **Módulo Pedidos / Produção (Fase 1 - Artes - Concluída)**:
  - **Tabelas de Banco de Dados**: Criação e validação das tabelas `public.pedidos_modelos` e `public.pedidos_artes` com restrição de chave estrangeira `ON DELETE RESTRICT` e índices de performance operacionais, sem alteração de RLS, triggers ou RPCs.
  - **Bucket de Storage**: Utilização estrita do bucket público `chat-ideal` com caminhos estruturados em `propostas/{id_int}/artes/{id_modelo}/{timestamp}_{nomeArquivo}`, sem criação de novo bucket.
  - **Regra de Versionamento & Concorrência**: Lógica de versionamento incremental baseada em `maior versão atual + 1` com loop de auto-retry no service para gerenciar colisões de chave única `unique(id_modelo, versao)` por transações simultâneas.
  - **Timeline no Chat**: Ausência de tabela `pedidos_historico`. Utilização de `public.propostas_chat` como timeline under o tipo `PRODUCAO` no setor `Pre-impressao`, contendo anexos no formato JSONB contendo bucket, path, nome do arquivo, mime-type, tamanho, versão e id_modelo.
  - **Types TypeScript**: Estruturação de types em `src/features/producao/types.ts` mapeando os schemas das tabelas (`PedidoModelo`, `PedidoArte`, `StatusArteProducao`, `StatusProducaoModelo`).
  - **Camada de Serviços**: Criação de funções operacionais em `src/features/producao/services/producao-artes.service.ts` (`listarModelosPorPedido`, `listarArtesPorModelo`, `listarArtesPorPedido`, `criarModelo`, `uploadNovaVersaoArte`, `atualizarStatusArte`, `registrarEventoProducaoChat`).
  - **Interface do Usuário**: Criação do painel visual reativo `src/features/producao/components/ProducaoArtesPanel.tsx` para gerenciar o upload de novas versões de arte e controle/mudança de status em tempo real.
  - **Integração no Detalhe do Pedido & Rota**: Integração do painel na rota segura `/producao` (`src/app/(erp)/producao/page.tsx`) e na aba de Artes do `PedidoDetailPage.tsx` através de um alternador amigável (Modo Simulador Local vs Conexão Real Supabase).

## 2026-06-13

### Adicionado
- **Módulo Produção / Imposição**:
  - Aprovada arquitetura do módulo Produção;
  - Aprovada Fase 1 (catálogo);
  - Aprovadas tabelas:
    - `producao_formatos`
    - `producao_numeracoes`
    - `producao_saidas`
    - `producao_cores`
    - `producao_modelos_imposicao`
  - Fase operacional mantida para revisão posterior;
  - Definida estratégia de separação entre catálogo e execução operacional.

## 2026-06-11

### Adicionado
- **Módulo Menu / Verificação CPF/CNPJ**:
  - Nova página de verificação de documentos `/verificacao` com proxy seguro `/api/verificacao` no backend retornando simulações de consulta.
  - Link na Sidebar apontando para `/verificacao` com o ícone `ShieldCheck`.
- **Módulo Orçamentos / Frete RS**:
  - Opção de frete "Retirada Local (Sem custo)" automática para propostas com destino no estado do Rio Grande do Sul (UF = "RS").
- **Módulo Conferência / Cancelamento com Motivo**:
  - Novo modal `CancelCobrancaModal` para capturar o motivo de cancelamento obrigatório antes de prosseguir.
  - Gravação de mensagens de sistema em `propostas_chat` informando o cancelamento e seu motivo.

### Alterado
- **Módulo Orçamentos / Ajustes de Frete**:
  - Correção na inicialização do `lastQuotedKey` utilizando volumes calculados dinamicamente para evitar requisições de cotação automáticas indesejadas no mount.
  - Implementação de mesclagem de fretes para manter a seleção do usuário ativa (`currentChosen`), convertendo fretes antigos não retornados na API em fretes "preservados" com a tag `(Preservado)`.
  - Remoção de nomes de serviço duplicados no gerador de texto WhatsApp.
- **Módulo Conferência / Fila Geral e Status**:
  - Badge de status de faturamentos não-confirmados `"PAID"` ("Pago / A liberar") ajustado para azul claro (`"info"`).
  - Exclusão de faturamentos pendentes de aprovação da Fila Geral de Conferência, mantendo-os exclusivos sob o filtro de faturados/pendentes.
  - Implementação de novo filtro `"CANCELADO"` para exibir cobranças com status cancelado.
  - Remoção completa de ações físicas de exclusão ("Excluir cobrança") dos painéis e menus de ação.
  - Habilitação de cancelamento seguro para cobranças reais do Supabase (atualização para status `CANCELADO` no banco).
- **Módulo Conferência / Análise de Crédito**:
  - Inclusão de editor numérico de limite de crédito (`limite_credito` em `clientes`) no modal de análise de crédito.
  - Reavaliação automática via RPC `fn_analise_credito_cliente` após atualizar o limite e liberação automática do faturamento se o limite for suficiente.
- **Módulo Cadastro Cliente / Exibição de Faturado**:
  - Campo "Padrão de pagamento faturado" configurado como somente leitura em `CadastroFormPage.tsx` e acompanhado de alerta visual proeminente de Conflito Técnico nas telas de formulário e detalhe.

- **Fase 3 — Bloqueios Visuais por Permissão (UX/Frontend)**:
  - Ocultação do menu "Configurações" na Sidebar desktop e mobile para usuários que não possuam as permissões `admin.usuarios.view` ou `admin.usuarios.edit`.
  - Bloqueio de acesso por URL direto para as páginas `/configuracoes` e `/configuracoes/usuarios`, exibindo a tela de Acesso Restrito para usuários não autorizados.
  - Diferenciação visual entre visualização (`admin.usuarios.view`, que oculta ações de edição) e alteração (`admin.usuarios.edit`).
  - Ocultação dinâmica da coluna "Ações" e botões de "Alterar Perfil" na listagem de usuários mantendo o alinhamento perfeito de layout em desktop e mobile.
  - Mapeamento e documentação detalhada de pontos operacionais nos módulos de Propostas e Financeiro para proteção em fases futuras.

- **Fase 4.1 — Permissões de Negócio (Orçamentos/Propostas)**:
  - Bloqueio dinâmico no frontend de 3 ações comerciais críticas:
    1. **Cancelamento de Proposta:** Ocultado completamente em listas, detalhes, atalhos de teclado e menus de ação (exige `propostas.cancelar` ou privilégios de Admin/SuperAdmin).
    2. **Alteração de Vendedor:** Campo no formulário travado como somente leitura (exige `propostas.alterar_vendedor` ou privilégios de Admin/Gerente/SuperAdmin).
    3. **Desconto Geral:** Campo bloqueado para edição com aviso visual explicativo (exige `propostas.desconto_geral` ou privilégios de Admin/Gerente/SuperAdmin).
  - Preservado o fluxo operacional e fallbacks para vendedores comuns operarem normalmente.

- **Fase 4.2 — Painel Administrativo de Permissões (Editor de Catálogo)**:
  - Rota administrativa `/configuracoes/perfis` integrada para edição visual do catálogo `public.perfis`.
  - Editor com checkboxes organizados por módulos através de acordeões colapsáveis.
  - Bloqueio rígido no cliente para evitar alteração do perfil `super_admin` (fixo em `["*"]`) e impedir o uso do curinga `"*"` em outros perfis.
  - Trava de segurança para impedir a desmarcação da permissão `admin.usuarios.edit` no perfil do próprio operador autenticado (proteção contra auto-privação).
  - Modal de diff detalhado (`ConfirmacaoDiffModal`) com visualização de permissões adicionadas (`+` em verde) e removidas (`-` em vermelho) antes do salvamento.
  - Salvamento restrito apenas à coluna `permissoes` de `public.perfis`, com interceptação e tratamento amigável de erro de RLS (falta de política de UPDATE).

### Alterado
- **Ajustes de UX da Sidebar e MobileSidebar (Configurações)**:
  - Transformado o item principal "Configurações" em um grupo colapsável/expansível.
  - Definida a inicialização fechada (`false` por padrão) para os submenus de configurações, respeitando a diretiva de permanecerem ocultos.
  - Ajustado o espaçamento inferior (`pb-8`) do contêiner de rolagem de navegação na Sidebar desktop e MobileSidebar para evitar que o último submenu ("Parâmetros Fiscais") seja cortado na visualização.
  - Sincronização e correspondência de 100% dos submenus com os cards de Hub de Configurações.
- **Documentação de Encerramento**:
  - Criada a documentação consolidada [PERFIS-PERMISSOES.md](file:///d:/PROJETO%20IDEAL%20ANTIGRAVITY/docs/PERFIS-PERMISSOES.md) detalhando o status das fases, limitações de RLS e roadmaps.
  - Atualização dos arquivos [MODULOS-IMPLEMENTADOS.md](file:///d:/PROJETO%20IDEAL%20ANTIGRAVITY/docs/MODULOS-IMPLEMENTADOS.md) e [PROXIMOS-PASSOS.md](file:///d:/PROJETO%20IDEAL%20ANTIGRAVITY/docs/PROXIMOS-PASSOS.md).

## 2026-06-10

### Adicionado
- **Fase 1 — Perfis e Permissões (Catálogo Corretivo)**:
  - Padronização da tabela `public.perfis` como catálogo oficial de perfis do ERP.
  - Eliminação de constraints legadas (`perfis_pkey`, `perfis_user_id_fkey`, `perfis_nome_usuario_key`, `perfis_genero_check`, `perfis_status_check`) e drop de 15 colunas legadas não-oficiais para deixar exatamente as 8 colunas oficiais.
  - Criação da nova PRIMARY KEY na coluna `id` (serial) e UNIQUE constraint na coluna `slug`.
  - Vinculação de `public.usuarios` com `public.perfis` via FK nullable `id_perfil` (com validação condicional para não recriar).
  - Seed dos 7 perfis base: `super_admin`, `admin`, `financeiro`, `vendedor`, `producao`, `fiscal` e `operador` com listas de permissões em JSONB.
  - Implementação de enriquecimento de sessão assíncrono no `AuthProvider.tsx` pós-login/refresh de página.
  - Lógica de fallback legado prioritário em `usuarios.service.ts` baseada em `is_super_adm`, `is_admin`, `is_vendedor` e `setor`.
  - Helpers de verificação de permissão `hasPermissao`, `hasAnyPermissao` e `hasAllPermissoes` com suporte a wildcard `"*"` de `super_admin`.
  - Página de diagnóstico temporária `/minha-conta` exibindo metadados de acesso, permissões ativas e método de resolução.
  - Dropdown interativo no menu do usuário (`UserMenu.tsx`) com atalho para Diagnóstico e opção de logout (**Sair**) unificado no desktop e mobile.
  - Correção de vazamento de estado administrativo (*stale state* / *stale privileges*) e normalização dinâmica de setor com base no perfil.

## 2026-06-09

### Adicionado
- **Refinamento e Higienização de UX de Cobranças e Propostas (/goal)**:
  - Redesenho completo de [CobrancaDetail.tsx](file:///d:/PROJETO%20IDEAL%20ANTIGRAVITY/src/features/cobrancas/CobrancaDetail.tsx) adotando padrão administrativo de alta densidade visual (sem KPIs redundantes e sem campos técnicos desnecessários).
  - Implementação de ocultação de checkout para faturados (`E-FATURADO`, `E_FATURADO`, `FATURADO`) normalizando o tipo da cobrança em [PropostaCobrancaPanel.tsx](file:///d:/PROJETO%20IDEAL%20ANTIGRAVITY/src/features/cobrancas/PropostaCobrancaPanel.tsx) e no detalhe.
  - Regra de valor final do cartão (`cartao_valor_final`) aplicada somente quando o tipo for cartão parcelado e o valor for maior que zero, retornando ao valor base (`valor`) nos demais casos.
  - Exibição visual truncada da URL pública de checkout no painel, garantindo que o link original completo seja copiado para a área de transferência.
  - Remoção de atalhos e botões redundantes de conferência financeira no painel de cobranças geradas e nos orçamentos, sem alterar o acesso geral ao painel financeiro.
  - Higienização completa de termos e frases mockadas/simuladas em [CobrancaDetail.tsx](file:///d:/PROJETO%20IDEAL%20ANTIGRAVITY/src/features/cobrancas/CobrancaDetail.tsx), [CobrancaHistoricoPanel.tsx](file:///d:/PROJETO%20IDEAL%20ANTIGRAVITY/src/features/cobrancas/CobrancaHistoricoPanel.tsx) e [CobrancaActionsMenu.tsx](file:///d:/PROJETO%20IDEAL%20ANTIGRAVITY/src/features/cobrancas/CobrancaActionsMenu.tsx).

- **Refinamento de UX de Orçamentos e Propostas (Ressalvas Obrigatórias)**:
  - Componente [ContactEditModal.tsx](file:///d:/PROJETO%20IDEAL%20ANTIGRAVITY/src/features/orcamentos/components/ContactEditModal.tsx) para edição estritamente local/em memória de contatos do cliente no formulário, sem chamadas ao Supabase (`public.contatos`).
  - Componente [ProductSearchSelector.tsx](file:///d:/PROJETO%20IDEAL%20ANTIGRAVITY/src/features/orcamentos/components/ProductSearchSelector.tsx) com barra de pesquisa para filtrar o catálogo real (por código, nomeReal e apelidos), barra de tags com categorias dinâmicas e validação de duplicidade antes de adicionar produtos.
  - Atribuição automática do vendedor padrão associado ao cadastro do cliente. Se o cliente não tiver vendedor padrão, o campo fica vazio e um toast operacional alerta o operador. Usuários comuns visualizam o vendedor como somente leitura, enquanto admins/gerentes podem editá-lo.
  - Highlight visual (azul suave) e badge dinâmico ("Endereço de sócio" ou "Endereço de vínculo comercial") para endereços do tipo comprador/parceiro comercial.
  - Renomeada a seção 4 do formulário para "4. Dados de faturamento".
  - Removidos produtos/previews estáticos mockados e select antigo.

## 2026-06-01

### Adicionado
- **Encerramento Técnico Final (Fase 6H)**:
  - Documentação final consolidada em [CHAT-INTERNO.md](file:///d:/PROJETO%20IDEAL%20ANTIGRAVITY/docs/CHAT-INTERNO.md) detalhando tabelas, fluxos operacionais, regras de menções/pendências, eventos em tempo real, modelo de segurança (RLS) e roadmaps futuros.
  - Registro de decisões arquiteturais em [DECISOES-TECNICAS.md](file:///d:/PROJETO%20IDEAL%20ANTIGRAVITY/docs/DECISOES-TECNICAS.md) detalhando por que a chave `service_role` não é usada no frontend, por que as pendências têm uma tabela própria e por que a subscrição realtime de pendências foi centralizada no componente Topbar.
  - Atualização geral do progresso em [MODULOS-IMPLEMENTADOS.md](file:///d:/PROJETO%20IDEAL%20ANTIGRAVITY/docs/MODULOS-IMPLEMENTADOS.md).

- **Fechamento Operacional e Polimento Final (Fase 6G)**:
  - Adicionado suporte a teclado com tecla `ESC` para fechar o `NotificationsPopover` de menções, o menu popover do `GlobalChatBubble` e a barra lateral móvel `MobileSidebar` de forma nativa e fluida.
  - Implementado suporte completo de acessibilidade básico com atributos `aria-label` para todos os botões de ícone (remover anexo, anexar arquivos, enviar mensagens, fechar drawers, abrir chats, visualizar propostas e cancelar pendências).
  - Traduzidos os erros de banco de dados (RLS, violações de chave estrangeira, formato de UUID e restrições de verificação CHECK) na camada de serviço para mensagens em português claras e sem jargões técnicos para os operadores.
  - Aperfeiçoado o suporte a Dark Mode nos drawers e timelines, aplicando classes dinâmicas e variáveis de tema CSS para eliminar backgrounds claros/brancos brutos ao alternar temas.
  - Refinados os estados de lista vazia no chat e painéis de pendências com novos contrastes e legibilidade aprimorada para dark mode.

- **Revisão e Estabilização Técnica (Fase 6F)**:
  - Deferido o carregamento de usuários (`listAllUsuarios`) no Drawer de Chat para ocorrer sob demanda (apenas ao focar no campo de digitação), economizando conexões ao ler mensagens.
  - Implementado renderizador de menções por Regex ($O(M)$), substituindo a iteração de usuários sobre as mensagens por uma busca direta de padrão `@username`, validada após o carregamento da lista.
  - Otimizado o fluxo de atualização na Central `/pendencias`: a lista de usuários do sistema agora é carregada apenas uma vez na montagem da página, e as atualizações em tempo real recarregam exclusivamente a listagem de pendências.

- **Realtime + Notificações Operacionais de Pendências (Fase 6D-E)**:
  - Adicionada subscrição realtime de canal único na Topbar para escutar a tabela `public.propostas_pendencias` e atualizar a badge de pendências ativas.
  - Implementada propagação de eventos do realtime da Topbar para os demais componentes (Central de Pendências, PropostaPendenciasPanel) via Custom Event do DOM `propostas-pendencias-realtime`, evitando conexões e subscrições realtime duplicadas.
  - Exibição de Toasts operacionais elegantes em tempo real para eventos-chave: nova pendência atribuída, pendência assumida por outro operador (com fetch de perfil sob demanda), concluída ou cancelada.
  - Ação "Iniciar" renomeada para "Assumir" em todas as telas, associando a resolução ao UUID real do usuário autenticado no Supabase Auth.
  - Destaques visuais premium para pendências `URGENTE` (borda vermelha esquerda, ping animado) e `ATRASADA` (borda âmbar esquerda, badge piscante de prazo vencido) no painel lateral de orçamento e na central.
  - Otimização do painel lateral: lista de usuários carregada exclusivamente sob demanda ao abrir o formulário "Nova Pendência Manual" em vez de no mount.

- **Central de Pendências (Fase 6D-D)**:
  - Criação da página `/pendencias` com layout operacional premium, cards estatísticos interativos e responsividade total.
  - Implementação de filtros avançados por texto livre, status, prioridade, categoria, setor responsável e empresa (dinâmica via PostgREST).
  - Filtros rápidos por abas (Minhas, Setor, Sem Responsável, Urgentes, Atrasadas, Concluídas Hoje).
  - Adição de atalhos rápidos para abrir a proposta e abrir o chat drawer global via `useGlobalChat` na listagem de pendências.
  - Integração do link de navegação `/pendencias` no Sidebar.
  - Badge numérico no Topbar exibindo a quantidade de pendências ativas do usuário logado, com atualização dinâmica via eventos customizados.
  - Paginação incremental eficiente por botão "Carregar Mais" para evitar chamadas redundantes e consultas desnecessárias.
- **Gestão de Pendências Atribuídas (Fase 6D-C)**:
  - Criação da tabela `public.propostas_pendencias` no Supabase com chave estrangeira simples e trigger dedicada de updated_at (`public.set_propostas_pendencias_updated_at`).
  - Implementação de políticas de Row-Level Security (RLS) estritas associadas a `auth.uid()` e à tabela de usuários, validando empresas, setores e permissões de administrador de forma segura no banco de dados.
  - Novo service frontend `propostas-pendencias.service.ts` para consultas, criações e transições de status (iniciar, concluir, cancelar).
  - Componente `PropostaPendenciasPanel` integrado ao drawer global de chat, com visualizador de pendências e formulário de criação manual.
  - Abas deslizantes superiores no `PropostaChatDrawer` para alternar entre "Conversa" e "Pendências" mantendo ambos os painéis montados em DOM.
  - Disparo automático de mensagens do tipo `SISTEMA` no chat ao criar ou alterar status das pendências.
- **Menções no Chat Interno (Fase 6A)**:
  - Autocomplete inteligente acionado via `@` na caixa de texto do chat, com busca nativa filtrada de usuários ativos.
  - Tabela dedicada `propostas_chat_mentions` para registro estruturado desduplicado das menções.
  - Destaque visual das menções na timeline do chat por meio de pills azuis estilizadas.
  - Notificação local por Toast em tempo real integrada à Topbar baseada no ID do usuário logado (`mentioned_user_id = user.id`).
- **Central Global de Notificações (Fase 6B)**:
  - Painel Popover flutuante responsivo acoplado ao sino da Topbar.
  - Carregamento de até 50 menções recentes com join PostgREST nativo para recuperar o texto do chat original.
  - Sincronização em tempo real de contagem e conteúdo do Popover ao receber novas menções via subscrição Supabase Realtime unificada.
  - Redirecionamento instantâneo via clique que abre o chat da proposta correspondente (`router.push`).
- **Balão do Chat Global / Acesso Contextual (Fase 6C)**:
  - Balão de Chat Global (`GlobalChatBubble`) flutuante e responsivo integrado ao layout principal (`AppLayout`) para abertura instantânea do drawer em qualquer módulo.
  - Resolução contextual automática baseada na URL ativa (`usePathname`): abre a proposta correspondente em `/orcamentos/[id]` ou busca e aponta para o orçamento mais recente do cliente em `/cadastros/[id]`.
  - Listagem de até 5 conversas ativas recentes, aplicando filtros em lote contra a tabela `propostas` para respeitar as políticas de segurança de dados (RLS) do Supabase.
  - Implementação de cache de 30 segundos (`CACHE_TTL = 30000`) para persistência de contexto e conversas recentes.
  - Bloqueio de requisições concorrentes e cliques múltiplos via controle síncrono `loadingRef`.
  - Sinalizador discreto e contextual (ponto azul pulsing) exibido no balão se o orçamento correspondente na página tiver menções pendentes não lidas direcionadas ao usuário.
  - Migração de todos os drawers locais em `OrcamentoDetailPage` e `OrcamentosListPageReal` para a nova infraestrutura global do context provider, garantindo que não existam instâncias de drawer duplicadas no DOM e economizando conexões realtime.

### Alterado
- O linter e build do projeto Next.js foram totalmente adequados às regras estritas do React Compiler e ESLint (resolvendo mutações de `window.location` e cascading renders de mount state).

## 2026-05-31

### Adicionado
- Módulo completo de Chat Interno / Timeline Operacional por proposta (`id_int`) integrado ao Supabase.
- Envio de mensagens manuais e upload de anexos de até 10MB no Storage bucket `chat-ideal` com sanitização e caminhos estruturados (`propostas/{id_int}/{timestamp}_{nomeArquivo}`).
- Exibição de imagens (preview) e botões de download dinâmicos para PDFs/documentos no balão de chat.
- Registro automático de mensagens de sistema (`SISTEMA`) nos eventos: PDF gerado, proposta duplicada, cobrança criada, faturamento (`E-FATURADO`) registrado/em análise e proposta cancelada.
- Cabeçalho de drawer lateral de chat contendo badges de contagem de mensagens, anexos e alertas de status (`Pendência` em amarelo e `Recusado` em vermelho).
- Batch query `getPropostaChatResumos` para recuperar as estatísticas de chat de até 100 propostas visíveis na listagem de uma só vez, com tratamento de erros robusto para não quebrar a listagem.
- Controle local de lidas/não lidas por usuário/ambiente persistido em `localStorage` sob a chave `erpideal_chat_read:${user_id_or_email}`, com fallback defensivo por `id` e data de criação.
- Efeito de skeleton/loading na listagem principal de Orçamentos/Propostas (`OrcamentosListPageReal`) e SummaryCards superiores enquanto os dados reais do Supabase estão sendo carregados.
- Aviso visual proeminente com estilo destacado no rodapé caso a conexão real com o Supabase falhe ou retorne dados simulados (`source === "mock"`): *"Não foi possível carregar dados reais. Exibindo fallback local."*
- Suporte no formulário de orçamento para carregar e iniciar propostas no modo "Avulso" a partir de propostas salvas existentes no banco de dados.

### Alterado
- A coluna de Ações e cards mobile na listagem principal de Orçamentos agora exibem badges com o número de mensagens não lidas e alteram a cor do ícone de chat (vermelho = recusado, amarelo = pendência, azul = não lidas, cinza = lidas).
- A aba "Chat interno" no detalhe da proposta comercial indica o número de não lidas e é atualizada automaticamente quando o Drawer é fechado ou um PDF é gerado.
- O hook de dados `useOrcamentosReadOnlyData` foi refatorado para iniciar com a lista de propostas vazia (`propostas: []`) e estado de carregamento ativo (`isLoading: true`), impedindo que dados falsos/mockados pisquem temporariamente por alguns segundos.
- Removidas funções e importações sem uso no hook de dados, limpando advertências do linter.
- Atualizado o divisor de volumes automático para Azul Cargo no webhook para `14500` (14.5kg) para alinhar a estimativa com as regras da interface.

## 2026-05-29

### Adicionado

- Dark Mode completo via estratégia `class` no `<html>`, com alternância por `ThemeToggle` (botão Sol/Lua) na Topbar.
- Preferência de tema persiste em `localStorage` com chave `erp-theme` e respeita `prefers-color-scheme` do sistema operacional.
- Script anti-flash em `layout.tsx` aplica a classe `dark` antes do React hidratar, eliminando piscar visual.
- Componente `ThemeToggle.tsx` em `src/components/app-shell/`.
- Tokens semânticos de ação: `--action-save`, `--action-save-hover`, `--action-edit`, `--action-edit-hover`, `--action-danger`, `--action-danger-hover` e seus respectivos foregrounds.
- Animação `fade-in` global para uso em transições de conteúdo.

### Alterado

- `globals.css` inteiramente refatorado: paleta tokenizada em CSS Custom Properties para light mode (`:root`) e dark mode (`.dark`). Fonte migrada de Arial para **Inter** (Google Fonts).
- Sidebar passou de fundo branco para **azul escuro** via token `--sidebar-bg` (`#0a2540`), com texto claro, item ativo em azul médio e hover suave. MobileSidebar recebeu as mesmas mudanças.
- Topbar passou a usar `backdrop-blur` com fundo `--card` semitransparente e borda `--border`.
- `PageHeader` passou a ter fundo `--primary` (azul escuro) com texto branco — destaque visual de cabeçalho de página.
- `SummaryCard`, `StatusBadge`, `ResponsiveList`, `LoadingSkeleton`, `EmptyState`, `UserMenu` e `CompanySwitcher` passaram a usar tokens CSS (`--card`, `--border`, `--foreground`, `--muted`) — suporte completo a dark mode sem cores hardcoded.
- `DashboardPage` passou a usar `--action-save` no botão "Nova proposta" e tokens para todos os cards e seções.
- Rollback disponível pelo commit `ef1bb46` (checkpoint criado antes das mudanças).


### Alterado

- Cadastros passou a suportar criação e edição com escrita real em `public.clientes` usando payload whitelist.
- Novo cadastro passou a salvar dados relacionados em sequência após cliente: `public.enderecos`, `public.contatos` e `public.clientes_socios`.
- Edição de cadastro passou a executar `UPDATE` em `public.clientes` e `UPDATE/INSERT` controlado dos relacionados sem qualquer `DELETE`.
- Fluxo de identificação do novo cadastro agora bloqueia documento após validação e exige reinício explícito para alterar CPF/CNPJ.
- Lista de atendentes/vendedores foi migrada para leitura de `public.usuarios` com filtro `is_vendedor = true`.
- Consulta CNPJ passou a aplicar fallback de fantasia com razão social quando `nome_fantasia` vier vazio.
- Vínculos comerciais no formulário passaram a buscar cadastro existente em `public.clientes` (ID, nome ou documento), com bloqueio de auto-vínculo e duplicidade.

## 2026-05-22

### Criado

- Estrutura inicial mockada com Next.js, TypeScript e TailwindCSS.
- Login mockado.
- Layout autenticado.
- Sidebar desktop e drawer mobile.
- Topbar com busca global mockada.
- Seletor de empresa com `Todas`, `Ideal`, `Biro` e `E3`.
- Dashboard mockado com cards.
- Gráficos mockados no Dashboard usando Recharts.
- Listagem de Cadastros mockada.
- Tela de detalhe de Cadastro.
- Fluxo de Novo Cadastro com validação inicial.
- Tela de edição de Cadastro existente.
- Funções mockadas para validar ID, documento, CPF/CNPJ e consulta CNPJ.
- Módulo Produtos mockado com lista, detalhe, novo produto e edição.
- Mock `produtos.mock.ts` com produtos, fotos e variações.
- Mock `variacoes.mock.ts` com `variacoes`, `tipos_variacoes` e `produto_variacoes`.
- Módulo Orçamentos/Propostas mockado com lista, detalhe, nova proposta e edição.
- Mock `propostas.mock.ts` com propostas, itens, variações escolhidas, fretes, resumo e cobrança mockada.
- Fluxo visual de proposta com cliente, contato, endereço, comprador/autorizado, produtos, frete e resumo.
- Área de proposta informal copiável para WhatsApp.
- Módulo Cobranças e Pagamentos mockado com lista de conferência financeira, detalhe, criação principal dentro da proposta e página pública por `token_publico`.
- Mock `pagamentos.mock.ts` inspirado em `pagamentos_v2`, com `os_ideal`, PIX, boleto, cartão, cartão parcelado e faturado.
- Painel `Criar e ver cobranças` dentro do detalhe da proposta, como fluxo principal do vendedor.
- Provider local de cobranças para persistir ações mockadas no navegador sem backend.
- Painéis específicos para PIX, boleto, cartão, cartão parcelado e faturado/crédito.
- Página pública mockada com botão de simular pagamento.
- Galeria visual de fotos de Produtos com URL mockada, remoção e foto principal.
- Gerenciamento visual de variações de Produtos com obrigatória e múltipla escolha.
- Card de uso no Maestro em Produto com reconhecimento por apelidos.
- Componente global `AppToast`.
- Logo da Ideal na sidebar.
- Project Rules de UX/UI e listagens.
- Documentação técnica inicial.

### Alterado

- Sidebar ajustada para padrão claro, com modo expandido/recolhido.
- Menu lateral deixou de usar fundo escuro como padrão.
- Menu de ações corrigido para permanecer aberto ao mover o mouse.
- Menu de ações passou a fechar por clique fora, ESC, ação ou abertura de outro menu.
- Menu de ações passou a calcular posição e abrir para cima quando necessário.
- Salvamento de Cadastros passou a usar loading, toast e redirecionamento automático.
- Edição de Cadastro passou a abrir diretamente o formulário completo.
- Documento alterado em edição passou a exibir alerta visual.
- Edição de Cadastro passou a retornar para o detalhe após salvar com toast.
- Novo Cadastro passou a exibir ação de verificar antes do formulário completo, evitando salvar antes da validação inicial.
- Detalhe de Cadastro passou a listar todos os endereços, contatos e vínculos comerciais com feedback mockado nas ações.
- Menu de ações passou a abrir somente por clique, mantendo o posicionamento responsivo e abertura para cima quando necessário.
- Menu lateral passou a habilitar Produtos.
- Busca global mockada passou a incluir resultados de Produtos.
- Variações de Produtos foram refatoradas para usar banco global reutilizável.
- Produto passou a vincular variações existentes por `produto_variacoes`, sem criar variação exclusiva.
- Opções/modelos de variação passaram a vir de `tipos_variacoes`, com valor extra e peso mockados.
- Documentação passou a registrar que variações globais serão mantidas em Configurações.
- Documentação passou a diferenciar `variacoes`, `tipos_variacoes`, `produto_variacoes` e `produtos_proposta_variacao`.
- Menu lateral passou a habilitar Orçamentos.
- Busca global mockada passou a incluir propostas reais do módulo mockado.
- Nova/Edição de Proposta passou a buscar cliente por ID, nome ou documento.
- Vendedor da proposta passou a ser herdado do cadastro do cliente, com edição restrita a admin/gerente.
- Login mockado passou a suportar perfis distintos para validar vendedor bloqueado (vendedor comum) e editável (admin/gerente).
- Status da proposta passou a ser somente leitura no formulário.
- Itens da proposta passaram a ter descrição editável, desconto individual e validação de variações obrigatórias.
- Resumo da proposta passou a considerar acréscimo de tabela especial do cliente, desconto geral por permissão e peso total.
- Fretes mockados passaram a guardar peso usado na cotação e exibir aviso quando o peso da proposta muda.
- Contatos e endereços podem ser adicionados visualmente à proposta sem persistência real.
- Menu lateral passou a habilitar Cobranças.
- Orçamentos passou a criar e acompanhar cobranças diretamente no detalhe da proposta, em vez de tratar o módulo financeiro como criador isolado.
- Lista de Cobranças passou a ter foco em conferência financeira, análise de crédito e liberação para pedido.
- Status financeiros passaram a usar apenas `A_RECEBER`, `A_VENCER`, `PAID` e `CANCELADO`; `CARD_PARCELADO` ficou restrito ao tipo/fluxo.
- Empresa recebedora passou a ser herdada da proposta no fluxo principal de criação de cobrança.
- Mock de faturado passou a criar `A_VENCER` com `confirmado=true` quando há limite e crédito pendente quando não há.
- `StatusBadge` e `humanizeStatus` passaram a suportar `CARD_PARCELADO`, `CONFIRMADO` e `NAO_CONFIRMADO`.
- Módulo `Cobranças e Pagamentos` teve os mocks de crédito alinhados para a validação visual: `E3` passou a representar faturado com limite disponível e `Birô` passou a representar crédito insuficiente com pendência financeira.
- Provider local de cobranças passou a usar a chave `erp_ideal_mock_cobrancas_v3` para limpar estados antigos incompatíveis durante a validação manual dos fluxos.
- Lista `Conferência de cobranças` foi validada visualmente com cenários reais do mock, confirmando `Proposta / OS Ideal`, tipos separados de status, bloqueio de liberação quando há `A_RECEBER`/crédito pendente e liberação após confirmação de todos os pagamentos da proposta `16821`.
- Fluxo de liberação por proposta passou a distinguir `Pronta para liberar` de `Liberada para pedido`, evitando mostrar sucesso antes do clique final do financeiro.
- Menu de ações da conferência deixou de exibir `Liberar para pedido` para propostas já liberadas e passou a mostrar apenas o estado futuro desabilitado `Pedido ainda não criado no mock`.
- A criação da cobrança continua dentro da proposta, mas a interação foi refatorada para modal centralizado por melhor UX e legibilidade.
- Detalhe da proposta deixou de espremer o fluxo de cobrança na lateral e passou a mostrar um bloco-resumo com abertura de dialog central, lista de cobranças e atualização local após gerar PIX, boleto, cartão ou faturado.
- Atalho `/cobrancas/nova` passou a reutilizar o mesmo modal centralizado para manter consistência visual entre proposta e financeiro.
- Card-resumo de `Cobranças` no detalhe da proposta passou a refletir dinamicamente as cobranças mockadas já geradas, evitando inconsistência com a lista real da proposta.
- Modal `Criar cobrança` foi simplificado para fluxo operacional: conferência de contexto, dados básicos, escolha de forma de pagamento e geração direta da cobrança.
- Blocos técnicos grandes de simulação foram removidos do modal (PIX, boleto, checkout, cálculo de taxa e detalhamento de parcelas), mantendo esses detalhes apenas no registro gerado/detalhe.
- Campos condicionais do modal foram reduzidos ao mínimo: vencimento obrigatório para boleto/faturado, parcelas para cartão parcelado e aviso curto de crédito para faturado.
- Decisão registrada: o vendedor informa apenas dados essenciais; detalhes técnicos de PIX, checkout, boletos, parcelas e webhooks pertencem ao backend e ao detalhe da cobrança após geração.
- Resumo da proposta deixou de exibir dropdown de forma de pagamento; a escolha da forma de pagamento agora pertence apenas ao modal `Criar cobrança`.
- Textos de situação financeira passaram a usar `Aguardando pagamento`, `Parcialmente paga`, `Liberada para pedido` e `Aguardando análise de crédito`, evitando o termo ambíguo `Parcialmente aprovada`.
- Cálculo visual de `Já cobrado` e `Saldo` passou a considerar apenas cobranças válidas, limitar excesso visual a zero e alertar quando o mock exceder o total da proposta.
- Mocks iniciais da proposta `#16790` foram ajustados para não nascerem com cobranças válidas acima do total da proposta.
- Provider local de cobranças passou a usar a chave `erp_ideal_mock_cobrancas_v5` para descartar estados antigos incompatíveis com os novos mocks de saldo.
- Primeira entrega do Módulo 09 — Contas a Receber / Gestão Financeira criada em `/contas-a-receber`, com cards de resumo, filtros, abas, carteira de recebíveis, boletos/depósitos, vencimentos, cartões/faturado e previsão de caixa mockada.
- Mock `contas-receber.mock.ts` criado com cenários de PIX pago/pendente, boleto a vencer/vencido/vencendo hoje/pago/cancelado, depósito futuro, cartão aprovado futuro, cartão parcelado futuro, faturado aprovado, crédito pendente e proposta com múltiplos pagamentos.
- Menu lateral passou a habilitar `Contas a receber`, mantendo `Cobranças` como módulo separado.
- Ações financeiras do Módulo 09 foram implementadas apenas como mock com toast: confirmar recebimento, cancelar recebível, prorrogar vencimento, copiar linha digitável e abrir PDF mockado.
- Decisão registrada: Contas a Receber é a carteira financeira de vencimentos, boletos, depósitos futuros, cartões futuros, faturados e previsão de caixa. A criação e conferência da cobrança ficam no Módulo 08 — Cobranças.
- Módulo 09 foi ajustado para visão financeira mais limpa, reduzindo os cards principais para `A vencer`, `Vencidos`, `Vencem hoje` e `Vencem até o fechamento`.
- Filtros de Contas a Receber passaram a usar empresa, tipo, status visual e período com data inicial/final, afetando cards, listas, abas e previsão de caixa mockada.
- Carteira principal deixou de listar `A_RECEBER` por padrão; esses registros representam cobranças ainda não liquidadas/aprovadas e pertencem principalmente ao Módulo 08.
- `Vencido` passou a ser condição visual derivada de `A_VENCER` com vencimento anterior à data atual, sem criar novo status financeiro no mock principal.

## 2026-05-23

### Alterado

- Cadastros passou a ser o primeiro módulo conectado ao Supabase, em modo read-only, sem qualquer operação de escrita.
- A listagem de Cadastros passou a ler `public.clientes` com fallback automático para `cadastrosMock` quando a leitura falha ou a configuração do app não está presente.
- O detalhe de Cadastro passou a ler `public.clientes`, `public.enderecos`, `public.contatos` e `public.clientes_socios`, mantendo fallback para mock.
- A edição de Cadastro passou a abrir com dados reais quando disponíveis, mas continua com salvamento simulado.
- O feedback visual da edição deixou explícito que nenhuma gravação real ocorre no Supabase.
- A conexão read-only passou a depender do `.env.local` com `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- A documentação técnica passou a registrar que o MCP do Supabase ajuda o desenvolvimento, mas não substitui a configuração do app Next.js.
- Ficou registrado como próximo passo a futura análise de escrita real para Cadastros, começando por `UPDATE` controlado, validação de RLS e confirmação explícita antes de gravar.
- A primeira escrita real do módulo foi liberada apenas para `public.clientes.obs`, usando `id_cliente` como chave operacional.
- O payload da fase inicial de escrita real ficou restrito a `obs`, com bloqueio de qualquer alteração em outros campos.
- A confirmação antes de gravar e o sucesso pós-`UPDATE` passaram a ser obrigatórios para a primeira etapa de escrita.
- Endereços, contatos, vínculos comerciais e demais campos sensíveis permaneceram bloqueados para escrita nesta fase.
- Nenhum `INSERT` ou `DELETE` foi implementado na fase inicial de escrita real.
- Criada a matriz viva de segurança de escrita em `docs/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`, com controle por módulo, tabela, campo, operação, status, risco, validação pós-gravação e fase de liberação.
- A documentação técnica passou a registrar a matriz como referência obrigatória antes de novas fases de escrita.
- UPDATE real de `public.clientes` foi expandido e validado no Supabase para campos operacionais simples do módulo Cadastros.
- Chave operacional confirmada como `id_cliente`, com payload enviando somente os campos permitidos alterados.
- Campos liberados para escrita: `obs`, `fantasia`, `telefone_fixo`, `whatsapp_1`, `whatsapp_2`, `email_contato`, `email`, `email_financeiro` e `site`.
- `Nome fantasia / Apelido` passou a gravar somente em `fantasia` e `E-mail principal` passou a gravar em `email_contato` e `email`.
- `apelido`, endereços, contatos, `clientes_socios`, campos fiscais, financeiros, sistêmicos e sensíveis seguem bloqueados para escrita.
- Sucesso na UI agora depende de confirmação real do Supabase, com validação pós-gravação por `SELECT` em `public.clientes`.

### Pendente

- Conexão com Supabase.
- Migrations reais.
- Backend real.
- Integração com APIs reais de CPF/CNPJ.
- Contas a receber consolidado e conciliação real.
- Notas fiscais.
- Pedidos.
- OS / Produção.
- Expedição.
- Relatórios.
- Configurações.
