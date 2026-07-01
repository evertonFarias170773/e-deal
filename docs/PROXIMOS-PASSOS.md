### PENDÊNCIA TÉCNICA: Permissões Granulares Financeiras
**Módulo:** Contas a Receber & Conferência de Pagamentos
**Descrição:** O sistema atualmente emprega um bloqueio macro baseado em perfis super-admin (`user?.isSuperAdmin || user?.isAdmin`) para segregação de privilégios de botões que afetam a base `public.boletos`. Assim que o módulo de Autorizações de API de escopo real for implementado globalmente, deve-se adotar checadores do tipo `hasPermissoes(["FINANCEIRO_ESCRITA", "FINANCEIRO_BOLETOS"])` para os botões do `ContasReceberPage.tsx`.

# Próximos Passos

## Cadastros

- Revisar campos finais com a operação.
- Ajustar máscaras visuais de telefone, CEP e documentos se necessário.
- Validar responsividade fina em dispositivos reais com operador.
- Coletar feedback sobre campos obrigatórios, endereços, contatos e vínculos comerciais.
- Avaliar com cautela a próxima etapa de escrita real, começando por `UPDATE` controlado.
- Validar RLS, confirmação explícita antes de gravar e mensagens de erro antes de qualquer persistência.
- Preparar futuro service de Cadastros para escrita real apenas após aprovação.
- Expandir a escrita real com o mesmo nível de controle, sem liberar `enderecos`, `contatos` ou `clientes_socios` antes da validação específica de cada tabela.
- Definir o próximo lote de campos de `clientes` somente depois de validar o smoke test de `obs`.
- Manter a matriz viva de segurança atualizada a cada nova liberação de campo.
- Planejar a próxima fase de `UPDATE` controlado com validação pós-gravação documentada.

## Produtos

- Revisar campos finais com a operação comercial e produção.
- Validar responsividade fina da lista, detalhe, novo produto e edição em dispositivos reais.
- Ajustar máscaras visuais de valores, peso e prazo se necessário.
- Definir permissões futuras para custo interno, preço, prazo e inativação.
- Validar como `produtos_proposta_variacao` aplicará valor extra e peso na proposta (snapshot estático).
- Validar a escrita expandida de valores comerciais, dados fiscais e fotos reais em `public.produtos` e `public.fotosProdutos`.
- Monitorar erros de permissão/RLS na criação, edição e upload de fotos no bucket `e-deal`, pasta `produtos/`.
- Garantir que `DELETE` físico de produto permaneça bloqueado; avaliar apenas inativação controlada em fase própria.
- Definir fase específica para foto principal e edição/exclusão de imagem.
- Planejar a implementação de ordenação manual de opções (coluna `ordem` em `tipos_variacoes` no banco).
- Planejar a integração do Banco de Variações com o Maestro (camada de produção).
- Manter `produtos`, `fotosProdutos`, `produto_variacoes`, `variacoes` e `tipos_variacoes` documentados na matriz de segurança.

## Orçamentos

- [x] Exibir skeletons de loading na listagem principal de orçamentos e cards de resumo superior.
- [x] Ocultar a exibição prematura de dados mockados locais antes da resposta real do Supabase.
- [x] Exibir aviso claro e destacado no rodapé caso a busca no Supabase falhe e ative o fallback.
- Validar com a operação comercial o fluxo integrado de criação e edição real de propostas no Supabase.
- Validar responsividade fina da lista, detalhe, nova proposta e edição em dispositivos reais.
- Homologar as regras de cálculo e arredondamento de produtos, descontos, variações e frete no Supabase.
- Validar permissões reais para troca de vendedor, desconto geral e alteração de condições comerciais.
- Definir origem oficial do bônus/tabela especial do cliente e como será aplicado nos cálculos reais.
- Definir regra real para recotação de frete quando peso, produtos ou endereço forem alterados.
- Homologar e expandir o uso real e recálculos automáticos nas tabelas `cotacao_frete` e `desconto_proposta` integradas ao Supabase.
- Implementar PDF real com backend/Edge Function segura.
- Conectar a geração real de cobranças no módulo Cobranças/Pagamentos com as propostas do Supabase (reutilizando a escrita ativa de `pagamentos_v2`).
- Revisar a matriz viva antes de liberar novos campos de propostas ou tabelas relacionadas.

