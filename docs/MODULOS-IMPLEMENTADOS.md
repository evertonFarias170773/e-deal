# Módulos Implementados

## Login

Status: mockado inicial.

Rotas:

- `/login`

Componentes principais:

- `LoginForm`
- `AuthProvider`
- `AuthGuard`

Mocks usados:

- `usuarios.mock.ts`

Pendências:

- integrar Supabase Auth futuramente;
- fluxo real de recuperação/redefinição de senha.

## Layout autenticado

Status: implementado como base visual.

Componentes principais:

- `AppLayout`
- `Sidebar`
- `MobileSidebar`
- `Topbar`
- `GlobalSearch`
- `CompanySwitcher`
- `UserMenu`

Mocks usados:

- `empresas.mock.ts`
- `global-search.mock.ts`
- `usuarios.mock.ts`

Pendências:

- integrar permissões reais;
- aplicar menu por perfil/setor;
- persistir empresa selecionada se necessário.

## Dashboard

Status: mockado inicial aprovado.

Rotas:

- `/dashboard`

Componentes principais:

- `DashboardPage`
- `DashboardCharts`
- `SummaryCard`
- `ResponsiveList`

Mocks usados:

- `dashboard.mock.ts`
- `empresas.mock.ts`

Funcionalidades:

- cards por empresa;
- gráficos mockados;
- atividades recentes;
- filtro por empresa, incluindo `Todas`.

Pendências:

- ligar indicadores a dados reais;
- definir indicadores finais por perfil;
- integrar financeiro, fiscal e produção.

## Cadastros

Status: módulo com listagem, detalhe, criação e edição conectados ao Supabase com escrita controlada por whitelist.

Rotas:

- `/cadastros`
- `/cadastros/novo`
- `/cadastros/[id]`
- `/cadastros/[id]/editar`

Componentes principais:

- `CadastrosListPage`
- `CadastroDetailPage`
- `CadastroFormPage`
- `ActionsMenu`
- `AppToast`

Mocks usados:

- `cadastros.mock.ts`
- `empresas.mock.ts`

Funcionalidades:

- listagem com filtros;
- tabela desktop;
- cards mobile;
- detalhe separado da edição;
- novo cadastro com etapa inicial;
- validação mockada de ID e CPF/CNPJ;
- consulta CNPJ mockada;
- formulário completo;
- edição com dados reais e salvamento real controlado por whitelist;
- endereços;
- contatos;
- vínculos comerciais;
- toast no salvamento.
- retorno para lista no novo cadastro e para detalhe na edição;
- ações mockadas com feedback visual;
- menu de ações por clique, com posicionamento para cima quando próximo ao fim da tela.
- primeira integração read-only do projeto com Supabase;
- listagem lendo `public.clientes`;
- detalhe lendo `public.clientes`, `public.enderecos`, `public.contatos` e `public.clientes_socios`;
- fallback mantido para `cadastrosMock` quando a leitura não estiver disponível.
- escrita real liberada para `INSERT` e `UPDATE` em `public.clientes` com `id_cliente` como chave operacional;
- escrita real liberada para `INSERT` e `UPDATE` em `public.enderecos`, sem `DELETE`;
- escrita real liberada para `INSERT` e `UPDATE` em `public.contatos`, sem `DELETE`;
- escrita real liberada para `INSERT` e `UPDATE` em `public.clientes_socios`, sem `DELETE`;
- novo cadastro salva cliente principal e depois relacionados em sequência com aviso parcial em caso de falha;
- edição salva cliente principal e depois aplica `UPDATE/INSERT` em relacionados conforme `id` existente;
- documento no novo cadastro fica bloqueado após validação, com ação explícita para reiniciar identificação.

Pendências:

- revisar permissões reais de escrita para ambientes com RLS estrita (principalmente `contatos`);
- validar UX fina de abas/seções com operação em desktop e mobile;
- evoluir estratégia de remoção lógica para relacionados já persistidos (sem `DELETE` físico).

## Produtos

