# Matriz de Segurança de Escrita no Supabase

Documento vivo para controlar o que está `LIBERADO`, `BLOQUEADO`, `FUTURO` ou `EM TESTE` no caminho de escrita real do ERP Ideal.

> Atualize este arquivo sempre que uma nova fase de escrita for validada.

## Convenções

- `READ`: leitura disponível no app.
- `UPDATE`: alteração pontual de campos existentes.
- `INSERT`: criação de novos registros.
- `DELETE`: remoção física.
- `LIBERADO`: já validado e em uso.
- `BLOQUEADO`: explicitamente proibido nesta fase.
- `FUTURO`: planejado para próximas fases, ainda não habilitado.
- `EM TESTE`: em validação controlada, com escopo reduzido.

## Cadastros

| Tabela | Campo | Operações | Status | Motivo da decisão | Risco | Validação pós-gravação | Data/fase da liberação | Observações técnicas |
|---|---|---|---|---|---|---|---|---|
| `public.clientes` | Campos cadastrais, fiscais, crédito e observações em whitelist da tela de cadastro | `READ`, `INSERT`, `UPDATE` | `LIBERADO` | Escrita real expandida para criação e edição completa no módulo Cadastros, mantendo whitelist explícita e bloqueio de `id_cliente` em edição. | Médio/alto | `select id_cliente, nome, documento, categoria, nome_vendedor, tipo_pessoa, limite_credito, credito from public.clientes where id_cliente = :id_cliente;` | `2026-05-27` / Fase 2 | `DELETE` permanece bloqueado. `id_cliente` é obrigatório no `INSERT` e somente leitura no `UPDATE`. |
| `public.clientes` | Demais campos cadastrais, fiscais, crédito, risco, auditoria, `apelido`, endereços, contatos e vínculos | `READ` | `LIBERADO` | A leitura já está em uso; escrita continua travada para campos fora da whitelist operacional. | Médio/alto | `select * from public.clientes where id_cliente = :id_cliente;` | `2026-05-23` / Base read-only | Inclui campos não validados para escrita e relacionamentos que continuam sem `UPDATE`, `INSERT` ou `DELETE`. |
| `public.clientes` | Demais campos cadastrais, fiscais, crédito, risco, auditoria, `apelido`, endereços, contatos e vínculos | `UPDATE`, `INSERT`, `DELETE` | `BLOQUEADO` | Não faz parte da fase validada. Campos sensíveis e relacionamentos continuam travados. | Alto/Crítico | Conferência somente leitura antes e depois. | Permanente nesta fase | Liberar por campo apenas após validação específica e nova decisão explícita. |
| `public.clientes` | Qualquer campo | `DELETE` | `BLOQUEADO` | Remoção física não é permitida nesta etapa do projeto. | Crítico | Não aplicável. | Permanente | Mantido bloqueado por regra de segurança do projeto. |
| `public.enderecos` | Campos operacionais de endereço | `READ` | `LIBERADO` | A leitura já é usada no detalhe de cadastro e na proposta. | Baixo | `select * from public.enderecos where id_cliente = :id_cliente order by id;` | `2026-05-23` / Read-only | Inclui CEP, logradouro, número, complemento, bairro, cidade, UF e tipo. |
| `public.enderecos` | Campos operacionais de endereço em whitelist (`id_cliente`, `cep`, `endereco`, `numero`, `complemento`, `bairro`, `cidade`, `uf`, `tipo_endereco`, `obs`, `Latitude`, `longitude`, `distancia`) | `READ`, `INSERT`, `UPDATE` | `LIBERADO` | Escrita real liberada no fluxo de criação e edição de cadastro com distinção entre registros existentes (`UPDATE`) e novos (`INSERT`). | Médio | `select id, id_cliente, cep, endereco, numero, cidade, uf, tipo_endereco from public.enderecos where id_cliente = :id_cliente order by id;` | `2026-05-27` / Fase 2 | Não há remoção física nesta fase. |
| `public.enderecos` | Qualquer campo | `DELETE` | `BLOQUEADO` | Apagar endereço pode quebrar NF, proposta e entrega. | Alto | Não aplicável. | Permanente | Só considerar soft delete se houver decisão específica. |
| `public.clientes_socios` | Campos de vínculo comercial | `READ` | `LIBERADO` | Usado para vínculos e autorizados nas telas de detalhe e proposta. | Baixo | `select * from public.clientes_socios where id_cliente_principal = :id_cliente or id_cliente_socio = :id_cliente;` | `2026-05-23` / Read-only | Representa vínculos comerciais, não apenas sócios. |
| `public.clientes_socios` | Campos de vínculo comercial (`id_cliente_principal`, `id_cliente_socio`, `tipo_relacao`) | `READ`, `INSERT`, `UPDATE` | `LIBERADO` | Vínculos comerciais internos liberados para criação e edição com busca de cadastro existente e bloqueio de auto-vínculo/duplicidade na UI. | Médio/alto | `select id, id_cliente_principal, id_cliente_socio, tipo_relacao from public.clientes_socios where id_cliente_principal = :id_cliente;` | `2026-05-27` / Fase 2 | Sócios fiscais externos (API CNPJ) continuam fora desta tabela. |
| `public.clientes_socios` | Qualquer campo | `DELETE` | `BLOQUEADO` | Remover vínculo pode quebrar histórico comercial. | Alto | Não aplicável. | Permanente | Manter bloqueado até decisão explícita. |
| `public.contatos` | Qualquer campo | `READ` | `LIBERADO` | A leitura já é usada no detalhe e na proposta. | Baixo | `select * from public.contatos where id_cliente = :id_cliente;` | `2026-05-23` / Read-only | Tabela depende de `authenticated` real para escrita. |
| `public.contatos` | Campos em whitelist (`id_cliente`, `nome_contato`, `cargo`, `whats`, `e_mail`) | `READ`, `INSERT`, `UPDATE` | `LIBERADO` | Fluxo de cadastro passou a salvar contatos com whitelist e validação de `nome_contato` obrigatório para registros adicionados. | Alto | `select id, id_cliente, nome_contato, cargo, whats, e_mail from public.contatos where id_cliente = :id_cliente;` | `2026-05-27` / Fase 2 | Em caso de bloqueio de permissão/RLS, cliente principal não é desfeito e a UI informa falha parcial. |
| `public.contatos` | Qualquer campo | `DELETE` | `BLOQUEADO` | Remoção física permanece proibida nesta etapa. | Alto | Não aplicável. | Permanente | Exclusão continua fora de escopo. |

