# MIGRATIONS.md

Versão: 1.0  
Status: Histórico e propostas de banco  
Última atualização: 18/07/2026  
Projeto: Vibe

---

# Arquivos de Migration

Esta pasta preserva scripts SQL criados durante diferentes fases do Vibe.

A presença de um arquivo não comprova que ele foi aplicado.

Antes de usar qualquer script:

1. confirmar o schema atual;
2. verificar se a alteração já existe;
3. revisar dependências;
4. revisar RLS, triggers, views, RPCs e constraints;
5. **conferir GRANTS DE COLUNA quando a migration criar coluna** — ver abaixo;
6. executar primeiro consultas de diagnóstico;
7. preparar rollback;
8. obter autorização explícita do Everton;
9. nunca aplicar automaticamente em produção.

## Coluna nova em tabela com grant por coluna

Nem toda tabela concede privilégio no nível da tabela. Hoje `public.pagamentos_v2` concede **por coluna**, desde `20260721_conta_corrente_fase1a_aditiva.sql`, que revogou o grant de tabela de propósito para fechar cinco colunas sensíveis.

Nessas tabelas, **coluna nova nasce sem privilégio nenhum**. Nada quebra enquanto o código não a mencionar; no dia em que um `INSERT` passar a incluí-la, ele falha inteiro com `permission denied for table`, mesmo enviando nulo. Aconteceu em 28/08/2026 e parou a criação de cobrança em produção.

A migration que cria a coluna deve emitir o grant no mesmo arquivo:

```sql
GRANT INSERT (nome_da_coluna), UPDATE (nome_da_coluna)
  ON public.<tabela> TO authenticated;
```

Duas armadilhas conhecidas:

- **`REVOKE` de tabela apaga os grants de coluna.** Nunca use para "limpar" privilégio nessas tabelas — só `GRANT` de coluna.
- **`information_schema.column_privileges` não serve para inspecionar.** Ela filtra pelo usuário da conexão e não mostra grants de outros papéis, voltando vazia. Use `pg_attribute.attacl`.

Regra completa, com as consultas de verificação: `docs/technical/MATRIZ-SEGURANCA-ESCRITA-SUPABASE.md`.

---

# Inventário

| Arquivo | Natureza registrada |
|---|---|
| `20260613_create_producao_artes.sql` | Criação de estruturas de modelos e artes; confirmar aplicação e schema atual |
| `20260614_add_gabarito_setor_pcp.sql` | Alteração estrutural em Produção; confirmar aplicação |
| `20260614_add_produtos_producao_fields.sql` | Campos produtivos em Produtos; confirmar aplicação |
| `20260627_add_id_contato.sql` | Coluna em Propostas; confirmar aplicação |
| `20260702_auth_trigger_proposal.sql` | Proposta não aplicada, conforme comentário do próprio arquivo |
| `20260702_pagamentos_v2_id_modelo_cobranca.sql` | Proposta de migration; **superada** — a coluna foi criada em 28/08/2026 por `supabase/migrations/20260828_pagamentos_v2_id_modelo_cobranca.sql`, com `ON DELETE RESTRICT` (esta propunha `SET NULL`). Não aplicar: recriaria a coluna e a FK com outro nome |
| `20260703_pedidos_modelos_bloco.sql` | Alteração estrutural em modelos; confirmar aplicação |

---

# Regras

- não executar scripts em lote;
- não assumir idempotência apenas por existir `IF NOT EXISTS`;
- não usar estes arquivos para contornar a Matriz de Segurança;
- não editar produção sem backup e rollback;
- registrar no changelog quando uma migration for aplicada;
- atualizar a documentação do domínio após confirmação.

---

# Fonte da Verdade

O banco atual e o histórico real de migrations aplicadas são a fonte de verdade.

Esta pasta é apenas um registro documental e não constitui autorização de execução.