Status: módulo com leitura real de `public.produtos`, escrita real controlada por whitelist, upload de fotos no Storage e submódulo completo de Variações de Produto (listagem, cadastro e edição) com persistência real no Supabase.

Rotas:

- `/produtos`
- `/produtos/novo`
- `/produtos/[id]`
- `/produtos/[id]/editar`
- `/produtos/variacoes`
- `/produtos/variacoes/nova`
- `/produtos/variacoes/[id]`

Componentes principais:

- `ProdutosListPage`
- `ProdutoDetailPage`
- `ProdutoFormPage`
- `produtos.service.ts`
- `ProdutoVariacoesListPage`
- `ProdutoVariacaoFormPage`
- `produto-variacoes.service.ts`
- `ActionsMenu`
- `AppToast`

Mocks usados:

- `produtos.mock.ts`
- `variacoes.mock.ts`
- `global-search.mock.ts`

Funcionalidades:

- listagem com filtros por busca, categoria, status, variações, fotos e estoque usando dados reais de `public.produtos`;
- tabela desktop;
- cards mobile;
- detalhe separado da edição;
- novo produto com `INSERT` real controlado por whitelist;
- validação de `id_produto` manual, obrigatório, numérico e único antes do `INSERT`;
- edição com `UPDATE` real controlado por whitelist e `id_produto` somente leitura;
- valores comerciais (`valorUnt`, `valorFixo`, `valor_custo`) editáveis com conversão numérica segura;
- dados fiscais editáveis no formulário e exibidos no detalhe;
- upload real de imagens para Supabase Storage no bucket `e-deal`, pasta `produtos/`;
- tratamento amigável para bucket de imagens inexistente ou erro de permissão no Storage;
- cópia local de dados fiscais a partir de outro produto real, com confirmação antes de preencher o formulário;
- registro de foto em `public.fotosProdutos` somente após upload concluído;
- galeria mantém fotos existentes sem exclusão nesta etapa;
- alerta visual ao alterar preço, custo, peso ou prazo;
- galeria visual de fotos reais, com adição por upload e sem exclusão;
- Banco Global de Variações integrado real no caminho `/produtos/variacoes` usando `public.variacoes` e `public.tipos_variacoes`;
- Listagem global de variações com filtros por busca textual e status (Ativo/Inativo/Todos);
- Cadastro e edição global de variações (/produtos/variacoes/nova e /produtos/variacoes/[id]) gerenciando dados gerais e suas opções internas;
- Exibição da quantidade de opções ativas de cada grupo global na listagem;
- Ações inline de editar e inativar na listagem global e nas opções de variação;
- Aviso amigável ao tentar inativar uma variação global que já possui vínculos ativos com produtos;
- Peso de opções em `tipos_variacoes` tratado, exibido e salvo estritamente em **gramas**;
- Exibição de previews visuais de acréscimo de peso (ex: +5g), valor extra (ex: +R$ 1,50) e cor HEX caso a referência pareça um hexadecimal de cor;
- Bloqueio completo de exclusão física nas tabelas globais (`public.variacoes` e `public.tipos_variacoes`), operando via desativação lógica (`is_ativo = false`);
- Vínculo real entre produtos e variações globais salvo na tabela de junção `public.produto_variacoes`;
- Cópia automática de `variacoes.nome` para `produto_variacoes.nome` ao criar vínculos para estabilidade;
- Sincronização em lote de vínculos ao salvar o produto em `ProdutoFormPage` (insere novos, atualiza flags e remove os desvinculados);
- Exclusão física permitida exclusivamente em `public.produto_variacoes` para desassociação de relacionamentos N-N;
- Preparação técnica para ordenação manual de opções e futura integração com Maestro e produção;
- Toast no salvamento e validação de dados reais na UI.

Pendências:

- revisar campos finais com operação;
- validar responsividade fina em dispositivos reais;
- validar a primeira fase de `INSERT`/`UPDATE` real com operação;
- validar a escrita expandida de valores, fiscal e fotos com operação;
- revisar se foto principal terá persistência própria;
- definir permissões reais para custo, preço, prazo, peso e inativação.

## Orçamentos

