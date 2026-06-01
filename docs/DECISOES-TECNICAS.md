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

