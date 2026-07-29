# DECISOES-TECNICAS.md

Versão: 2.0  
Status: Histórico — Registro de decisões  
Última atualização documental: 18/07/2026  
Projeto: ERP Ideal

---

# Decisões Técnicas do ERP Ideal

Este documento preserva decisões tomadas durante diferentes fases do desenvolvimento do ERP Ideal.

Ele possui valor histórico e ajuda a compreender a origem de padrões, limitações, transições e débitos técnicos.

## Regra de uso

Este arquivo não deve ser utilizado sozinho para autorizar uma implementação.

Algumas decisões abaixo pertencem às fases mockadas ou já foram ampliadas, substituídas ou restringidas por documentos mais recentes.

Antes de aplicar qualquer decisão, confirmar:

1. o código atual;
2. `SECURITY.md`;
3. `BUSINESS_RULES.md`;
4. `architecture/ARQUITETURA-MODULAR-ERP-IDEAL.md`;
5. `technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`;
6. o documento oficial do módulo.

Quando houver divergência, prevalece a fonte oficial atual do domínio. A decisão antiga permanece aqui apenas para rastreabilidade.

---

## Encerramento da migração de filtros na URL (29/07/2026)

Decisão: a migração das listagens para o padrão de URL está **encerrada** com dezesseis telas migradas. O Kanban de Pedidos (`/pedidos/kanban` e `/os-producao`) fica **de fora, por estar descontinuado**, e não deve ser migrado nem refatorado.

Motivo:

- o Kanban não é tela ativa do produto: os handlers de mutação são funções vazias e os filtros de prazo comparam com uma data fixa no código, então migrar filtros ali seria investir em código que não opera;
- as telas restantes com filtro — Banco de Variações (`/produtos/variacoes`) e as abas internas do detalhe de NF-e — não entraram na última onda e seguem em `useState` local, sem prejuízo funcional; ficam registradas como escopo futuro, não como dívida da iniciativa.

Consequências:

- se o Kanban voltar a ser desenvolvido, a migração dele entra como tarefa nova, com o padrão já pronto;
- duas validações ficaram pendentes por falta de dado elegível, não por defeito conhecido: a equivalência da Fila de impressão com itens reais (a fila estava vazia nos dois ambientes) e a abertura do modal de `resolver-pendencia` ponta a ponta (nenhuma proposta com pendência de revisão aberta e cobranças disponível). Ambas estão registradas em `technical/PADRAO-FILTROS-URL-NAVEGACAO.md` §7.1.

## Estado de lista na URL, escrito com `router.replace` (28/07/2026)

Decisão: filtros, busca, ordenação, paginação, período e aba das listagens ficam em query params, lidos e escritos por um hook compartilhado (`useUrlFilters`), e a escrita usa `router.replace(url, { scroll: false })`.

Motivo:

- no App Router a página é desmontada ao trocar de rota, então `useState` não sobrevive a atualizar a página, sair e voltar, ao histórico do navegador nem a um link compartilhado;
- a URL como única fonte de verdade elimina estado espelhado e, com ele, o risco de laço de sincronização;
- foi medido nesta versão do Next que `window.history.replaceState` altera a barra de endereços mas **não** reprocessa `useSearchParams` — a tela exibiria filtros diferentes dos que estão na URL. `router.replace` foi verificado e atualiza corretamente, sem remontar o componente;
- a estratégia fica concentrada em um único ponto do hook, então revê-la no futuro não exige tocar nas telas.

Consequências:

- toda rota com lista precisa de `<Suspense>` no `page.tsx`, exigência do `useSearchParams` (o build falha com erro explícito quando falta);
- padrões calculados no cliente (mês corrente, por exemplo) exigem schema memorizado;
- criação de `src/hooks/`, pasta já prevista na arquitetura oficial e até então não usada.

## Escrita da URL: replaceState com cópia local (28/07/2026, revisa a decisão acima)

Decisão: a escrita da query string passa a usar `window.history.replaceState` mais uma cópia local da query dentro do `useUrlFilters`, no lugar de `router.replace`.

Motivo:

- medido em produção: com `router.replace`, em telas com carga de dados, a navegação era descartada quando a página havia sido aberta direto por um link com parâmetros — quem abrisse uma URL filtrada não conseguia mais trocar de filtro;
- o defeito passou despercebido na Fase 2 porque todos os testes de escrita partiam de uma URL limpa;
- `history.replaceState` sempre atualiza a barra de endereços, e a cópia local supre o que falta nele: fazer a tela reagir sem esperar o `useSearchParams`.

Consequências:

- a cópia local vale apenas enquanto a URL de origem não muda; em link novo, voltar ou avançar, a leitura volta a sair da URL;
- um `useSearchParams` lido fora do hook, na mesma tela, não enxerga as trocas de filtro até a próxima navegação real;
- a exceção do `autoRegister` registrada abaixo deixou de ter motivo e foi removida: não há mais escrita de URL fora do hook.