Status: módulo integrado real com Supabase (leitura/escrita transacional em public.propostas, public.produtos_proposta e public.produtos_proposta_variacao) e fluxo de seleção do cliente priorizado.

Rotas:

- `/orcamentos`
- `/orcamentos/novo`
- `/orcamentos/[id]`
- `/orcamentos/[id]/editar`

Componentes principais:

- `OrcamentosListPage`
- `OrcamentoDetailPage`
- `OrcamentoFormPage`
- `ContactEditModal` (Edição local temporária de contatos)
- `ProductSearchSelector` (Busca avançada de produtos reais)
- `ActionsMenu`
- `AppToast`
- `orcamentos.service.ts`

Mocks usados:

- `empresas.mock.ts` (apenas para logos/empresas e vendedores de fallback)

Funcionalidades:

- listagem com filtros por proposta, cliente, documento, status, empresa, vendedor e período lendo diretamente do banco;
- tabela desktop;
- cards mobile;
- detalhe e formulário de proposta conectado ao Supabase com herança RLS de sessão;
- fluxo priorizado de seleção do cliente como primeira etapa na criação/edição;
- busca de cliente integrada real ao Supabase (public.clientes) por ID, Nome, Apelido/Fantasia e Documento;
- carregamento assíncrono completo dos endereços e contatos do cliente via `getCadastroCompleto` ao selecioná-lo;
- botão de limpar seleção de cliente para reiniciar busca;
- vendedor herdado do cadastro do cliente (atribuído automaticamente ao selecionar o cliente). Se o cliente não possuir vendedor cadastrado, o campo fica em branco e um toast de aviso operacional é disparado. Usuários comuns visualizam o campo como somente leitura; administradores/gerentes podem editá-lo;
- status exibido como badge somente leitura no fluxo;
- modal compacto de edição de contato `ContactEditModal` atuando estritamente em memória/estado local de modo a não persistir alterações no Supabase (`public.contatos`);
- destaque em azul suave e badge descritivo ("Endereço de sócio" ou "Endereço de vínculo comercial") para endereços cujo tipo for comprador (`tipo === "comprador"`);
- renomeada a Seção 4 do formulário para "4. Dados de faturamento" com descrição correspondente;
- seletor de produtos customizado `ProductSearchSelector` com dropdown reativo pesquisando produtos por código, nome e apelido sobre o catálogo real retornado da API, com categorias (tags) dinâmicas e aviso de catálogo vazio;
- validação de duplicidade que impede a inclusão repetida de um produto no orçamento (exibe toast de aviso);
- produtos da proposta com tags rápidas, quantidade, valores base herdados, prazo, peso, descrição editável e subtotal;
- carregamento em tempo real de variações globais e opções de cada produto via `listProdutoVariacaoVinculos`;
- persistência histórica estática (snapshot) das variações escolhidas em `public.produtos_proposta_variacao` (com valores extras e pesos em gramas);
- validação de variações obrigatórias antes do salvamento;
- desconto individual por item em percentual ou valor;
- cotações de frete simuladas salvas e visualizadas na proposta;
- resumo visual com subtotal bruto, descontos individuais, acréscimo de tabela especial/bônus, desconto geral permitido por perfil, frete, total e peso;
- proposta informal copiável para WhatsApp com dados reais estruturados;
- salvamento em lote transacional seguro usando conciliação no Supabase (atualiza proposta, itens e variações e exclui itens desvinculados fisicamente).

Pendências:

- validar campos finais com operação comercial;
- homologar e expandir recálculos automáticos em `cotacao_frete` e `desconto_proposta` (escrita real já integrada);
- gerar PDF real via backend/Edge Function segura;
- gerar cobranças reais no módulo Cobranças/Pagamentos integrando com `pagamentos_v2`;
- revisar regras oficiais de cálculo antes de conectar dados reais.

## Cobranças e Pagamentos

Status: módulo integrado real com Supabase (escrita controlada em `pagamentos_v2` liberada inicialmente para PIX real da empresa 1, integrado ao fluxo de cobrança real, com reutilização do backend financeiro existente).

Última validação relevante:

