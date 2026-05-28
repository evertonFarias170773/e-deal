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
- Revisar com operação o banco global de variações e tipos/modelos disponíveis.
- Criar futuramente em Configurações a manutenção global de `variacoes` e `tipos_variacoes`.
- Validar como `produtos_proposta_variacao` aplicará valor extra e peso na proposta.
- Validar a escrita expandida de valores comerciais, dados fiscais e fotos reais em `public.produtos` e `public.fotosProdutos`.
- Monitorar erros de permissão/RLS na criação, edição e upload de fotos no bucket `e-deal`, pasta `produtos/`.
- Garantir que `DELETE` físico de produto permaneça bloqueado; avaliar apenas inativação controlada em fase própria.
- Definir fase específica para foto principal, edição/exclusão de imagem e manutenção de variações.
- Manter `produtos`, `fotosProdutos`, `produto_variacoes`, `variacoes` e `tipos_variacoes` documentados na matriz de segurança antes de qualquer escrita.

## Orçamentos

- Revisar campos finais com operação comercial.
- Validar responsividade fina da lista, detalhe, nova proposta e edição em dispositivos reais.
- Revisar regras de cálculo de produtos, variações, desconto, frete e total antes de conectar Supabase.
- Validar permissões reais para troca de vendedor, desconto geral e alteração de condições comerciais.
- Definir origem oficial do bônus/tabela especial do cliente e como será aplicado nos cálculos reais.
- Definir regra real para recotação de frete quando peso, produtos ou endereço forem alterados.
- Preparar futuro service de Propostas para Supabase.
- Integrar futuramente `propostas`, `produtos_proposta`, `produtos_proposta_variacao`, `cotacao_frete`, `desconto_proposta` e `pagamentos_v2`.
- Implementar PDF real apenas com backend/Edge Function segura.
- Implementar geração real de cobrança no módulo Cobranças/Pagamentos.
- Revisar a matriz viva antes de liberar qualquer campo textual, item de proposta ou frete.

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
- Preparar futuro service de Financeiro para Supabase.
- Integrar futuramente `pagamentos_v2`, `boletos`, `propostas_chat` e análise real de crédito.
- Substituir URLs, PDFs, checkout e PIX fictícios por backend/Edge Function segura.

## Fiscal

- Criar telas mockadas de NF-e e NFS-e.
- Representar status, validações, documentos, DANFE/DANFSE e XML.

## Integração futura

- Conectar Supabase apenas depois da aprovação visual.
- Integrar módulo por módulo.
- Não criar migrations sem análise.
- Não alterar schema sem revisão.
- Revisar RLS, RPCs, Edge Functions e integrações existentes antes de qualquer mudança real.
- Atualizar `docs/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md` sempre que uma fase de escrita avançar.