## Centralização de Status (Fase 4B)
- A Fase 4A.1 (Preparação da Malha Receptora) foi homologada e concluída. A Fase 4B foi **formalmente pausada**.
- Prioridade atual volta para os demais módulos pendentes do ERP (ex: Produção, Fiscal, Expedição).
- O status atual do sistema está preparado visualmente e operacionalmente para a evolução dos novos compostos.
- Qualquer automação ou retomada da Fase 4B precisará de nova matriz formal, feature flag e aprovação explícita.

## Expedição
- **Fase 1A concluída:** Módulo dedicado criado (`src/features/expedicao`), unindo leitura real de `propostas`, `pedidos` (legados) e `cotacao_frete`.
- Foram desativados os mocks visuais baseados em `id_int % 3` e substituídos por regras de frete e rastreio reais (apenas leitura).
- Pendências para **Fase 1B**:
  - Implementar escrita real do código de rastreamento em `public.pedidos`.
  - Implementar ação oficial de "Despachar", gerando log no Chat (`propostas_chat`).
  - Implementar ações para "Marcar como Entregue" e "A Retirar".
  - Reforçar que a mudança de `status_interno` automatizada (dependente da Fase 4B) continua pausada e será pensada depois ou substituída por fluxos manuais com feature flags.
## Financeiro e cobranças

- Validar com o financeiro os filtros, cards e agrupamentos da primeira entrega de Contas a Receber.
- Validar se `A_RECEBER` deve aparecer futuramente em uma aba separada de `Cobranças pendentes` ou seguir somente no Módulo Cobranças.
- Validar regra oficial de fechamento do mês para cartões, faturados e depósitos futuros.
- Revisar responsividade fina de `/contas-a-receber` em dispositivos reais, especialmente cards mobile e menus de ações.
- Definir detalhe futuro de recebível, boleto, depósito e previsão antes da integração real.
- Definir regras oficiais de conciliação, baixa parcial, juros, multa, prorrogação e cancelamento em Contas a Receber.
- Preparar futuro service de Contas a Receber para Supabase, mantendo criação e conferência de cobrança no Módulo 08.
- Validar com o financeiro a nomenclatura final do estado `Pronta para liberar` antes da integração real com pedidos.
- Validar com operação se o modal simplificado de criação precisa de ação futura de `Salvar rascunho` antes da integração real.
- Revisar se todas as entradas de `Gerar cobrança` no fluxo de orçamentos abrem diretamente o modal simplificado no contexto da proposta.
- Validar em dispositivos reais a navegação mobile da lista de conferência com múltiplas cobranças por proposta e menus de ação abertos.
- Revisar com usuários se o bloco-resumo da proposta deve exibir totais por status além de `valor já cobrado` e `saldo restante`.
- Validar com operação financeira os campos realmente obrigatórios na criação de cobrança.
- Validar com operação se `os_ideal` continuará obrigatório em todos os cenários enquanto o legado estiver em paralelo.
- Revisar responsividade fina da lista, detalhe, criação e página pública mockada.
- Definir regra real de liberação da proposta quando houver múltiplas cobranças para o mesmo `id_int`.
- Definir regras reais de disponibilidade por empresa para boleto, cartão e faturado.
- Definir comportamento oficial de parcial, atraso, renegociação, baixa manual e cancelamento.
- Preparar futuro service de Financeiro para Supabase, aproveitando a integração inicial de PIX ativo.
- Integrar futuramente boletos, propostas_chat, análise real de crédito e outras formas de pagamento na tabela `pagamentos_v2` (que já possui PIX real ativo para a empresa 1).
- Substituir URLs, PDFs, checkout e fluxos fictícios por backend/Edge Function segura.

