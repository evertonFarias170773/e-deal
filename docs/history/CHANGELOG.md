# CHANGELOG.md

Versão documental: 2.1  
Status: Histórico — Registro de alterações  
Última revisão documental: 17/08/2026  
Projeto: Vibe

---

# Histórico de Alterações

Este arquivo registra mudanças relevantes realizadas ao longo do desenvolvimento do Vibe.

Os registros descrevem o estado do projeto na data indicada. Eles não substituem a documentação oficial vigente, o código atual, a Matriz de Segurança ou as regras de negócio.

## Regra de uso

- consultar este arquivo para rastrear alterações;
- confirmar o comportamento atual no código;
- não usar uma entrada histórica para ampliar permissões ou escrita;
- manter as entradas mais recentes no topo;
- registrar somente mudanças efetivamente implementadas ou claramente marcadas como não lançadas.

---

## [Unreleased] - 2026-08-17

> Cobre as mudanças de 05/08 a 17/08/2026 nos módulos de Expedição, Produção e
> Conferência. Documentação oficial correspondente: `business/EXPEDICAO.md` (v1.1),
> `business/PEDIDOS-PRODUCAO.md` (v2.1), `business/FLUXO-OFICIAL-STATUS-PROPOSTAS.md` (v3.3)
> e `technical/PADROES-UX-UI.md` (v2.2).

### Adicionado
- **Expedição / Correios — credenciais por empresa:** cartão de postagem e contrato são por CNPJ, e as empresas do grupo têm contratos distintos. `lerConfigCorreios(idEmpresa)` passou a ler `CORREIOS_<empresas.id>_{USUARIO,CODIGO_ACESSO,CARTAO_POSTAGEM,CONTRATO}`, com as variáveis sem sufixo como padrão. O segredo é reconhecido pelo prefixo: `cws-…` é token pronto (expira em horas), qualquer outro valor é código de acesso e o token passa a ser renovado a cada operação. A empresa remetente sai de `resolverEmpresaRemetente()` e **as rotas de prepostagem e de rótulo resolvem igual** — o rótulo só é acessível pelo cartão que criou a pré-postagem.
- **Expedição / Declaração de conteúdo:** nova rota `GET /api/expedicao/declaracao-conteudo` (`expedicao.view`) e PDF A4 com itens reais do pedido, totais, textos legais e linha de assinatura, com no mínimo 8 linhas de tabela. Aparece no menu de ações **somente quando o pedido não tem NF-e autorizada** — o rótulo dos Correios traz só o endereçamento, e o volume precisa viajar com o documento.
- **Boletim / aba Revisão:** a aba "Expedição / pedido inteiro" virou **Revisão** e passou a concentrar a conferência: um bloco por setor (peso estimado derivado, peso real, responsável) e um bloco único de volume e peso do pedido (qtd, tipo, peso líquido derivado, peso bruto total), mais peso bruto por volume quando há mais de um. Botão "Confirmar revisão e liberar para Expedição" grava e **delega a `marcarPronto`** — mesma guarda de concorrência e mesma trilha em `os_status_log`, sem um segundo caminho para `EXPEDICAO`. Trava exige todos os setores conferidos e as pendências aparecem nomeadas por setor.
- **Banco:** migration `20260816_expedicoes_peso_bruto.sql` (aplicada) adiciona `expedicoes.peso_bruto_kg` (numeric) e `expedicoes.pesos_volumes` (jsonb), nuláveis e aditivas. Peso bruto é grandeza distinta de `peso_kg`, que continua sendo o aferido usado na etiqueta e na prepostagem.
- **QR de Produção / usuário logado:** quem escaneia **já logado no ERP e com `pedidos.view`** é redirecionado para a edição do boletim em vez da página pública de troca de status. Nova rota `GET /api/os-qr/sessao`, que lê apenas a sessão do cookie e responde `{ autenticado, podeEditar }` — nunca recebe nem devolve o token do QR. Sem sessão ou sem permissão, o fluxo público continua idêntico; falha na consulta cai em não-autenticado e não derruba a troca de status.
- **Listagens:** `ResponsiveList` ganhou `getRowHighlight`, para destacar linhas de uma categoria sem tocar em filtro, consulta ou ordenação. Exige as duas cores (`base` e `hover`) porque o hover é aplicado por estilo inline. Primeiro uso: Conferência de pagamentos, fundo amarelo claro em `tipo_cobranca = E-Faturado`, nas duas abas.