## Exceção do parâmetro `autoRegister` (28/07/2026)

Decisão (revertida em 28/07/2026, ver decisão acima): a remoção do parâmetro `autoRegister` da URL, em Contas a Receber, usava `window.history.replaceState` direto, sem passar pelo `useUrlFilters`. Com a mudança na estratégia de escrita do hook, a exceção deixou de ser necessária e o código voltou a usar `setFilter`.

Motivo:

- `autoRegister` não é filtro: é um comando de uso único, vindo da preparação de boletos, que abre o modal de registro bancário e precisa desaparecer para um F5 não reabrir o modal;
- uma navegação de router disparada logo após a carga inicial dos dados é descartada no build de produção — verificado em produção, com o parâmetro permanecendo na URL indefinidamente, inclusive adiando a chamada para fora do commit;
- neste caso a tela não precisa reagir à mudança: basta o parâmetro sumir, e um `ref` já impede a reabertura do modal.

Consequências:

- é a única escrita de URL do sistema fora do hook, e deve permanecer assim;
- qualquer parâmetro que a tela precise **ler e reagir** continua obrigado a usar o hook;
- as escritas de filtro seguintes partem de `window.location.search`, então o parâmetro removido não retorna.

## Dedupe de eventos de sessão no `AuthProvider` (28/07/2026)

Decisão: eventos de autenticação redundantes do mesmo `user.id` já enriquecido não republicam o usuário base; o reenriquecimento acontece em silêncio e só o resultado final é publicado.

Motivo:

- o Supabase reemite `SIGNED_IN` sempre que a aba volta a ficar visível;
- o usuário base é montado sem permissões, e o `PermissionGuard` interpretava isso como acesso negado, desmontando a página inteira e apagando o estado da tela;
- medido em produção: janela de cerca de 235 ms exibindo "Acesso Negado", com remontagem e recarregamento dos dados a cada retorno à janela.

Consequências:

- permissões continuam sendo revalidadas a cada retorno à janela, sem passar pelo estado intermediário sem permissões;
- usuário bloqueado ou sem cadastro continua perdendo o acesso, inclusive quando o bloqueio é detectado durante o retorno à janela;
- troca real de usuário segue o fluxo completo, porque a comparação é por `user.id`.

## Iniciar sem Supabase

Decisão: a primeira etapa do ERP será visual e mockada.

Motivo:

- validar UX/UI antes de acoplar dados reais;
- evitar risco em banco de produção;
- permitir evolução rápida dos fluxos;
- reduzir retrabalho antes da aprovação visual.

## Não criar migrations nesta fase

Decisão: nenhuma migration será criada durante a fase mockada.

Motivo:

- o banco real ainda não deve ser alterado;
- os módulos ainda estão sendo validados visualmente;
- as regras reais serão conectadas módulo por módulo.

## Usar mocks locais

Decisão: dados mockados ficam em `src/lib/mocks`.

Motivo:

- centralizar dados de teste;
- evitar dados fixos dentro de componentes visuais;
- facilitar troca futura por services reais.

## Arquitetura por features

Decisão: módulos ficam em `src/features`.

Motivo:

- organizar telas e componentes por domínio;
- facilitar evolução módulo a módulo;
- permitir services e tipos específicos por módulo.

## Componentes globais reutilizáveis

Decisão: componentes comuns ficam em `src/components/common`.

Componentes atuais:

- `PageHeader`
- `SummaryCard`
- `StatusBadge`
- `ActionsMenu`
- `ResponsiveList`
- `EmptyState`
- `LoadingSkeleton`
- `AppToast`

## Menu único de ações

Decisão: listas operacionais usam um único botão `Ações` por linha, em vez de vários ícones soltos.

Motivo:

- reduzir poluição visual;
- melhorar acessibilidade;
- manter consistência entre módulos;
- preparar bottom sheet no mobile.

## Chaves operacionais conceituais

Decisão: respeitar as chaves operacionais dos módulos.

Mapeamento conceitual:

- Cadastros: `id_cliente`
- Produtos: `id_produto`
- Orçamentos/Propostas: `id_int`

No front, os nomes podem usar camelCase, como `idCliente`.

## Variações de produtos são globais

Decisão: as variações são cadastros globais reutilizáveis. Produtos apenas vinculam variações existentes por meio de `produto_variacoes`. As variações globais serão mantidas futuramente no módulo de Configurações, não dentro do cadastro de cada produto.

Mapeamento conceitual:

- `variacoes`: representa o grupo da variação, como Fundo Triband, Chip RFID, Acessórios, Tamanho, Acabamento e Extras.
- `tipos_variacoes`: representa as opções/modelos disponíveis dentro de uma variação, com possível valor extra, peso e referência própria.
- `produto_variacoes`: representa o vínculo entre um produto e uma variação global existente, incluindo regras por produto como obrigatória e múltipla escolha.
- `produtos_proposta_variacao`: será usado no orçamento/proposta para salvar a escolha feita na proposta, como Fundo Triband: Azul ou Chip RFID: 955mhz.

Motivo:

- evitar criar variações duplicadas dentro de cada produto;
- permitir reutilizar grupos como Fundo Triband, Chip RFID, Acessórios, Tamanho e Acabamento em vários produtos;
- separar o grupo da variação das opções escolhíveis;
- preparar o cálculo futuro de proposta, onde `produtos_proposta_variacao` armazenará as opções escolhidas e seus impactos de valor e peso;
- preservar o banco global de variações quando um vínculo for removido de um produto.

## Cadastros usa `clientes`

Decisão: a interface chama o módulo de `Cadastros`, mas a tabela futura será `clientes`.

Motivo:

- a tabela real atual representa clientes, fornecedores, transportadoras e órgãos públicos;
- renomear tabela não é prioridade;
- a interface deve refletir melhor o uso operacional.

## Vínculos comerciais

Decisão: a tabela futura `clientes_socios` deve aparecer na interface como `Vínculos comerciais`, não apenas `Sócios`.

Motivo:

- o significado operacional é mais amplo;
- pode representar autorizados a comprar ou cadastros relacionados.

## Regras comerciais em propostas

Decisão: na tela de nova/edição de proposta, vendedor e status não devem ser campos livres para usuário comum.

Regras:

- o vendedor da proposta vem do cadastro do cliente;
- apenas admin/gerente pode alterar vendedor da proposta;
- usuário comum vê o vendedor como campo somente leitura e não pode salvá-lo diferente do cadastro do cliente;
- ao trocar o cliente, o vendedor padrão é recarregado automaticamente;
- login mockado usa `everton@ideal.local` para admin/gerente e `caroline@ideal.local` para vendedor comum;
- status é definido por regras do sistema/backend e aparece como leitura no front;
- desconto geral da proposta exige perfil admin/gerente;
- desconto individual por item pode ser editado no fluxo mockado;
- bônus/tabela especial do cliente é acréscimo percentual sobre produtos, não desconto;
- variações obrigatórias do produto bloqueiam o salvamento se não forem escolhidas;
- fretes guardam o peso usado na cotação e devem ser recotados futuramente quando o peso mudar.

Motivo:

- evitar alterações comerciais sem permissão;
- preservar a origem operacional do vendedor;
- preparar integração futura com regras oficiais de cálculo, cobrança, frete e status no backend/Supabase.

## Integração Supabase futura

Decisão: a conexão com Supabase será feita módulo por módulo após aprovação visual.

Ordem sugerida:

1. Cadastros.
2. Produtos.
3. Orçamentos.
4. Financeiro.
5. Fiscal.

Cada integração deve revisar RLS, RPCs, Edge Functions e dependências existentes antes de qualquer alteração real.

## Cadastros read-only primeiro

Decisão: Cadastros foi o primeiro módulo conectado ao Supabase, mas somente em modo read-only.

Motivo:

- validar a leitura real sem expor o banco a escrita prematura;
- preservar o fallback mock como rede de segurança;
- permitir ajuste fino dos mapeadores antes de qualquer persistência.

## `.env.local` como fonte da configuração

