# Arquivo histórico — Maestro

Documentos movidos de `docs/maestro/` em **26/07/2026** durante a
reorganização da documentação do Maestro V2.

**Nada aqui descreve o estado atual.** A fonte vigente é
`docs/maestro/STATUS-MAESTRO-AGENT-LOOP.md` (estado/capacidades) e
`docs/maestro/MATRIZ-PERMISSOES-ESCRITA-MAESTRO.md` (escrita e princípios
permanentes de negócio).

| Arquivo | O que era | Por que foi arquivado |
|---|---|---|
| `STATUS-MAESTRO-V2.md` | Status do motor simples/legado (router, estado conversacional, save de cotação) até 22/07/2026 | Desatualizado: afirma migrations de persistência/auditoria "não aplicadas" (foram aplicadas em 25/07) e não cobre o agent loop, que passou a ser o motor de leitura |
| `MAESTRO-CATALOGO-CONSULTAS-CLIENTES.md` | Catálogo de consultas autorizadas da era pré-agent-loop | Superseded: o catálogo real são as 23 tools do agent loop, documentadas no STATUS vigente |
| `MAESTRO-FASE-2-PEDIDOS-FINANCEIRO.md` | Registro de implementação da "Fase 2" (adapters de consultas por cliente) | Registro histórico de implementação; os adapters continuam no código, mas o documento não reflete as capacidades atuais |

O legado mais antigo do Maestro (anterior a estes) permanece em
`docs/_archive/maestro-legacy/`.