### Alterado
- **Expedição / payload dos Correios alinhado a evidência real:** duas pré-postagens foram criadas em produção em 16/08/2026 (`AD802864385BR`, Ideal Gráfica; `AD802865749BR`, E3). O payload do ERP foi ajustado ao que comprovadamente passou: `cienteObjetoNaoProibido` de `"S"` para **`"1"`**, `itensDeclaracaoConteudo` **passou a ser enviado** (`{ conteudo, quantidade, valor }`, com genérico de material gráfico quando não há itens), `numeroCartaoPostagem`/`numeroContrato` e `solicitarColeta: "N"` incluídos, e `modalidadePagamento` **removido** — campo extra é candidato a 400.
- **Etiqueta interna 10×15 redesenhada:** de lista de linhas do mesmo tamanho para blocos com moldura, hierarquizados por distância de leitura — NF-E e PEDIDO em número grande, cidade/UF em corpo grande, CEP ancorado no rodapé do bloco do destinatário, bloco de transportadora com Volumes/Embalagem/Peso bruto e rastreio, observação de transporte e rodapé com remetente + QR pequeno. O QR continua sendo conferência interna (`/orcamentos/:id_int`), não rastreio.
- **Expedição / menu de ações:** "Detalhes da proposta" saiu e entrou "Boletim da produção" (`/pedidos/boletim?id_int=…&modo=edicao`) — na bancada o que se consulta é o que foi produzido, não a negociação.
- **Expedição / confirmação:** "Marcar pronto" e "Marcar entregue" deixaram de usar `window.confirm` e passaram a pedir confirmação no `ConfirmarAcaoModal`, no padrão visual do sistema.
- **Boletim:** o "BLOCO 8 — Revisão / Conferência" foi removido das abas de setor (seus campos vivem agora na Revisão); Briefing Comercial (BLOCO 2) e Configurações Técnicas e Acabamento (PCP) não são renderizados na aba Revisão, por já existirem em cada setor; o botão de salvar fixo do rodapé foi removido — permanecem o do cabeçalho e o flutuante, ambos `type="submit"`.
- **Menu lateral (Sidebar):** a seção aberta ficou visualmente distinta — cabeçalho com fundo e texto em cor cheia, bloco de itens com recuo e fio à esquerda. A seta girada sozinha não era sinal suficiente. O `onMouseLeave` do cabeçalho volta para o fundo de seção aberta, não para transparente. Terceiro nível compensado de `ml-5/pl-4` para `ml-3/pl-3` para não truncar rótulos longos. Desktop e drawer mobile.
- **Configuração:** `.env.local.example` documenta `CORREIOS_AMBIENTE` e o bloco por empresa. As 13 variáveis dos Correios e as 3 do QR público (`OS_QR_PUBLICO_ENABLED`, `OS_QR_TOKEN_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`) foram aplicadas na Vercel em 17/08/2026, com redeploy.

### Corrigido
- **Conferência de pagamentos / ordenação:** a lista ordenava por `paid_at` puro, e qualquer modalidade sem liquidação bancária colapsava para 0 e caía em bloco no fim — era o caso de E-Faturado, com `paid_at` nulo em 234 das 237 cobranças, exibido abaixo de PIX confirmados dias antes. `sortByConferenceRecency` passou a usar a data oficial da tela (`data_confirmacao → paid_at → created_at`, via `getDataReferenciaCobranca`), com `created_at` como desempate. Nenhum tipo de cobrança é tratado à parte; filtros, paginação e consultas inalterados.
- **Correios / telefone do destinatário:** a API valida `celular` com 9 dígitos e `telefone` com 8 — mandar celular no campo `telefone` retornava "Telefone do destinatário inválido". `contatoParaPayload()` passou a escolher o par pelo tamanho do número (`dddCelular`/`celular` ou `dddTelefone`/`telefone`) e a omitir o campo inteiro quando o número é inválido, em vez de enviar string vazia.
- **Boletim / peso líquido:** o campo somava `peso_real` de cada setor e por isso nascia "Não conferido" — inútil justamente no momento em que o revisor precisa da referência. Passou a somar o peso **estimado** dos produtos de cada setor, que é derivado e existe antes de qualquer conferência.
- **Migration `20260804_recalc_valor_total_propostas.sql`:** o arquivo versionado divergia do banco. Reescrito para refletir o estado real, com aviso explícito de que `recalcular_proposta_v4_trigger()` é **compartilhada por quatro tabelas** — `CREATE OR REPLACE` nela atinge todas. `public.propostas` passou a ter função e trigger dedicadas (`propostas_preencher_valor_total_avulsa`), sem tocar na função compartilhada.

