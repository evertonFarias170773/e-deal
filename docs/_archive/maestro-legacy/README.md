# Maestro Legacy

Status: Arquivo histórico  
Projeto: Vibe  
Última organização documental: 19/07/2026

---

# Finalidade

Esta pasta preserva documentos das primeiras fases do Maestro.

Eles explicam a evolução do Maestro Simple, a fase Cliente 100%, a antiga matriz de intents, o roadmap inicial e o blueprint técnico anterior ao Maestro V2.

Os arquivos desta pasta não fazem parte da leitura oficial do projeto.

---

# Regra Obrigatória

Não utilizar documentos desta pasta para:

- definir a arquitetura atual;
- declarar uma capacidade como implementada;
- configurar o Router Semântico;
- criar tools;
- autorizar escrita;
- alterar banco, RLS, RPC, trigger ou migration;
- decidir o roadmap atual;
- substituir documentos de `docs/maestro`.

Quando houver conflito, prevalecem:

1. `../../maestro/STATUS-MAESTRO-V2.md`;
2. `../../maestro/MAESTRO-KNOWLEDGE-BASE.md`;
3. `../../maestro/MAESTRO-CATALOGO-CONSULTAS-CLIENTES.md`;
4. `../../maestro/MAESTRO-SEGURANCA-E-GOVERNANCA.md`;
5. `../../maestro/MAESTRO-PROMPT-BASE.md`;
6. código atual e tools homologadas.

---

# Classificação dos Arquivos

| Arquivo | Classificação | Observação |
|---|---|---|
| `MAESTRO-CLIENTE-100.md` | Histórico parcialmente válido | Relações cadastrais continuam úteis, mas a limitação à Fase 1 foi superada. |
| `MAESTRO-CLIENTE-100-PERGUNTAS.md` | Histórico com valor para testes | Frases podem ser reutilizadas como casos de regressão; o modelo antigo de intents não é a arquitetura atual. |
| `MAESTRO-ROADMAP-SIMPLES.md` | Roadmap substituído | Os estados de fase não representam o Maestro V2 atual. |
| `MAESTRO-BLUEPRINT.md` | Blueprint inicial substituído | Princípios de segurança continuam relevantes, mas a estrutura proposta não comprova a implementação real. |

---

# Fonte da Verdade

A documentação oficial do Maestro fica em:

```text
docs/maestro/
```

Esta pasta existe apenas para rastreabilidade histórica.
