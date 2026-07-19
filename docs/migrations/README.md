# MIGRATIONS.md

Versão: 1.0  
Status: Histórico e propostas de banco  
Última atualização: 18/07/2026  
Projeto: ERP Ideal

---

# Arquivos de Migration

Esta pasta preserva scripts SQL criados durante diferentes fases do ERP Ideal.

A presença de um arquivo não comprova que ele foi aplicado.

Antes de usar qualquer script:

1. confirmar o schema atual;
2. verificar se a alteração já existe;
3. revisar dependências;
4. revisar RLS, triggers, views, RPCs e constraints;
5. executar primeiro consultas de diagnóstico;
6. preparar rollback;
7. obter autorização explícita do Everton;
8. nunca aplicar automaticamente em produção.

---

# Inventário

| Arquivo | Natureza registrada |
|---|---|
| `20260613_create_producao_artes.sql` | Criação de estruturas de modelos e artes; confirmar aplicação e schema atual |
| `20260614_add_gabarito_setor_pcp.sql` | Alteração estrutural em Produção; confirmar aplicação |
| `20260614_add_produtos_producao_fields.sql` | Campos produtivos em Produtos; confirmar aplicação |
| `20260627_add_id_contato.sql` | Coluna em Propostas; confirmar aplicação |
| `20260702_auth_trigger_proposal.sql` | Proposta não aplicada, conforme comentário do próprio arquivo |
| `20260702_pagamentos_v2_id_modelo_cobranca.sql` | Proposta de migration; não aplicar automaticamente |
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