- data: `2026-05-22`;
- módulo afetado: `Cobranças e Pagamentos`;
- resumo da alteração: ajuste fino do fluxo de proposta/cobrança, removendo forma de pagamento do resumo comercial, corrigindo textos financeiros e alinhando `já cobrado`/`saldo` aos mocks válidos;
- motivo da decisão: manter a proposta focada em valores comerciais e deixar a escolha de pagamento para o modal de criação de cobrança, com cálculo financeiro visual coerente.

Rotas:

- `/cobrancas`
- `/cobrancas/nova`
- `/cobrancas/[id]`
- `/pagamento/[token]`

Componentes principais:

- `CobrancasList`
- `CobrancaDetail`
- `CriarCobrancaForm`
- `PropostaCobrancaSelector`
- `EmpresaRecebedoraSelector`
- `FormaPagamentoSelector`
- `PixMockPanel`
- `BoletoMockPanel`
- `CartaoMockPanel`
- `CartaoParceladoMockPanel`
- `FaturadoCreditoMockPanel`
- `CobrancaActionsMenu`
- `CobrancaStatusBadge`
- `CobrancaResumoCard`
- `CobrancaHistoricoPanel`

Mocks usados:

- `pagamentos.mock.ts`
- `propostas.mock.ts`
- `cadastros.mock.ts`
- `empresas.mock.ts`

Funcionalidades:

- listagem com filtros por busca, tipo, status, empresa e período;
- tabela desktop e cards mobile;
- menu de ações por linha com ver cobrança, abrir proposta, ver cliente, ver financeiro da proposta, confirmar pagamento mockado, liberar para pedido, analisar crédito e cancelar cobrança;
- criação principal da cobrança dentro da proposta, na área `Criar e ver cobranças`, usando `id_int` e modal centralizado;
- campo obrigatório `os_ideal` no mock de criação;
- empresa recebedora herdada da proposta, sem nova escolha no fluxo principal;
- seleção visual de forma de pagamento com PIX, boleto, cartão, cartão parcelado e faturado;
- bloqueio visual de boleto e cartão para propostas da empresa Birô;
- geração mockada de `token_publico`, `pix_copia_cola`, `url_cobranca`, `linha_digitavel`, `url_pdf` e `cartao_checkout_url`;
- simulação de cartão parcelado com parcelas, taxa, valor final e valor por parcela, mantendo status financeiro principal em `A_RECEBER`;
- simulação de faturado com análise de crédito, aprovação automática quando houver limite (`A_VENCER` + `confirmado=true`) e solicitação ao financeiro via `propostas_chat` quando não houver;
- lista apresentada como conferência financeira de cobranças para o financeiro;
- cálculo visual de liberação para pedido por `id_int`, com estados como aguardando pagamento, aguardando crédito, parcialmente aprovada, pronta para liberar e liberada para pedido;
- nomenclatura financeira operacional com `Aguardando pagamento`, `Parcialmente paga`, `Liberada para pedido` e `Aguardando análise de crédito`;
- ação de liberação escondida para propostas já liberadas, substituída por estado desabilitado de pedido futuro no mock;
- bloco da proposta com resumo financeiro, valor já cobrado, saldo restante, abertura do modal e lista resumida das cobranças geradas;
- cálculo visual de `já cobrado` e `saldo restante` considerando cobranças válidas e alertando discretamente se o mock exceder o total;
- card-resumo de cobranças no detalhe da proposta sincronizado com o estado local mockado já criado;
- modal de criação simplificado com cabeçalho compacto da proposta, dados essenciais, botões simples de forma de pagamento, campos condicionais mínimos e rodapé com `Cancelar`/`Gerar cobrança`;
- remoção de simulações técnicas extensas dentro do modal (PIX, boleto, checkout, cálculos de taxa e prévias longas), mantendo o foco operacional;
- lista extensa de cobranças mantida fora do modal, em bloco próprio da proposta;
- detalhe completo da cobrança com proposta, cliente, `os_ideal`, status, confirmado, condição comercial, links, histórico e campos específicos do método;
- página pública mockada por `token_publico` com botão de simular pagamento;
- confirmação e cancelamento mockados persistidos em estado local do navegador;
- integração do módulo com Orçamentos para gerar e acompanhar cobrança diretamente no detalhe da proposta;
- validação manual concluída para OS Ideal obrigatório, empresa herdada da proposta, bloqueio visual do Birô, geração mockada de PIX/boleto/cartão/faturado e conferência da lista financeira com liberação por proposta.