## Produtos

| Tabela | Campo | Operações | Status | Motivo da decisão | Risco | Validação pós-gravação | Data/fase da liberação | Observações técnicas |
|---|---|---|---|---|---|---|---|---|
| `public.produtos` | Campos descritivos e operacionais | `READ` | `FUTURO` | A leitura ainda está em planejamento de integração Supabase para este módulo. | Baixo | `select id_produto, nomeReal, formato, descricao, personalizacao, apelidos, ativo, is_estoque, is_variacao from public.produtos where id_produto = :id_produto;` | `2026-05-23` / Planejamento | Base para catálogo, Maestro e propostas. |
| `public.produtos` | Nome, formato, descrição, personalização, apelidos, ativo, estoque, variação, frase consultiva | `UPDATE` | `FUTURO` | Primeiro lote de escrita deve ser apenas descritivo/operacional. | Médio | Conferir leitura do catálogo e impacto visual no produto. | Futuro / Fase 3 | Não mexer em preço, custo, peso, prazo ou fiscal. |
| `public.produtos` | Preço, custo, peso, prazo, NCM, CFOP, ICMS, PIS, COFINS e demais fiscais | `UPDATE` | `BLOQUEADO` | Campos com impacto comercial/fiscal e possível recálculo em cascata. | Alto | Somente leitura comparativa. | Permanente nesta etapa | Bloqueado até fase sensível própria. |
| `public.produtos` | Qualquer campo | `INSERT` | `FUTURO` | Deve ocorrer só após o UPDATE descritivo estar estável. | Médio | Leitura do item criado no catálogo. | Futuro / Fase 4 | Criar somente quando as regras de catálogo estiverem fechadas. |
| `public.produtos` | Qualquer campo | `DELETE` | `BLOQUEADO` | Risco operacional alto para catálogo usado por propostas. | Crítico | Não aplicável. | Permanente | Manter bloqueado. |
| `public.fotosProdutos` | URL, nome da foto, principal | `READ` | `FUTURO` | Ainda depende da etapa de integração do catálogo e da estratégia de mídia. | Baixo/médio | `select * from "fotosProdutos" where "idProduto" = :id_produto;` | Futuro | Tabela de apoio visual do produto. |
| `public.fotosProdutos` | URL, nome da foto, principal | `UPDATE`, `INSERT` | `FUTURO` | Só depois de validar atualização do produto principal. | Baixo/médio | Conferir galeria na tela do produto. | Futuro | Não mexer em lógica de armazenamento ainda. |
| `public.fotosProdutos` | Qualquer campo | `DELETE` | `BLOQUEADO` | Remoção pode quebrar galeria visual e histórico. | Médio | Não aplicável. | Permanente nesta etapa | Bloqueio inicial por segurança. |
| `public.produto_variacoes` | Vínculo de variação e flags | `READ` | `FUTURO` | Depende da fase de catálogo e do vínculo de produto. | Médio | `select * from public.produto_variacoes where id_produto = :id_produto;` | Futuro | Impacta o que a proposta consegue escolher. |
| `public.produto_variacoes` | Vínculo de variação e flags | `UPDATE`, `INSERT` | `FUTURO` | Requer validação de recálculo e de impacto operacional. | Alto | Conferir vínculo, opções e disponibilidade no produto. | Futuro | Só depois do produto principal. |
| `public.produto_variacoes` | Qualquer campo | `DELETE` | `BLOQUEADO` | Pode desconfigurar opções de venda. | Alto | Não aplicável. | Permanente nesta etapa | Manter bloqueado até decisão explícita. |
| `public.variacoes` | Catálogo global de variações | `READ` | `FUTURO` | Leitura existe como apoio de catálogo, mas escrita ainda não está liberada. | Baixo | `select * from public.variacoes where is_ativo = true;` | Futuro | Catálogo global compartilhado. |
| `public.variacoes` | Qualquer campo | `UPDATE`, `INSERT`, `DELETE` | `BLOQUEADO` | É catálogo global e pode impactar vários módulos ao mesmo tempo. | Alto | Não aplicável nesta fase. | Permanente por enquanto | Tratar em fase própria de manutenção global. |
| `public.tipos_variacoes` | Catálogo global de tipos/opções | `READ` | `FUTURO` | Usado para compor escolhas de variações. | Baixo | `select * from public.tipos_variacoes where is_ativo = true;` | Futuro | Fonte de opções e possíveis acréscimos/pesos. |
| `public.tipos_variacoes` | Qualquer campo | `UPDATE`, `INSERT`, `DELETE` | `BLOQUEADO` | Alteração afeta o catálogo global e pode gerar inconsistência em massa. | Alto | Não aplicável. | Permanente por enquanto | Manter como somente leitura até revisão específica. |