## [Unreleased] - 2026-07-28

### Adicionado
- **Padrão / Listagens:** Persistência de filtros e estado de navegação na URL. Novos `src/lib/url-state.ts` (codecs), `src/hooks/useUrlFilters.ts` e `src/hooks/useDebouncedValue.ts`. Filtros, busca, período, paginação e aba passam a viver em query params: sobrevivem a atualizar a página, sair da tela e voltar, ao histórico do navegador e a um link copiado. Valor padrão não entra na URL; valor inválido cai no padrão seguro; mudar filtro volta para a primeira página. Documento oficial: `technical/PADRAO-FILTROS-URL-NAVEGACAO.md`. **Obrigatório em listas novas.**
- **Contas a Receber (piloto):** Primeira tela migrada para o padrão. Parâmetros `q` (aceita o antigo `search`), `aba`, `emp`, `status`, `ini` e `fim`; período aceita `todas` para "sem filtro de data". Busca ganhou debounce. O link gerado pela preparação de boletos passou a usar `?q=...&ini=todas&fim=todas&autoRegister=1`. Consultas, totais, agrupamentos, ordenação por vencimento, permissões e abas permanecem inalterados — conferidos contra a versão anterior em produção. Nenhum outro módulo foi migrado.
- **Orçamentos:** Segunda tela migrada para o padrão de filtros na URL. Parâmetros `q`, `status`, `modelo`, `vend`, `cob`, `card`, `periodo` e `pag`. A busca ganhou debounce (antes cada tecla disparava uma consulta ao Supabase) e o retorno à primeira página passou a ser responsabilidade do hook. Lista, ordem, totais e paginação conferidos como idênticos aos da versão anterior em produção.
- **Cadastros:** Terceira tela migrada para o padrão de filtros na URL, cobrindo a lista principal (`q`, `qid`, `pag`) e a sub-lista de propostas do detalhe, com prefixo `prop-` (`prop-q`, `prop-status`, `prop-pag`). As duas buscas ganharam debounce: antes cada tecla disparava uma consulta paginada ao Supabase. A busca por ID continua aceitando apenas dígitos, inclusive quando o valor vem digitado direto na URL.
- **Produtos:** Quarta tela migrada, com `q`, `cat`, `status`, `variacoes`, `fotos` e `estoque`, e restauração dos chips de filtro ativo. Como a filtragem é em memória, ela continua acontecendo a cada tecla; o debounce vale apenas para a gravação na URL. Sem paginação — nenhuma foi criada.
- **Conferência (Cobranças):** Quinta tela migrada, com `q`, `tipo`, `emp`, `vend`, `aba`, `ini` e `fim`. Os cartões de resumo e as abas gravam tipo e aba na mesma escrita, sem estado intermediário. O mês exibido continua derivado das datas, fora da URL. Consultas, totais e regras de conferência inalterados.
- **Pedidos (Painel Geral):** Sexta tela migrada, com `q`, `status`, `vend` e `emp`. A tela não tem paginação nem controle de ordenação — nenhum dos dois foi criado. Filtragem em memória a cada tecla; debounce apenas para a gravação na URL.
- **Expedição:** Sétima tela migrada, com `q` e `status`. O modo compacto **não** entra na URL: por ser preferência visual, ficou em `sessionStorage`, na chave `ui:/expedicao:compacto`. Um link copiado leva os filtros e não leva o modo de exibição.
- **Conta Corrente:** Oitava tela migrada, com `q`, `status` e `sentido` (crédito ou débito). O nome `sentido` evita colisão com `dir`, reservado para direção de ordenação. Filtragem em memória a cada tecla; debounce apenas para a gravação na URL. Consultas, ordenação por data, totais dos cartões e o gate de permissão financeira permanecem inalterados.
- **Pendências:** Nona tela migrada, com `q`, `status`, `prio`, `cat`, `setor`, `emp` e `aba` (as sete abas rápidas). Fora da URL, de propósito: o painel de filtros avançados vai para `sessionStorage` (`ui:/pendencias:filtros-avancados`) e o limite do "carregar mais" continua local — toda troca de busca, filtro ou aba devolve o limite ao inicial. A empresa não tem lista fechada (vem dos dados): nome inexistente cai em "Todas". Listas, ordem e contadores das abas conferidos como idênticos aos da versão anterior em produção.
- **Registro de Recebíveis:** Migrada com `q` e `emp`. O botão "Limpar filtros", que já existia, passou a esvaziar a URL e continua habilitando durante a digitação.
- **Configurações → Usuários:** Migrada com `q`, `perfil` e `origem`. O usuário selecionado no mestre-detalhe continua local: abrir e fechar o modal de alteração de perfil não toca na URL.
- **Fila de impressão:** Migrada com `status`, `urg`, `setor` e `mat`. O atalho de teclado `u` passou a alternar o mesmo filtro do checkbox, gravando na URL numa única atualização. Modo compacto e tela cheia ficaram em `sessionStorage` (`ui:/pedidos/impressao:compacto` e `ui:/pedidos/impressao:tela-cheia`) — a tela cheia agora sobrevive ao F5 dentro da mesma aba, o que antes não acontecia.
- **Configurações → Perfis:** Os grupos recolhidos do catálogo de permissões passaram para `sessionStorage` (`ui:/configuracoes/perfis:grupos-recolhidos`). A tela não tem filtro e não ganhou parâmetro de URL; perfil selecionado e edição de permissões seguem locais.
- **Notas Fiscais:** Migrada com `aba` e dois conjuntos independentes de filtros, `nfe-*` (produto) e `nfse-*` (serviço), que convivem na mesma URL sem se sobrescrever. Trocar de aba continua limpando apenas os filtros de NF-e, como antes. Emissão, cancelamento, carta de correção, histórico e integrações inalterados.
- **Editor de orçamento:** A aba passou a ser sincronizada nos dois sentidos — antes o parâmetro `tab` só era lido no carregamento, e clicar numa aba não mudava o endereço. O nome legado `tab` foi mantido; `resolver-pendencia` segue como comando de uso único, com a mesma leitura e autolimpeza.
- **Padrão / Listagens:** Novo `src/hooks/useSessionState.ts`, para o estado visual que não deve viajar em um link compartilhado (modo compacto, tela cheia, grupos recolhidos). Chave no formato `ui:<rota>:<nome>`; leitura por `useSyncExternalStore`, de modo que servidor e hidratação partem do valor inicial. Já previsto no documento oficial, criado na migração de Expedição.
- **Permissões / Orçamentos:** Nova permissão `propostas.cancelar_cobranca_nao_paga` ("Cancelar Cobrança Não Paga", crítica). Permite ao comercial cancelar cobrança emitida e comprovadamente não paga da **própria** proposta, destravando a edição sem conceder `cobrancas.cancel` (poder financeiro pleno). Nasce **desligada** em todos os perfis — é ligada manualmente em Configurações → Perfis e Permissões. Modo restrito exige: `status = A_RECEBER`, `confirmado = false`, `paid_at` e `data_confirmacao` nulos, nenhum boleto pago vinculado, sem reserva de Conta Corrente, e escopo da proposta aprovado por `verificarEscopoPropostaServerSide`.

