# Changelog

## 2026-06-01

### Adicionado
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