Pendências:

- validar nomes finais de campos e ações com operação financeira;
- revisar regra oficial de vencimento, atraso, baixa parcial, reserva de limite e cancelamento antes da integração real;
- preparar futuro service de Financeiro para Supabase, aproveitando a integração inicial de PIX ativo;
- integrar futuramente boletos, propostas_chat, análise real de crédito e outras bandeiras de pagamento além do PIX na tabela `pagamentos_v2` (que já possui PIX real ativo para a empresa 1);
- trocar URLs/documentos fictícios por retorno seguro de backend/Edge Function;
- definir regra oficial de liberação da proposta quando houver múltiplas cobranças e pedido parcial.

## Contas a Receber / Gestão Financeira

Status: primeira entrega mockada implementada como carteira financeira.

Última validação relevante:

- data: `2026-05-22`;
- módulo afetado: `Contas a Receber / Gestão Financeira`;
- resumo da alteração: ajuste da rota `/contas-a-receber` para visão de carteira aprovada, com quatro cards principais, filtros por empresa/tipo/status/período e vencido como condição visual derivada;
- motivo da decisão: deixar o financeiro com visão rápida de vencimentos aprovados e manter cobranças `A_RECEBER` principalmente no Módulo 08.

Rotas:

- `/contas-a-receber`

Componentes principais:

- `ContasReceberPage`
- `SummaryCard`
- `ResponsiveList`
- `ActionsMenu`
- `StatusBadge`
- `AppToast`

Mocks usados:

- `contas-receber.mock.ts`

Funcionalidades:

- quatro cards principais: `A vencer`, `Vencidos`, `Vencem hoje` e `Vencem até o fechamento`;
- filtros por busca, empresa, tipo, status visual e período com data inicial/final;
- abas `Carteira`, `Boletos e depósitos`, `Vencimentos`, `Cartões e faturado` e `Previsão de caixa`;
- carteira com recebíveis aprovados/futuros e históricos, sem listar `A_RECEBER` por padrão;
- lista de boletos, depósitos e outros recebíveis inspirada em `boletos`;
- agrupamento de vencimentos em vencidos, vencem hoje, próximos 7 dias e próximos 30 dias;
- visão separada de cartões aprovados, cartão parcelado como tipo e faturado aprovado/pendente;
- previsão de caixa simples por semana, empresa, recebidos x a receber e vencidos, baseada nos filtros ativos;
- status `Vencido` exibido como condição visual derivada de `A_VENCER` com vencimento anterior à data atual;
- ações mockadas com toast para confirmar recebimento, cancelar recebível, prorrogar vencimento, copiar linha digitável e abrir PDF mockado;
- responsividade com tabelas no desktop e cards no mobile;
- ausência de botão `Criar cobrança`, preservando a criação no contexto da proposta pelo Módulo 08.

Pendências:

- validar com o financeiro as colunas finais da carteira e dos boletos;
- definir regra oficial de conciliação, baixa parcial, juros, multa, prorrogação e cancelamento;
- decidir se haverá detalhe próprio de recebível, boleto e depósito;
- preparar futuro service de Contas a Receber para Supabase sem misturar com criação de cobrança.

## Chat Interno

Status: integrado real com Supabase, otimizado e estabilizado, com encerramento técnico concluído na Fase 6H. Controle de leitura local por usuário, autocomplete de menções, central global de notificações e balão flutuante contextual integrado em todo o ERP.

Rotas:
- Acessível via drawer a partir de `/orcamentos` (listagem) e `/orcamentos/[id]` (detalhe)
- Notificações acessíveis via popover na Topbar em todo o sistema
- Balão flutuante global acessível de qualquer página/módulo (ex: `/dashboard`, `/cadastros`, `/produtos`, etc.)