### Corrigido
- **Filtros na URL (padrão):** Ao abrir uma tela por um link já filtrado, trocar qualquer filtro não surtia efeito — a URL não mudava e o usuário ficava preso ao estado do link. Causa: em telas com carga de dados, a navegação de `router.replace` era descartada quando a página havia sido aberta direto com parâmetros. A escrita passou a usar `window.history.replaceState` com cópia local da query, dentro do hook compartilhado. Afetava Contas a Receber desde a publicação do piloto. Com a correção, a exceção do parâmetro `autoRegister` deixou de ser necessária e foi removida.
- **Autenticação:** Ao voltar o foco para a janela, o Supabase reemite `SIGNED_IN` e o `AuthProvider` republicava o usuário sem permissões antes do enriquecimento, fazendo o `PermissionGuard` negar o acesso por instantes e desmontar a página — apagando filtros e disparando novos carregamentos. Eventos redundantes do mesmo `user.id` já enriquecido passam a preservar o usuário atual, com reenriquecimento em silêncio. Troca real de usuário mantém o fluxo completo; usuário bloqueado ou sem cadastro continua perdendo o acesso.
- **Cobranças (segurança):** As rotas `cancelar-externo` e `cancelar-boleto` verificavam `paid_at` apenas em `public.boletos`. Agora também bloqueiam quando o próprio registro em `pagamentos_v2` tem `paid_at` ou `data_confirmacao` preenchidos — existiam cobranças com status não-pago e baixa registrada que passariam pelas guardas anteriores.
- **Cobranças (auditoria):** O histórico de cancelamento gravava `autor_nome: "Sistema"` fixo, sem identificar quem cancelou. O registro passou para a rota (server-side), que grava o autor real, o motivo e a permissão usada em `propostas_chat`. Removido o registro duplicado do cliente.
- **Cobranças (permissão):** O botão "Excluir" da aba Pagamentos do orçamento não tinha nenhum gate de permissão — só de estado. Agora exige `cobrancas.cancel` ou `propostas.cancelar_cobranca_nao_paga`, nos layouts desktop e mobile.

