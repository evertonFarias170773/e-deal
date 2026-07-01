# Diagnóstico: Exclusão de Modelos em `pedidos_modelos`

Realizei a análise completa da arquitetura da aba "Pedido" e do fluxo de salvamento de orçamentos, sem alterar código ou banco de dados.

## 1. Arquivos Envolvidos e Componentes
- **UI da aba Pedido:** `src/features/orcamentos/components/PedidoModelosTab.tsx`
- **Card de edição de cada modelo:** `ModeloInlineCard` (dentro de `PedidoModelosTab.tsx`)
- **Service dos modelos:** `src/features/orcamentos/services/pedidos-modelos.service.ts`
- **Service da Proposta Geral:** `src/features/orcamentos/services/orcamentos.service.ts` (função `saveProposta`)

## 2. Função de Exclusão (Lixeira)
Ao clicar no ícone de exclusão e confirmar no modal, a função chamada é `handleDeleteConfirm()` no `PedidoModelosTab.tsx`. 
Ela executa `excluirModelo(id)` importada do `pedidos-modelos.service.ts`, que faz um `DELETE` físico:
```typescript
const { error } = await client.from("pedidos_modelos").delete().eq("id", id);
```

## 3. Comportamento do Estado vs Banco
A exclusão no frontend tenta ser persistida na hora (física).
Se o Supabase não retornar `error`, o frontend assume sucesso, exibe o toast "Modelo removido com sucesso" e remove o modelo do estado local via `.filter(m => m.id !== id)`. Não existe array de "lixeira" (como `deletedModels`).

## 4. O Fluxo do `saveProposta()`
Aqui reside a principal falha arquitetural identificada:
O `saveProposta()` varre a array atual do estado e faz apenas o **INSERT** de novos modelos (`!isPersisted`).
Ele **NÃO DELETA** modelos. Se o usuário remover um **Produto** na aba "Geral" da proposta, o `saveProposta()` faz o DELETE do produto em `produtos_proposta`, mas **esquece de deletar os modelos correspondentes** em `pedidos_modelos`.

## 5. Causa Raiz do "Some da tela, mas fica no banco"
Existem duas causas atuando no sistema que geram esse comportamento:

### Causa Principal: Produtos Órfãos (Aba Geral)
Quando o usuário exclui um produto do orçamento e salva:
1. O produto é apagado do banco (`produtos_proposta`).
2. Os modelos daquele produto **continuam intactos** em `pedidos_modelos` (pois não há `ON DELETE CASCADE` configurado no Supabase para essa relação).
3. Ao recarregar a aba "Pedido", o `loadModelos` busca todos os modelos do `id_int`.
4. No entanto, o React só desenha modelos que pertencem a produtos ativos (`itens.map`). Como o produto pai não existe mais, os modelos ficam escondidos/invisíveis na interface. Eles sumiram "visualmente", mas continuam no banco.

### Causa Secundária: RLS Silencioso na Lixeira
Se o usuário clicar na Lixeira do modelo e o modelo continuar no banco, isso ocorre devido à arquitetura de segurança do PostgreSQL (RLS). Se a tabela `pedidos_modelos` tiver RLS ativado, mas **não possuir uma política (Policy) de DELETE** para o usuário logado, o comando `.delete()` falha silenciosamente. O Supabase retorna HTTP 204 (Sucesso) com 0 linhas afetadas e `error = null`. Como não há erro, a UI acha que excluiu e tira o modelo da tela. (Neste caso, ao dar F5, o modelo reapareceria).

## Respostas Rápidas ao Checklist:
- **Tem bloqueio por cobrança?** O `saveProposta` em si não é bloqueado por pagamento diretamente na exclusão. O bloqueio ocorreria antes, na validação global da proposta.
- **Tem FK com `pedidos_artes` segurando?** Não. `pedidos_artes` é linkada por `id_int` (proposta), não pelo `id` do modelo.
- **Tem FK restritiva no banco?** Não. Testes provam que é possível inserir/deletar chaves arbitrárias sem o Postgres gritar erro de FK 23503.
- **Botão exige confirmação?** Sim, o modal já existe e abre pedindo confirmação.
- **Tem chave primária para excluir?** Sim, usa `.eq("id", id)`, não usa composição de nomes.

## Recomendação de Correção Segura
A correção exigirá sincronização de diff (exclusão física) para manter o banco limpo. Como não podemos confiar na integridade referencial do banco no momento, a solução via código é a mais segura.

**Fase de Implementação sugerida (quando autorizada):**
1. Modificar o `saveProposta()` no `orcamentos.service.ts` para capturar os IDs dos modelos que sobraram no formulário e executar uma limpeza nos órfãos:
   `DELETE FROM pedidos_modelos WHERE id_int = X AND id NOT IN (lista_ids_ativos)`
2. Adicionar uma validação em `excluirModelo()` para verificar a contagem de linhas afetadas (ou usar uma rota API em `server-side`) se o RLS estiver de fato bloqueando as deleções da Lixeira. 

Não realizei nenhuma alteração no código ou banco. Aguardo seu aval para iniciarmos a correção.