Componentes principais:
- `PropostaChatPanel`
- `PropostaChatDrawer`
- `OrcamentoDetailPage`
- `OrcamentosListPageReal`
- `NotificationsPopover`
- `Topbar`
- `GlobalChatBubble`
- `GlobalChatProvider`
- `orcamentos.service.ts`

Mocks usados:
- Nenhum para fluxo de mensagens e menções (operando 100% integrado ao Supabase).
- Fallbacks locais seguros em caso de indisponibilidade de rede ou localStorage.

Funcionalidades:
- mensagens manuais e automáticas do sistema estruturadas por proposta comercial (`id_int`);
- upload e gerenciamento seguro de anexos no bucket `chat-ideal` com caminhos organizados e sanitização de nomes;
- renderização inteligente de imagens (preview) e botões de download para documentos gerais;
- cabeçalho de drawer reativo contendo contagem de mensagens, anexos e alertas de status (`Pendência` / `Recusado`);
- integração na listagem de propostas com busca otimizada em lote (limitada a 100 itens renderizados);
- controle de lidas e não lidas isolado por usuário/ambiente persistido em `localStorage` e atualizado apenas após carregamento concluído;
- badges dinâmicas com a quantidade exata de mensagens não lidas e tooltips detalhados na listagem de propostas e abas de detalhes;
- atualização instantânea da timeline ao enviar/receber mensagens com o drawer aberto (realtime);
- menções de usuários via autocomplete (`@`) integradas às propostas com pills azuis estilizadas;
- Central Global de Notificações com popover moderno, indicando quantidade de menções pendentes, com sincronização em tempo real, carregamento dinâmico do conteúdo de chat e clique que redireciona e abre o chat correspondente;
- Balão de Chat Global (`GlobalChatBubble`) flutuante posicionado no canto inferior direito para acesso universal à timeline;
- Resolução dinâmica de contextos baseado na URL ativa (`usePathname`), apontando para a proposta correspondente ou localizando a última proposta do cliente visitado;
- Listagem de conversas recentes com as últimas 5 propostas com atividade recente, aplicando filtro em lote no banco para respeitar as políticas de segurança de dados (RLS) do Supabase;
- Cache inteligente local de 30 segundos (`CACHE_TTL`) e debounce síncrono de requisições para evitar queries redundantes e cliques em rajada.
- Sinalizador de atividade discreto (ponto azul pulsante) ativado de forma contextual quando o orçamento ativo possuir menções não lidas pendentes para o usuário logado;
- Carregamento de usuários para autocomplete diferido e sob demanda, disparado apenas ao focar na caixa de texto do chat;
- Renderizador de menções por Regex de alta performance ($O(M)$), eliminando o loop sobre a lista de usuários em todas as renderizações de mensagem.

Pendências:
- criar tabela definitiva de controle de leituras gerais (`propostas_chat_leituras`) no banco de dados para persistência multiplataforma.
- integrar geração automática de pendências nos erros de limite de faturamento (Fase 6D-E).

## Pendências Atribuídas (Fase 6D)

Status: Implementado completo (incluindo Fase 6D-E — Realtime e Notificações, Fase 6F — Estabilização, Fase 6G — Fechamento Operacional e Polimento, e Fase 6H — Encerramento Técnico). Persistência real em `public.propostas_pendencias` com RLS estrito baseado no perfil real do usuário logado (cruzando `auth.uid()` com a tabela `public.usuarios` no Supabase) e trigger isolada de timestamp.

Rotas:
- Acessível via aba "Pendências" no drawer de chat em `/orcamentos` ou `/orcamentos/[id]`.
- Central Geral de Pendências na rota `/pendencias`.

Componentes principais:
- `PropostaPendenciasPanel` (`src/features/orcamentos/components/PropostaPendenciasPanel.tsx`)
- `PropostaChatDrawer` (`src/features/orcamentos/components/PropostaChatDrawer.tsx`)
- `PendenciasPage` (`src/app/(erp)/pendencias/page.tsx`)
- `propostas-pendencias.service.ts` (`src/features/orcamentos/services/propostas-pendencias.service.ts`)
- `Topbar` (`src/components/app-shell/Topbar.tsx`) e `Sidebar` (`src/components/app-shell/Sidebar.tsx`)