### Alterado
- **Menu lateral (Sidebar)**: Reorganização de ordem e agrupamento — Dashboard, Cadastros, Operação, Pedidos, Financeiro, Notas fiscais, Maestro e Configurações. Expedição passou para dentro de Pedidos e Conferência para Operação; "Contas a receber" virou lista plana no Financeiro (Carteira + Registro de recebíveis); Verificação CPF/CNPJ foi para o Financeiro; "Usuários" (em breve) entrou em Configurações. Introduzido o conceito de **seção-link** (`NavigationSection.href`) para itens principais sem acordeão. Rotas, permissões, ícones e responsividade preservados. Documentado em `docs/technical/PADROES-UX-UI.md` §5.
- **Menu lateral (Sidebar)**: A rota ativa passou a ser resolvida pelo href mais específico (`navigationHrefs`), evitando que `/contas-a-receber/registro` destaque também "Carteira".

### Corrigido
- **Orçamentos / aba Produtos**: Os selects de "Configuração de Variações" estavam travados em `disabled={!isSuperAdmin}` (resíduo do bloqueio da 0.2.2). Como as variações obrigatórias nascem vazias, Vendedor, Gerente e Admin ficavam impedidos de salvar o item e a proposta. O gate por cargo foi substituído pela prop semântica `podeEditarVariacoes`, calculada a partir de `isFormBloqueadoPorCobranca` — a mesma condição de edição já usada na aba. Proposta paga, pendência de revisão e avulsa paga continuam bloqueadas; regras de preço, valor fixo, desconto, comissão e aprovação inalteradas.

## [Unreleased] - 2026-07-23

### Alterado
- **Menu lateral (Sidebar)**: Redesenho para o modelo "acordeão por seção" — itens agrupados em quatro seções colapsáveis (Operação, Cadastros, Financeiro, Configurações), com apenas uma aberta por vez, acesso rápido fixo (Orçamentos, Conferência) e modo recolhido em rail de ícones com flyout. Fonte (Inter) e tokens `--sidebar-*` do projeto preservados; permissão da seção Configurações mantida. Documentado em `docs/technical/PADROES-UX-UI.md` §5.

### Adicionado
- **Feature flag `USE_NEW_SIDEBAR`** (`src/constants/featureFlags.ts`): alterna entre o novo menu (`SidebarNav` / `MobileSidebarNav`) e o anterior em lista plana (`Sidebar` / `MobileSidebar`), permitindo reverter sem remover o menu antigo.
- **`navigationSections` e `quickAccessItems`** (`src/constants/navigation.ts`): nova estrutura de dados agrupada, mantendo `navigationItems` intacto.

## [Unreleased] - 2026-07-10

