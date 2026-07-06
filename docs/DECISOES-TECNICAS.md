# Decisões Técnicas

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

Decisão: manter uma matriz permanente em `docs/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md` para registrar o estado de leitura, escrita, bloqueio e futura liberação por módulo, tabela e campo.

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

## Listagem de Or�amentos: Mapeamento de Data / Hora (2026-07-01)
**Decis�o:** O frontend da lista de Or�amentos (/orcamentos) mant�m a exibi��o fiel do timestamp recebido do Supabase (updated_at ou created_at), preservando horas e minutos. N�o h� ajustes de timezone (truncamento para meia-noite UTC) mascarando os dados.
**Motivo e Contexto:** A visualiza��o de datas e hor�rios repetidos na lista (ex: v�rios registros em \28/06/2026, 21:38\ ao filtrar por tipo de cobran�a, especialmente BOLETO) � um reflexo direto de dados armazenados no banco. Investiga��es confirmaram que 776 propostas sofreram atualiza��o em lote nesse exato minuto (2026-06-29T00:38Z). O filtro visual no frontend apenas agrupa essas propostas, tornando a repeti��o percept�vel. Propostas novas possuem hor�rios org�nicos e normais. Qualquer corre��o artificial na tela falsificaria o hist�rico real do banco.


## 6. Evolu��o da Matriz de Permiss�es V2.1 e RPC Segura
**Decis�o:** O sistema adotou a Matriz V2.1, migrando de verifica��es generalistas (ex. `isAdmin`) para permiss�es granulares organizadas por m�dulo. Para mitigar bloqueios de RLS e falsos positivos de sucesso no frontend, adotou-se a estrat�gia de gravar permiss�es via **RPC segura** em vez de UPDATE direto em `public.perfis`.
**Impacto:** Seguran�a ampliada contra auto-eleva��o de privil�gios. A UI foi aprimorada (sticky button, a��es em lote), mantendo a compatibilidade tempor�ria com as roles V1 (Double Support). Os indicativos "(Legado V1)" foram retirados do front para uma apresenta��o mais limpa, mas o sistema preserva as chaves internamente at� a remo��o completa da Fase 4.

## 7. Infraestrutura Unificada de Escopo de Dados
**Decis�o:** Em vez de helpers engessados por m�dulo (ex. `getEscopoPropostas`), adotou-se uma infraestrutura gen�rica de Escopo de Dados (`getDataScope`), que retorna os n�veis padronizados: `own`, `team`, `company` ou `all`.
**Impacto:** A funda��o j� suporta a expans�o org�nica de escopos. O m�dulo de Or�amentos � o primeiro piloto a utilizar escopo por vendedor (`own`).

### Novos Usu�rios e Seguran�a Auth
Decidido que novos cadastros via Auth Google ou Email n�o dar�o acesso imediato. Uma trigger `AFTER INSERT` no `auth.users` ir� criar a linha correspondente em `public.usuarios` assinalada ao perfil `pendente_aprovacao` (sem permiss�es). O `AuthGuard` intercepta contas ativas no Supabase com esse perfil e exibe a mensagem de "Acesso Pendente".


## 8. Maestro V2 e Router Semântico
**Decisão:** O núcleo de inteligência migrou do modelo Simple (Regex/Intents) para o **Maestro V2**, com **Router Semântico e Tools Seguras**.
**Impacto:** Intents baseados em regex viraram legado. Consultas financeiras (faturamento/recebido) leem exclusivamente de pagamentos_v2. Propostas focam apenas na intenção comercial/orçamento. A tag is_prd_aprovado foi mantida como regra provisória até a definição final do status de produção. A próxima fronteira de desenvolvimento será a integração real com Orçamentos.