## Fiscal

- Criar telas mockadas de NF-e e NFS-e.
- Representar status, validações, documentos, DANFE/DANFSE e XML.

## Perfis e Permissões

- **Fase 5 — RLS Operacional de Bancos de Dados (Segurança Profunda)**:
  - Criar política controlada de `UPDATE` para a tabela `public.perfis` no Supabase para liberar o salvamento real das permissões modificadas no painel.
  - Implementar políticas de Row-Level Security (RLS) granulares associadas às permissões do catálogo.
  - Desenvolver e homologar as políticas de RLS tabela por tabela (`public.propostas`, `public.clientes`, `public.cobrancas`, etc.) em ambiente de testes para evitar travar as escritas e leituras do ERP de produção.
  - Avaliar o impacto das novas políticas contra integrações externas (FlutterFlow, n8n) que acessam o banco diretamente.

## Integração futura


- Conectar Supabase apenas depois da aprovação visual.
- Integrar módulo por módulo.
- Não criar migrations sem análise.
- Não alterar schema sem revisão.
- Revisar RLS, RPCs, Edge Functions e integrações existentes antes de qualquer mudança real.
- Atualizar `docs/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md` sempre que uma fase de escrita avançar.

## Pedidos / OS Operacional

- Diagnóstico próprio para escopo de Boletim/OS e como separar efetivamente o que é metadado do negócio do que é metadado de máquina (Ficha Técnica).
- Diagnóstico próprio para a eventual renomeação conceitual de `public.pedidos` para algo mais alinhado à nova arquitetura, como `pedidos_boletim`.
- Reestruturação futura do **Kanban** para seguir o novo conceito de fila operacional baseada em `public.propostas`.
- Reestruturação futura da **Fila de Impressão** para refletir os mesmos conceitos unificados.
- Fase 4B de automação de status de produção segue estritamente suspensa até nova liberação estratégica.


## Módulo Fiscal e Pedidos (Pendências)
- [ ] Criar permissão granular fiscal (ex: `pode_liberar_nf`) para substituir o bloqueio temporário atual (`user?.isSuperAdmin || user?.isAdmin`) na ação "Liberar para NF".
- [ ] Avaliar se após a emissão com sucesso (NF-e ou NFS-e), a flag `libera_nf` deve retornar para `false` ou se criaremos uma nova coluna de controle fiscal definitivo.
- [ ] No Histórico unificado (NF-e / NFS-e), adicionar futuramente um identificador visual discreto (ex: badge, ícone ou cor suave) para diferenciar rapidamente notas de produto das de serviço.


### PENDÊNCIA TÉCNICA: Módulo Fiscal / Notas Fiscais
**Módulo:** Notas Fiscais & Faturamento
**Descrição:**
- Definir o ciclo de vida da flag `libera_nf` (se ela deve voltar para `false` após a emissão concluída ou se um novo status cobrirá o encerramento).
- Criar controle fiscal mais robusto (caso haja emissão parcial ou cancelamentos).
- Adicionar identificador visual claro no histórico separando NF-e (Produto) e NFS-e (Serviço).
- Substituir o uso de `user?.isSuperAdmin || user?.isAdmin` por permissões granulares fiscais específicas.
- Avaliar a integração real do histórico fiscal assim que os endpoints ou tabelas de resposta da Sefaz/Prefeitura estiverem modelados.

### PENDÊNCIA TÉCNICA: Validação de Build (Prevenção)
**Módulo:** Global / Rotas Compartilhadas
**Descrição:** Após alterações em módulos compartilhados (Pedidos, Orçamentos, Fiscal, Financeiro), é obrigatória a execução de `npm run build` localmente antes de enviar para produção. O comando `npx tsc --noEmit` não substitui o build completo da Vercel/Next.js, visto que não detecta falhas de SSR e page rendering causadas por falha de exportação em subcomponentes.