### Corrigido
- **Maestro V2 (Cotações)**: Correção crítica na retenção do bônus do cliente durante a passagem de contexto transicional entre frontend e backend (`ConversationContext`).
- **Maestro V2 (Edição de Cotações)**: Resolvido travamento em que o roteador bloqueava a edição de itens (quantidades e remoções) quando o fluxo já se encontrava na fase de confirmação (`pendingSaveQuotation`).
- **Maestro V2 (Nomenclatura)**: Os produtos do catálogo oficial que antes exibiam descrições desnecessariamente longas agora adotam sua nomenclatura canônica curta (ex: "Pulseira TexBand" em vez da descrição bruta do banco).

### Alterado
- **Maestro V2 (Retenção de Frete)**: A opção "Retira no balcão" agora sobrevive a recálculos automáticos quando a quantidade de um item da cotação é editada pelo usuário durante a confirmação, saltando uma re-escolha desnecessária.
- **Documentação**: Criado arquivo `docs/maestro/STATUS-MAESTRO-V2.md` com um checkpoint resumido e claro do andamento do módulo Maestro V2.

## [Unreleased] - 2026-07-03

### Corrigido
- **Orçamentos**: O botão geral 'Salvar alterações' agora salva o rascunho preenchido na aba 'Artes'.
- **Orçamentos/Artes**: Tornou-se obrigatório informar o 'Nome do Evento / Tema' ao 'Enviar para arte'.

## [0.2.3] - 2026-07-03
### Adicionado
- **Orçamentos:** Adicionado campo `Bloco` (opções fixas e livre) para controle de vias e blocos na aba Pedido.

## [0.2.2] - 2026-07-02
### Adicionado
- **Proposta Avulsa:** Ao marcar a flag avulsa, as abas de Pedido e Artes agora são automaticamente ocultadas e a navegação redirecionada se necessário.
- **Cobranças:** A condição de pagamento escolhida no Faturado (ex: Prazo 7/14/21 dias) agora é salva de forma persistente em `pagamentos_v2.forma_pgto` e registrada no chat/timeline da proposta para histórico.

### Alterado
- **Aba Produtos:** Usuários comuns (não-super_admin) agora podem alterar apenas a quantidade do item no orçamento, tendo bloqueada a edição de valor unitário, fixo, descontos, variações e remoção de itens. O bloco de variações passa a renderizar apenas quando o produto possui variações ativas.
- **Abas do Orçamento:** A aba `Boletim` foi removida da interface do orçamento para simplificação da navegação.

## [0.2.1] - 2026-07-02
### Adicionado
- **Fluxo de Boas-Vindas:** Redirecionamento da confirmação de e-mail e criação de cadastro via `supabase.auth.signUp()` para a nova tela pública `/boas-vindas`, melhorando a UX e esclarecendo a dependência de aprovação administrativa.
- **Auth Modernizado:** O layout da tela de login foi modernizado com branding completo e suporte a provedores OAuth.
- **Login com Google:** Implementação da integração com `signInWithOAuth` e rota de callback segura SSR (App Router).
- **Novo Cadastro:** Tela `/cadastro` disponibilizada utilizando `supabase.auth.signUp()`.
- **Perfil de Acesso Pendente:** Proposta estrutural de banco para automatizar espelhamento de contas (`auth.users` -> `public.usuarios`) através da trigger `handle_new_user` com o perfil padrão de `pendente_aprovacao`. O `AuthGuard` intercepta corretamente esse perfil e mostra mensagem apropriada de acesso pendente.

## [2026-07-02] - Implantação da Matriz de Perfis, Permissões e Escopo V2.1
### Adicionado
- Nova infraestrutura genérica de Escopo de Dados (own, team, company, all), preparada para reutilização futura em todos os módulos.
- Aplicação do primeiro módulo piloto de Escopo em Orçamentos, limitando a visão de propostas ao vendedor autenticado.
- Novas permissões no módulo Cadastros para o bloco "Crédito / Financeiro": `cadastros.view_credito` e `cadastros.edit_credito`.
- Módulo "Banco de Variações" incluído oficialmente na matriz de permissões.

### Alterado
- Editor de Perfis refatorado: reorganização por módulos, adição de botões "Marcar todas" / "Desmarcar", e botão flutuante (sticky) para salvar alterações.
- Interface de permissões limpa: removidas as tags "(Legado V1)" e "[LEGADO]" da matriz, mantendo apenas compatibilidade interna retroativa.