Funcionalidades:
- aba superior no drawer para alternar de forma fluida entre o chat e as pendências sem desmontar os painéis;
- listagem de pendências por proposta e formulário de criação manual;
- badges semânticos de prioridade e status com cores integradas ao padrão UX/UI do projeto;
- botões de ação para alterar o status da pendência (Assumir, Concluir e Cancelar) com preenchimento seguro de logs no banco de dados (UUID e Nome do operador);
- bloqueio de exclusões no banco (tabela sem política de DELETE);
- registro automático de eventos operacionais como mensagens do tipo `SISTEMA` no chat ao criar, alterar status, concluir ou cancelar pendências;
- Rota Central `/pendencias` contendo dashboard de cards estatísticos interativos (Minhas, Meu Setor [unassigned], Sem Responsável, Urgentes, Atrasadas e Concluídas Hoje);
- Filtros avançados e dinâmicos por pesquisa textual livre (título, descrição, cliente ou ID da proposta), status, prioridade, categoria, setor e empresa (alimentada de forma dinâmica via PostgREST);
- Abas rápidas integradas para seleção instantânea de escopo das pendências (Minhas, Setor, Sem Responsável, Atrasadas, Urgentes, Todas);
- Ações rápidas na tabela e cards mobile para Assumir, Concluir ou Cancelar pendências, abrir a proposta ou acionar o chat global drawer via context provider `useGlobalChat` sem redundância de conexões;
- Botão de acesso e badge numérico pulsing no Topbar exibindo o total de pendências ativas do operador logado, com atualização instantânea via eventos de janela customizados (`pendencias-updated`);
- Paginação incremental inteligente por botão "Carregar Mais" limitando a exibição inicial e reduzindo consultas redundantes;
- Subscrição em tempo real de canal único no Topbar com propagação via Custom Event customizado do DOM (`propostas-pendencias-realtime`) para sincronizar a central, a listagem e os drawers sem conexões realtime duplicadas no cliente;
- Notificações reativas em Toasts na tela ao receber eventos externos da tabela `propostas_pendencias` (nova atribuída, assumida por outro, concluída ou cancelada), com busca assíncrona on-demand do nome dos envolvidos via PostgREST;
- Ação "Iniciar" renomeada para "Assumir" que preenche automaticamente o campo `responsavel_user_id` com o UUID real da sessão autenticada do operador;
- Destaques visuais premium para pendências `URGENTE` (borda vermelha esquerda, ping pulsante animado na badge) e `ATRASADA` (borda âmbar esquerda, badge pulsante de vencimento) unificados entre a central e os painéis de chat;
- Otimização do carregamento lateral: busca da lista de usuários executada exclusivamente sob demanda ao abrir o formulário "Nova Pendência Manual" em vez de no mount geral;
- Otimização de consultas na Central `/pendencias`: a lista de usuários é buscada uma única vez no mount, separada da escuta e do refresh realtime de pendências;
- Teclado e Acessibilidade: fechamento nativo por tecla ESC em popovers de notificações, menu do balão global e menu lateral móvel (`MobileSidebar`), além de atributos `aria-label` aplicados em todos os botões que possuem apenas ícones;
- Interface em Dark Mode: estilização do drawer de chat, timeline e painel lateral de pendências revisada para suporte total a dark mode, eliminando backgrounds brancos fixos;
- Erros Semânticos em Português: tradução completa de erros do banco de dados (RLS, formato UUID, chaves estrangeiras, restrições CHECK) na camada de serviço para diálogos operacionais legíveis e amigáveis ao usuário final.

## Demais módulos

Status: pendentes/em breve.

Módulos no menu:

- Maestro
- Cobranças
- Contas a receber
- Notas fiscais
- Pedidos
- OS / Produção
- Expedição
- Relatórios
- Configurações