Decisão: a conexão do app Next.js depende de `.env.local` com `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Motivo:

- manter o cliente do front configurado por ambiente;
- evitar depender apenas do MCP ou de contexto manual do Cursor;
- deixar explícito que o Supabase do app e o Supabase do Cursor são coisas diferentes.

## MCP como apoio, não como configuração do app

Decisão: o MCP do Supabase ajuda o Cursor a inspecionar schema, project ID, logs e tabelas, mas não substitui a configuração local do projeto Next.js.

Motivo:

- o MCP serve para desenvolvimento e diagnóstico;
- o runtime do app precisa das variáveis reais no ambiente;
- evitar falsa sensação de integração quando as envs do app não estiverem presentes.

## Edição continua simulada

Decisão: a tela de edição pode abrir com dados reais, mas o salvamento segue simulado até existir uma estratégia controlada de `UPDATE`.

Motivo:

- impedir a impressão de persistência real antes da hora;
- manter o fluxo seguro enquanto o write path não estiver definido;
- permitir validar a UX de edição sem risco ao banco.

## Smoke test de escrita em `obs`

Decisão: a primeira escrita real de Cadastros foi limitada ao campo `public.clientes.obs`.

Motivo:

- reduzir o risco da primeira operação real;
- validar o caminho de `UPDATE` com o menor payload possível;
- manter `id_cliente` como chave operacional e evitar mexer em campos sensíveis;
- bloquear `enderecos`, `contatos`, `clientes_socios` e demais campos até novas decisões.

Regras:

- o payload do `UPDATE` contém somente `obs`;
- qualquer outra alteração no formulário bloqueia a gravação nesta fase;
- o usuário confirma explicitamente antes de gravar;
- sucesso só é mostrado depois da confirmação do Supabase;
- `INSERT` e `DELETE` continuam fora do escopo.

## UPDATE expandido de Cadastros

Decisão: após a validação inicial em `obs`, o `UPDATE` real de `public.clientes` foi expandido para campos operacionais simples e confirmado no Supabase com `id_cliente` como chave operacional.

Regras:

- o payload envia somente os campos permitidos alterados;
- `obs`, `fantasia`, `telefone_fixo`, `whatsapp_1`, `whatsapp_2`, `email_contato`, `email`, `email_financeiro` e `site` podem ser gravados;
- `Nome fantasia / Apelido` grava apenas em `fantasia`;
- `E-mail principal` grava em `email_contato` e `email`;
- `apelido` continua bloqueado nesta fase;
- `enderecos`, `contatos` e `clientes_socios` continuam sem escrita;
- campos fiscais, financeiros, sistêmicos e sensíveis continuam bloqueados;
- sucesso na UI só aparece após confirmação real do Supabase;
- a conferência pós-gravação deve ser feita com `SELECT` em `public.clientes`.

Motivo:

- ampliar a escrita com risco controlado;
- manter a lógica de whitelist explícita e auditável;
- preservar o isolamento de campos e relacionamentos críticos.

## Matriz viva de segurança de escrita

Decisão: manter uma matriz permanente em `docs/technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md` para registrar o estado de leitura, escrita, bloqueio e futura liberação por módulo, tabela e campo.

Motivo:

- centralizar o controle do que está liberado, em teste, planejado ou bloqueado;
- evitar que o histórico de segurança fique espalhado em decisões soltas;
- facilitar revisões antes de novas fases de escrita;
- servir como referência para validação pós-gravação e avanço de fase.

Regras:

- toda nova liberação de escrita deve atualizar a matriz;
- o documento deve registrar tabela, campo, operação, status, motivo, risco, validação, fase/data e observações técnicas;
- `contatos` e demais campos cadastrais já estão integrados para inserção e edição real em whitelist no módulo de Cadastros;
- `cotacao_frete`, `desconto_proposta` e `pagamentos_v2` (escrita controlada liberada para PIX real da empresa 1) estão liberados e em uso real, com reutilização do backend financeiro existente e integração do fluxo real de cobrança PIX;
- `DELETE` destrutivo fora dos cenários explicitamente liberados (como conciliação de itens de proposta), migrations estruturais, alterações de schema, RLS, triggers, views e RPCs permanecem estritamente bloqueados.

## Estado local para cobranças mockadas

Decisão: o módulo de Cobranças e Pagamentos usa um provider client-side com persistência em `localStorage` para refletir criação, confirmação e cancelamento mockados entre lista, detalhe e página pública.

Motivo:

- manter o fluxo navegável sem criar backend, migration ou integração real;
- permitir validar melhor ações críticas e atualização visual de status;
- preparar a troca futura por services reais preservando os componentes do módulo.

## Página pública mockada por token

Decisão: a visualização pública da cobrança foi implementada em rota própria por `token_publico`, mas continua usando o mesmo estado local mockado do ERP.

Motivo:

- validar o conceito de checkout/link público sem expor credenciais nem gateways;
- permitir simular confirmação de pagamento no mesmo conjunto de dados visual;
- manter o front preparado para futura substituição por retorno seguro do backend financeiro.

## Criação da cobrança nasce na proposta

Decisão: a criação da cobrança acontece prioritariamente dentro da Proposta. O módulo Cobranças é usado principalmente para conferência financeira, acompanhamento de status, análise de crédito e liberação da proposta para pedido.

Regras:

- a área principal de criação fica em `Criar e ver cobranças` dentro da proposta;
- a criação da cobrança continua dentro da proposta, mas a interação foi refatorada para modal centralizado por melhor UX e legibilidade;
- o modal de criação de cobrança deve ser simples e operacional, com dados básicos e escolha de forma de pagamento;
- detalhes técnicos como PIX, checkout, linha digitável, cálculos de parcelas/taxa e webhooks não fazem parte da etapa de criação no modal;
- a empresa recebedora vem da empresa já definida no orçamento;
- o vendedor informa `os_ideal`, valor, forma de pagamento, observações e condição/parcelas;
- a forma de pagamento não pertence ao resumo da proposta; a escolha da forma de pagamento ocorre no modal de criação de cobrança;
- o resumo da proposta exibe apenas valores comerciais da proposta, como subtotal, descontos, acréscimos, frete, peso e total final;
- o módulo `/cobrancas` deixa de ser tratado como criador isolado e passa a ser a fila de conferência do financeiro.

Motivo:

- aproximar o mock do fluxo real do ERP;
- refletir que o vendedor cria a cobrança no contexto da proposta aprovada;
- separar melhor a responsabilidade do comercial e do financeiro;
- evitar a compressão visual de um fluxo importante em sidebar estreita, melhorando leitura, edição e conferência;
- reduzir fricção operacional no momento da venda, deixando enriquecimento técnico para backend e telas de detalhe;
- evitar duplicidade conceitual entre condição comercial da proposta e forma efetiva de cobrança;
- preparar o front para acionar futuramente o fluxo seguro de `pagamentos_v2` sem duplicar lógica em telas diferentes.

## Contas a Receber separado de Cobranças

Decisão: Contas a Receber mostra a carteira financeira aprovada e vencimentos. Registros `A_RECEBER` representam cobranças ainda não liquidadas/aprovadas e pertencem principalmente ao Módulo Cobranças. Em Contas a Receber, vencido é condição visual derivada de `A_VENCER` com vencimento anterior à data atual.

Regras:

- `/contas-a-receber` não deve ter botão `Criar cobrança`;
- o módulo lista e acompanha recebíveis, boletos, depósitos, cartões futuros, faturados e vencimentos;
- ações da primeira entrega são apenas mockadas com toast, sem backend, Supabase, migrations, n8n, C6 ou gateway;
- `CARD_PARCELADO` é tipo de cobrança/recebível, não status financeiro;
- status financeiros principais permanecem `A_RECEBER`, `A_VENCER`, `PAID` e `CANCELADO`;
- a carteira principal não lista `A_RECEBER` por padrão;
- `Vencido` é exibido visualmente quando o status base é `A_VENCER` e a data de vencimento já passou;
- cards principais devem focar em agenda financeira: `A vencer`, `Vencidos`, `Vencem hoje` e `Vencem até o fechamento`;
- detalhes como faturado aprovado, cartão futuro e depósitos futuros devem aparecer por filtros e abas, não como cards principais.

Motivo:

- separar a operação comercial de geração/conferência da cobrança da rotina financeira de gestão de carteira;
- permitir que o financeiro acompanhe fluxo de caixa, vencimentos e recebimentos futuros sem recriar cobranças;
- preparar integração futura com `pagamentos_v2` e `boletos` por services específicos, sem misturar responsabilidades entre módulos.

## Revisão Final e Estabilização (Fase 6F)

### Carregamento Deferido de Dados de Usuários

Decisão: adiar a chamada de `listAllUsuarios` no painel de chat da proposta para ocorrer sob demanda apenas quando o usuário interagir ativamente com a caixa de texto (foco na textarea) ou abrir a criação de pendências manuais.

Motivo:

- evitar que a simples montagem do painel de timeline (que ocorre com frequência na listagem de propostas e no balão global) consuma recursos e adicione overhead de conexões ao buscar todos os usuários do sistema sem necessidade imediata;
- reduzir a latência inicial de abertura de chat.

### Processamento de Menções via Regex O(M)

Decisão: abandonar loops aninhados que comparavam a lista completa de usuários com cada string de mensagem e passar a usar regex compilada (`mentionRegex = /@([a-zA-Z0-9\u00C0-\u017F._-]+)/g`) para detectar e envelopar menções.

Motivo:

- a iteração aninhada causava degradação de performance quadrática ($O(N \times L)$) com o crescimento da timeline e da lista de usuários ativos;
- o uso de regex reduz o tempo de parsing de texto para $O(M)$ linear no número de menções da própria mensagem, acelerando sensivelmente o tempo de renderização;
- permite renderização preventiva de menções mesmo antes da lista de usuários ser resolvida sob demanda.

### Segregação de Efeitos de Consulta na Central de Pendências

Decisão: separar a busca de usuários do sistema (`listAllUsuarios`) do efeito de escuta realtime e recarregamento da Central de Pendências.

Motivo:

- evitar recarregar a lista estática de usuários em lote a cada alteração/atualização realtime de pendências recebidas via Custom Event do DOM;
- estabilizar hooks de efeito e prevenir renderizações redundantes.

## Encerramento Técnico Final (Fase 6H)

### Não Uso de Service Role no Frontend

Decisão: O frontend utiliza estritamente o cliente Supabase configurado com a chave pública anônima (`anon key`) e a sessão do usuário logado (JWT). O uso da chave secreta `service_role` é terminantemente proibido no código do lado do cliente.

Motivo:
- **Segurança Estrita**: A chave `service_role` do Supabase tem privilégios de superusuário e bypassa completamente todas as políticas de Row-Level Security (RLS). Expô-la no client-side exporia todo o banco de dados (leitura, escrita e deleção de qualquer tabela) a qualquer usuário mal-intencionado que inspecione o código ou o tráfego de rede.
- **Conformidade com RLS**: Ao usar a `anon key` com a sessão JWT ativa, garantimos que todas as queries enviadas ao Supabase passam pelo crivo das políticas RLS no banco de dados PostgreSQL, forçando a validação de acesso baseada no ID do usuário (`auth.uid()`), empresa e setor.

### Tabela Própria para Pendências (`public.propostas_pendencias`)

Decisão: As pendências são armazenadas na tabela específica `public.propostas_pendencias` em vez de serem modeladas dentro de campos genéricos da tabela de timeline/chat (`public.propostas_chat`).

Motivo:
- **Diferença de Ciclo de Vida e Mutabilidade**: O chat de mensagens é um log cronológico de histórico (normalmente append-only e imutável). As pendências são entidades de controle operacional mutáveis (trocam de status, mudam de responsável, alteram prioridade, possuem prazos de vencimento específicos).
- **Segurança RLS Segregada**: A tabela de pendências exige políticas RLS complexas e granulares (ex: validar se o usuário pertence à mesma empresa ou setor, restringir transições de status, etc.). Misturar isso na tabela de chat poluiria o RLS das mensagens gerais.
- **Desempenho e Indexação**: Permite criar índices específicos em campos como `status`, `prioridade`, `prazo_limite` e `responsavel_user_id`. Consultas na Central de Pendências `/pendencias` e cards estatísticos são otimizados sem necessidade de varrer mensagens textuais complexas.

### Centralização do Realtime de Pendências na Topbar

Decisão: A escuta em tempo real (realtime) das atualizações de `public.propostas_pendencias` é concentrada em um único listener WebSocket localizado no componente `Topbar`, que propaga os eventos aos demais componentes por meio de um Custom Event do DOM (`"propostas-pendencias-realtime"`).

Motivo:
- **Mitigação do Consumo de Conexões WebSocket**: O Supabase cobra e limita o número de conexões realtime ativas. Se o painel da Topbar, a página `/pendencias` e o Drawer lateral estabelecessem conexões separadas, um único usuário com duas abas abertas poderia exaurir facilmente as cotas de conexão do projeto.
- **Eficiência de Rede**: Uma única conexão ativa na aba recebe a alteração e despacha o evento localmente via JavaScript no navegador do usuário. Os componentes inscritos no Custom Event reagem imediatamente sem requisições de rede adicionais ou subscriptions duplicadas.

## Perfis e Permissões (Fase 1)

### Catálogo Centralizado em `public.perfis`

Decisão: Padronizar a tabela existente `public.perfis` como o catálogo oficial de perfis de acesso do ERP Ideal.

Motivo:
- **Reaproveitamento de Estrutura**: A tabela já existia no banco com dados legados sem uso ativo. Em vez de criar tabelas com novos nomes (ex: `perfis_acesso`), foi realizada uma higienização segura (backup de segurança, drop de 15 colunas legadas e remoção de 5 constraints legadas de chaves primárias e estrangeiras incompatíveis).
- **Padronização**: A tabela ficou exclusivamente com as 8 colunas oficiais: `id` (serial PK), `slug` (text UNIQUE NOT NULL), `nome`, `descricao`, `permissoes` (jsonb NOT NULL DEFAULT '[]'), `ativo`, `created_at` e `updated_at`.

### FK `id_perfil` Nullable em `public.usuarios`

Decisão: A vinculação na tabela `public.usuarios` com a tabela `public.perfis` foi feita através de uma chave estrangeira `id_perfil` definida como opcional (`nullable`).

Motivo:
- **Transição Suave**: Permite que os usuários atuais permaneçam com `id_perfil = null` enquanto a transição de permissões está em homologação.
- **Fallback Legado Ativo**: Na ausência de um perfil associado (`id_perfil = null`), o sistema aciona automaticamente o fallback baseado em flags legadas (`is_super_adm`, `is_admin`, `is_vendedor`) e a coluna `setor`, garantindo que ninguém perca acesso operacional durante a transição.

### Armazenamento de Permissões como Array JSONB de Strings

Decisão: As permissões no catálogo de perfis são guardadas na coluna `permissoes` como um array simples de strings (ex: `["cobrancas.view", "cobrancas.confirmar"]`).

Motivo:
- **Simplicidade de Validação**: Facilita a leitura e a escrita direta na base via painel do Supabase.
- **Flexibilidade**: Permite o uso de wildcard `"*"` atribuído ao perfil `super_admin` para liberar acesso irrestrito, resolvido nativamente no helper de permissão `hasPermissao()`.

### Enriquecimento Assíncrono de Usuário

Decisão: O carregamento de dados detalhados do perfil e permissões do usuário logado é realizado após a autenticação inicial de forma assíncrona.

Motivo:
- **Desempenho de Inicialização**: O `AuthProvider` inicializa imediatamente a sessão com o JWT do Supabase Auth para liberar a interface e, em paralelo, executa a busca de enriquecimento do perfil.
- **Isolamento de Erros**: Se o fetch das permissões ou perfil falhar por instabilidade de rede, a aplicação não quebra, recorrendo imediatamente ao fallback legado.

### Prevenção de Vazamento de Privilégios (*Stale State*)

Decisão: Limpeza completa de todo e qualquer estado local referente ao perfil enriquecido no momento do logout (`signOut`). Caso o e-mail do usuário não seja reconhecido no enrichment, é gerado um "guest-user" neutro.

Motivo:
- **Segurança de Acesso**: Evita que ao trocar de usuário no mesmo navegador os privilégios administrativos do usuário anterior permaneçam ativos em cache no estado do React (*stale state*).
- **Guest-User Restrito**: Um e-mail não cadastrado na base de usuários não ganha privilégios de fallback administrativo por engano, mantendo a tela vazia/bloqueada.

### Normalização Dinâmica de Setor na UI

Decisão: Caso o campo `setor` esteja vazio ou nulo no cadastro do usuário (`public.usuarios`), o sistema infere o setor operacional com base no `perfilSlug`.

Motivo:
- **Correção de Badge**: Impede que usuários com setores desconfigurados no banco sejam renderizados incorretamente como "ADMIN" ou fiquem com o divisor visual nulo na Topbar.
- **Consistência Visual**: Alinha a identidade visual do cargo exibido no menu do usuário com as regras operacionais do ERP.

## Produção em duas fases (Módulo Produção)

DECISÃO: Produção será implementada em duas fases.

Fase 1: Catálogo de Imposição.
Fase 2: Execução Operacional.

Justificativa:
- Evitar acoplamento prematuro com:
  - propostas
  - pedidos
  - produtos
  - ordens de serviço
- Permitir evolução incremental e validação do fluxo antes da criação das entidades operacionais.

### Padrões de Banco para Novas Tabelas de Produção

Decisão:
- **Chaves Primárias**: UUID como padrão de chave primária.
- **Vínculo Multiempresa**: Coluna `empresa_id` (ou `id_empresa`) obrigatória para todas as novas tabelas do módulo.
- **Segurança RLS**: Row-Level Security (RLS) habilitado por padrão em todas as tabelas criadas.
- **Exclusão Lógica**: Soft delete preferencial para evitar deleção física de dados do catálogo.
- **Segurança de Usuários**: Não criar sistemas paralelos de usuários, utilizando estritamente a autenticação nativa e a tabela `public.usuarios` centralizada.

## Regra de Escalabilidade para Status (Fase 4A.1)

Decisão: Status não devem ser tratados com strings soltas em componentes. 

Regras:
- Novas regras devem usar constantes/matriz central (ex: `mappers.ts`, `types.ts`).
- Status desconhecido nunca pode virar `NOVO`.
- Qualquer transição nova deve ser adicionada primeiro na matriz central.
- Qualquer escrita real de status_interno precisa de log (propostas_chat) e origem identificada.
- Qualquer automação nova de status precisa ser protegida por feature flag e ter documentação de rollback.
- Validação em modo sombra antes de escrita real.


## Refatoração da Esteira de Notas Fiscais (2026-06-30)
- **Flag Única para Faturamento:** A liberação de notas foi centralizada na coluna `libera_nf` (`public.propostas`), desacoplando a esteira fiscal de status operacionais ou financeiros, o que evita que mudanças na operação quebrem a fila fiscal.
- **Unificação Visual no Fiscal:** A interface foi simplificada. Há apenas uma "Fila de Faturamento" unificada e uma aba consolidada de Históricos. A decisão do tipo de documento (Produto vs Serviço) ocorre no momento da ação (gaveta lateral com botões específicos de simulação/emissão).
- **Controle de Acesso (Workaround):** Devido à ausência atual de um RBAC granular, a liberação para NF foi protegida provisoriamente por verificações genéricas de perfil (`isSuperAdmin` ou `isAdmin`), gerando o débito técnico de implementar as permissões corretas.


## Liberação Explícita para Faturamento (Fiscal)
**Decisão:** Utilização da flag `public.propostas.libera_nf = true` como gatilho de liberação explícita e temporária para a fila de faturamento.
**Motivo:** Evita que o setor fiscal fature acidentalmente pedidos que ainda estão em negociação ou validação comercial/produção. Mantém a separação de responsabilidades (Comercial libera -> Fiscal fatura). Mocks não são mais utilizados na fila de faturamento para evitar inconsistências contábeis.

## Regra Preventiva de Build e Imports
**Decisão:** Obrigatório confirmar a existência de arquivos e exports reais antes de importar novos componentes/services, e executar `npm run build` após alterações críticas.
**Motivo:** Erros de importação em componentes centrais (ex: `PedidosListPage.tsx`) quebram rotas inteiras e módulos dependentes (como Fiscal e Notas Fiscais). Validações exclusivas de TypeScript (`tsc`) não garantem a integridade do empacotamento Next.js para produção.

## Listagem de Orçamentos: Mapeamento de Data e Hora (01/07/2026)

**Decisão:** O frontend da lista de Orçamentos (`/orcamentos`) mantém a exibição fiel do timestamp recebido do Supabase (`updated_at` ou `created_at`), preservando horas e minutos. Não há ajuste artificial de timezone ou truncamento para meia-noite UTC para mascarar os dados.

**Motivo e contexto:** A visualização de datas e horários repetidos na lista, como vários registros em `28/06/2026, 21:38` ao filtrar por tipo de cobrança, especialmente boleto, reflete os dados armazenados no banco. A investigação registrada indicou que 776 propostas receberam atualização em lote no mesmo minuto (`2026-06-29T00:38Z`). O filtro apenas tornou a repetição mais visível. Corrigir artificialmente a tela falsificaria o histórico real.

## Evolução da Matriz de Permissões V2.1 e RPC Segura

**Decisão:** O sistema adotou a Matriz V2.1, migrando de verificações generalistas, como `isAdmin`, para permissões granulares organizadas por módulo. Para evitar bloqueios de RLS e falsos positivos de sucesso no frontend, foi adotada uma RPC segura para gravar permissões, em vez de `UPDATE` direto em `public.perfis`.

**Impacto:** Maior proteção contra autoelevação de privilégios. A interface recebeu melhorias como botão fixo e ações em lote, mantendo compatibilidade temporária com as roles V1. Os indicativos visuais de legado foram retirados, mas as chaves internas permanecem até a remoção completa da compatibilidade.

> A disponibilidade e a autorização atuais da RPC devem ser confirmadas no código, em `PERFIS-PERMISSOES.md` e na Matriz de Segurança antes de qualquer alteração.

## Infraestrutura Unificada de Escopo de Dados

**Decisão:** Em vez de helpers rígidos por módulo, como `getEscopoPropostas`, foi adotada uma infraestrutura genérica de escopo de dados por meio de `getDataScope`.

Níveis padronizados:

```text
own
team
company
all
```

**Impacto:** A fundação permite expandir escopos de forma uniforme. O módulo de Orçamentos foi registrado como primeiro piloto do escopo por vendedor (`own`).

## Novos Usuários e Segurança de Auth

**Decisão registrada:** Novos cadastros por Google ou e-mail não devem receber acesso operacional imediato. O desenho prevê criação do registro correspondente em `public.usuarios` com perfil `pendente_aprovacao`, sem permissões, e bloqueio pelo `AuthGuard` até aprovação.

> Trigger, perfil, RLS e comportamento atual devem ser confirmados antes de qualquer mudança. Este registro histórico não autoriza criação ou alteração estrutural no Auth ou no banco.

## Maestro V2 e Router Semântico

**Decisão:** O núcleo de inteligência evoluiu do modelo Simple baseado principalmente em regex e intents para o Maestro V2, com Router Semântico e tools controladas.

**Impacto:** Consultas financeiras de recebimentos utilizam `public.pagamentos_v2`. Propostas permanecem no domínio comercial. A flag `is_prd_aprovado` continua sendo a referência operacional documentada para liberação na Produção. A evolução seguinte é orientada pela integração real com Orçamentos e pela homologação das tools.

---

# Documentação Relacionada

- `../PROJECT_CONTEXT.md`
- `../SECURITY.md`
- `../BUSINESS_RULES.md`
- `../DEVELOPMENT.md`
- `../architecture/ARQUITETURA-MODULAR-ERP-IDEAL.md`
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
- `../technical/PERFIS-PERMISSOES.md`
- `../business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md`
- `../business/CHECKOUT-PAGAMENTOS.md`
- `../maestro/STATUS-MAESTRO-V2.md`
- `./CHANGELOG.md`

---

# Fonte da Verdade

Este arquivo é um registro histórico de decisões.

Ele explica por que determinadas soluções foram escolhidas, mas não substitui a documentação oficial vigente nem o comportamento confirmado no código.

Nenhuma decisão histórica autoriza alteração de schema, migration, trigger, RPC, view, RLS, Auth, integração financeira ou escrita em produção sem validação e autorização atuais.