### Corrigido
- Falso positivo de salvamento no Editor de Perfis foi eliminado com a adoção de RPC segura em substituição à permissão de UPDATE direto na tabela `public.perfis`.

## [2026-07-01] - Módulo Fiscal e Prevenção de Build

### Adicionado
- **Fila Faturamento (Módulo Fiscal)**: Consolidação da Fila de Faturamento operando exclusivamente com dados reais da tabela `public.propostas`, filtrando propostas autorizadas via flag `libera_nf = true`. Os mocks foram completamente removidos da fila.
- **Registro de Prevenção de Build**: Documentada a falha de build gerada por imports/exports inválidos em `PedidosListPage.tsx` (que quebrou a rota `/pedidos` e afetou Fiscal/Notas Fiscais). Instituída a regra de validação via `npm run build` para garantir a integridade de rotas antes de pushes.

### Alterado
- **Módulo Contas a Receber**: Renomeadas as labels de previsão financeira de "Próximos 30/90 dias" para "Até 30/90 dias" visando esclarecer o efeito de acumulação a partir da data atual.

## [2026-07-01] - Diagnóstico de Data/Hora na Lista de Orçamentos
### Investigado
- Investigada denúncia de horários idênticos (ex.: `28/06/2026, 21:38`) ao filtrar a lista de Orçamentos por 'Tipo de Cobrança'.
- Comprovado, após extração direta via Supabase, que não se trata de bug no frontend ou no truncamento de timezone, mas da exibição fiel de um evento de `UPDATE` em lote na tabela `public.propostas` (776 registros sofreram alteração no exato minuto 2026-06-29T00:38Z).
- Registrado em documentação (`DECISOES-TECNICAS.md` e `PROXIMOS-PASSOS.md`) a não-alteração do código da UI para evitar mascaramento artificial de dados históricos do banco.

## [2026-06-30] - Refatoração do Módulo de Notas Fiscais
### Adicionado
- Coluna `libera_nf` (boolean) na tabela `public.propostas` para simplificar a esteira fiscal.
- Botão "Liberar para NF" no menu de ações dos Pedidos, visível temporariamente apenas para admins/gerentes.
- Botões separados para "Faturar NF-e (Produto)" e "Faturar NFS-e (Serviço)" no painel de simulação do módulo Fiscal.
- Badge visual "Liberado para NF" no grid de Pedidos (tabela e cards) caso a flag já esteja ativa.

### Alterado
- Fila de Faturamento do módulo Fiscal unificada, passando a listar registros baseados unicamente na flag `libera_nf = true`.
- Abas de Notas Fiscais simplificadas para exibir apenas "Fila Faturamento" e "Histórico NF-e / NFS-e".

## [2026-06-25] - Higienização e Proteção: Módulo Contas a Receber
### Adicionado
- Proteção visual e funcional baseada em permissão (`isAdminOrGerente`) para botões de ações financeiras destrutivas ou de escrita (N8N, exclusão de banco, criação de PDFs de boleto com persistência) na tela de `ContasReceberPage`.
- Suporte para uso de E-mail Fallback customizado e editável (`overrideEmail`) com confirmação de segurança obrigatória na tela `RevisarGeracaoBancariaModal`.
- Alias de retrocompatibilidade para tipos legados do contas a receber em `src/lib/mocks/contas-receber.mock.ts`.

### Removido
- Removidas funções e referências residuais com prefixos de "Mock" da UI (`confirmRecebimento`, `cancelRecebivel`, `prorrogarBoleto`).
- Removidos estados *hardcoded* (`useState("2026-06-04")`) para prevenir conflitos de *Hydration Mismatch*.