## Propostas

| Tabela | Campo | Operações | Status | Motivo da decisão | Risco | Validação pós-gravação | Data/fase da liberação | Observações técnicas |
|---|---|---|---|---|---|---|---|---|
| `public.propostas` | `texto_whatsapp`, `obs_proposta` | `READ` | `FUTURO` | Leitura será conectada quando o módulo avançar para o Supabase. | Baixo | `select id_int, texto_whatsapp, obs_proposta from public.propostas where id_int = :id_int;` | `2026-05-23` / Planejamento | Escopo textual de baixo risco para iniciar o módulo crítico. |
| `public.propostas` | `texto_whatsapp`, `obs_proposta` | `UPDATE` | `FUTURO` | Primeiro passo de escrita no módulo crítico. | Médio | Conferir texto salvo e leitura pós-gravação. | Futuro / Fase 5 | Não pode alterar valor, status, cliente ou frete. |
| `public.propostas` | Campos financeiros, status, IDs sistêmicos e totais | `UPDATE` | `BLOQUEADO` | Impacta triggers, recálculos, financeiro e fiscal. | Crítico | Apenas leitura comparativa. | Permanente nesta etapa | Bloqueio total até fase sensível. |
| `public.propostas` | Qualquer campo | `INSERT` | `FUTURO` | Só depois de validar updates textuais sem efeitos colaterais. | Alto | Leitura da proposta criada e da view consolidada. | Futuro | Dependente de regras comerciais fechadas. |
| `public.propostas` | Qualquer campo | `DELETE` | `BLOQUEADO` | Proposta é registro crítico de histórico comercial e financeiro. | Crítico | Não aplicável. | Permanente | Manter bloqueado. |
| `public.produtos_proposta` | Descrição do item, quantidade e vínculo operacional | `READ` | `FUTURO` | A leitura é necessária para o detalhe e cálculo da proposta. | Baixo | `select * from public.produtos_proposta where id_int = :id_int order by id;` | `2026-05-23` / Planejamento | Tabela acionará recálculos ao escrever. |
| `public.produtos_proposta` | Descrição do item, quantidade e vínculo operacional | `UPDATE`, `INSERT` | `FUTURO` | Depende de validação de recálculo antes de liberar. | Alto | Conferir subtotal, peso e total final. | Futuro / Fase 6 | Exige validação de impacto em `vw_proposta_completa`. |
| `public.produtos_proposta` | Qualquer campo | `DELETE` | `BLOQUEADO` | Remover item pode quebrar total, frete e financeiro. | Crítico | Não aplicável. | Permanente | Não liberar sem regra própria de exclusão. |
| `public.produtos_proposta_variacao` | Escolha de variação e tipo | `READ` | `FUTURO` | Leitura necessária para detalhar o item da proposta. | Baixo | `select * from public.produtos_proposta_variacao where id_produto_proposta = :id;` | `2026-05-23` / Planejamento | Campo filho da proposta com impacto em valor/peso. |
| `public.produtos_proposta_variacao` | Escolha de variação e tipo | `UPDATE`, `INSERT` | `FUTURO` | Deve entrar junto ou depois de `produtos_proposta`, com recálculo validado. | Alto | Conferir escolha, subtotal e peso resultante. | Futuro / Fase 6 | Depende da estabilidade do item-base. |
| `public.produtos_proposta_variacao` | Qualquer campo | `DELETE` | `BLOQUEADO` | Pode desalinhar composição do item. | Alto | Não aplicável. | Permanente | Manter bloqueado. |
| `public.cotacao_frete` | Seleção e observação de frete | `READ` | `FUTURO` | Leitura é útil para análise da proposta e conferência do frete. | Baixo | `select * from public.cotacao_frete where id_int = :id_int order by id;` | `2026-05-23` / Planejamento | Contribui diretamente para total e prazo. |
| `public.cotacao_frete` | Seleção e observação de frete | `UPDATE`, `INSERT` | `FUTURO` | Precisa validar recálculo de total/frete antes de liberar. | Alto | Conferir frete escolhido, valor final e peso usado. | Futuro / Fase 6 | Tabela com triggers de recálculo. |
| `public.cotacao_frete` | Qualquer campo | `DELETE` | `BLOQUEADO` | Excluir frete pode quebrar o total da proposta. | Crítico | Não aplicável. | Permanente | Bloqueio por padrão. |
| `public.desconto_proposta` | Desconto comercial | `READ` | `FUTURO` | Leitura útil para resumo e auditoria comercial. | Baixo | `select * from public.desconto_proposta where id_int = :id_int;` | `2026-05-23` / Planejamento | Deve respeitar regras comerciais. |
| `public.desconto_proposta` | Desconto comercial | `UPDATE`, `INSERT` | `FUTURO` | Só depois de validar impacto comercial e recálculo. | Alto | Conferir desconto aplicado e total final. | Futuro / Fase 7 | A fase deve vir após itens e frete. |
| `public.desconto_proposta` | Qualquer campo | `DELETE` | `BLOQUEADO` | Remover desconto altera total e histórico. | Alto | Não aplicável. | Permanente | Manter bloqueado. |
| `public.pagamentos_v2` | Qualquer campo | `READ` | `FUTURO` | A leitura será necessária quando a carteira financeira avançar. | Baixo/médio | `select * from public.pagamentos_v2 where id_int = :id_int;` | `2026-05-23` / Planejamento | Continua apenas em leitura nesta etapa. |
| `public.pagamentos_v2` | Qualquer campo | `UPDATE`, `INSERT`, `DELETE` | `BLOQUEADO` | É a fase mais sensível, com efeitos financeiros e triggers de sincronismo. | Crítico | Não aplicável. | Permanente nesta fase | Somente em fase própria, após validação total. |

## Observações de uso

- Esta matriz não substitui o checklist técnico de cada mudança.
- Antes de habilitar qualquer novo `UPDATE` ou `INSERT`, revisar:
  - RLS;
  - triggers;
  - views dependentes;
  - validação pós-gravação;
  - confirmação explícita na UI.
- Sempre que uma fase for concluída, atualizar:
  - status;
  - data/fase;
  - validação pós-gravação;
  - observações técnicas.