### Alterado
- Substituição massiva da estrutura de tipos: de `BoletoDepositoMock` para o tipo condizente com regras de negócio da arquitetura: `RecebimentoOperacional`.
- Usuários comuns agora contam exclusivamente com permissões de acesso "Read-Only" às propostas e clientes no Contas a Receber.

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
  - **Matriz de Segurança**: Registro da liberação controlada de escrita do `UPDATE` em `docs/technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`.
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
  - Criada a documentação consolidada [PERFIS-PERMISSOES.md](../technical/PERFIS-PERMISSOES.md) detalhando o status das fases, limitações de RLS e roadmaps.
  - Atualização dos arquivos [MODULOS-IMPLEMENTADOS.md](./MODULOS-IMPLEMENTADOS.md) e [PROXIMOS-PASSOS.md](./PROXIMOS-PASSOS.md).

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
  - Redesenho completo de `src/features/cobrancas/CobrancaDetail.tsx` adotando padrão administrativo de alta densidade visual (sem KPIs redundantes e sem campos técnicos desnecessários).
  - Implementação de ocultação de checkout para faturados (`E-FATURADO`, `E_FATURADO`, `FATURADO`) normalizando o tipo da cobrança em `src/features/cobrancas/PropostaCobrancaPanel.tsx` e no detalhe.
  - Regra de valor final do cartão (`cartao_valor_final`) aplicada somente quando o tipo for cartão parcelado e o valor for maior que zero, retornando ao valor base (`valor`) nos demais casos.
  - Exibição visual truncada da URL pública de checkout no painel, garantindo que o link original completo seja copiado para a área de transferência.
  - Remoção de atalhos e botões redundantes de conferência financeira no painel de cobranças geradas e nos orçamentos, sem alterar o acesso geral ao painel financeiro.
  - Higienização completa de termos e frases mockadas/simuladas em `src/features/cobrancas/CobrancaDetail.tsx`, `src/features/cobrancas/CobrancaHistoricoPanel.tsx` e `src/features/cobrancas/CobrancaActionsMenu.tsx`.

- **Refinamento de UX de Orçamentos e Propostas (Ressalvas Obrigatórias)**:
  - Componente `src/features/orcamentos/components/ContactEditModal.tsx` para edição estritamente local/em memória de contatos do cliente no formulário, sem chamadas ao Supabase (`public.contatos`).
  - Componente `src/features/orcamentos/components/ProductSearchSelector.tsx` com barra de pesquisa para filtrar o catálogo real (por código, nomeReal e apelidos), barra de tags com categorias dinâmicas e validação de duplicidade antes de adicionar produtos.
  - Atribuição automática do vendedor padrão associado ao cadastro do cliente. Se o cliente não tiver vendedor padrão, o campo fica vazio e um toast operacional alerta o operador. Usuários comuns visualizam o vendedor como somente leitura, enquanto admins/gerentes podem editá-lo.
  - Highlight visual (azul suave) e badge dinâmico ("Endereço de sócio" ou "Endereço de vínculo comercial") para endereços do tipo comprador/parceiro comercial.
  - Renomeada a seção 4 do formulário para "4. Dados de faturamento".
  - Removidos produtos/previews estáticos mockados e select antigo.

## 2026-06-01

### Adicionado
- **Encerramento Técnico Final (Fase 6H)**:
  - Documentação final consolidada em [CHAT-INTERNO.md](../business/CHAT-INTERNO.md) detalhando tabelas, fluxos operacionais, regras de menções/pendências, eventos em tempo real, modelo de segurança (RLS) e roadmaps futuros.
  - Registro de decisões arquiteturais em [DECISOES-TECNICAS.md](./DECISOES-TECNICAS.md) detalhando por que a chave `service_role` não é usada no frontend, por que as pendências têm uma tabela própria e por que a subscrição realtime de pendências foi centralizada no componente Topbar.
  - Atualização geral do progresso em [MODULOS-IMPLEMENTADOS.md](./MODULOS-IMPLEMENTADOS.md).

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
- Criada a matriz viva de segurança de escrita em `docs/technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`, com controle por módulo, tabela, campo, operação, status, risco, validação pós-gravação e fase de liberação.
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

---

# Documentação Relacionada

- `../PROJECT_CONTEXT.md`
- `../SECURITY.md`
- `../BUSINESS_RULES.md`
- `../DEVELOPMENT.md`
- `../technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`
- `./DECISOES-TECNICAS.md`

---

# Fonte da Verdade

Este changelog é um registro histórico.

O comportamento vigente deve ser confirmado no código e nos documentos oficiais de cada domínio.

Entradas antigas podem mencionar mocks, fases transitórias, permissões provisórias ou estruturas posteriormente substituídas.
