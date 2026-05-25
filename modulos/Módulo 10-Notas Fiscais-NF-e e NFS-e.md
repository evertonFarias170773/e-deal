# Módulo 10 — Notas Fiscais / NF-e e NFS-e

## Objetivo

Controlar o fluxo fiscal do ERP, permitindo criar rascunhos, validar dados, preparar payloads, enviar notas para a Focus, consultar status, salvar retornos, baixar documentos fiscais e manter histórico de NF-e e NFS-e.

Este módulo contempla dois tipos principais de nota:

- NF-e — Nota Fiscal Eletrônica de produtos/mercadorias;
- NFS-e Nacional — Nota Fiscal de Serviço.

O módulo fiscal deve aproveitar todo o backend já construído no Supabase, Focus, n8n e Storage.

O maior desafio do novo sistema não é apenas a API.  
A parte mais importante será criar páginas de cadastro, edição e validação que sejam claras, seguras e fáceis de operar.

---

## Conceito geral

Notas fiscais não devem ser tratadas como simples formulários.

Uma nota fiscal passa por etapas:

1. Criação do rascunho.
2. Carregamento de dados da proposta/cliente/empresa.
3. Revisão dos dados fiscais.
4. Validação interna.
5. Preparação do payload.
6. Envio para Focus.
7. Consulta de status.
8. Autorização ou rejeição.
9. Download/salvamento de XML e DANFE/DANFSE.
10. Registro de erros, alertas e histórico.

A emissão fiscal deve ser sempre controlada, rastreável e protegida.

---

## Submódulos fiscais

Este módulo deve ser dividido em:

- NF-e
- NFS-e
- Validações fiscais
- Documentos fiscais
- Configurações fiscais auxiliares
- Integração Focus
- Histórico fiscal

---

# Parte 1 — NF-e

## Tabela principal da NF-e

Tabela:

`public.notas_fiscais`

Essa tabela representa o cabeçalho da NF-e.

Chave principal operacional:

`ref`

Exemplo:

`NFE-16604-001`

A NF-e também se relaciona com:

`id_int`

que representa a proposta/orçamento de origem.

---

## Tabelas relacionadas da NF-e

A NF-e é composta por:

- `notas_fiscais`
- `notas_fiscais_itens`
- `notas_fiscais_pagamentos`
- `clientes`
- `enderecos`
- `empresas`
- `nfe_naturezas_operacao`
- `nfe_ncm`
- `pagamentos_v2`
- `propostas`
- `cotacao_frete`

---

## Tabela `notas_fiscais`

Campos importantes:

- `id`
- `id_int`
- `id_cliente`
- `ref`
- `ambiente`
- `modelo`
- `status`
- `status_focus`
- `status_sefaz`
- `mensagem_sefaz`
- `codigo_status_sefaz`
- `numero_nf`
- `serie`
- `chave_nfe`
- `protocolo`
- `data_autorizacao`
- `data_cancelamento`
- `natureza_operacao`
- `tipo_documento`
- `finalidade_emissao`
- `consumidor_final`
- `presenca_comprador`
- `tipo_contribuinte`
- `modalidade_frete`
- `id_cotacao_frete`
- `transportadora`
- `valor_frete`
- `peso_liquido`
- `peso_bruto`
- `quantidade_volumes`
- `especie_volumes`
- `marca_volumes`
- `numeracao_volumes`
- `informacoes_complementares`
- `observacoes_internas`
- `endereco_entrega_observacao`
- `valor_produtos`
- `valor_desconto`
- `valor_total_nf`
- `caminho_xml`
- `caminho_danfe`
- `url_xml`
- `url_danfe`
- `payload_envio`
- `payload_retorno`
- `payload_webhook`
- `erro_codigo`
- `erro_mensagem`
- `erros_validacao`
- `tentativas_envio`
- `ultima_tentativa_em`
- `criado_por`
- `criado_por_nome`
- `created_at`
- `updated_at`
- `id_empresa`
- `end_entrega`
- `cond_pgto`
- `forma_pgto`
- `drop_natureza_op`
- `id_transportadora_cliente`
- `pgto_is_configurado`

---

## Tabela `notas_fiscais_itens`

Representa os itens fiscais da NF-e.

Relacionamento:

`notas_fiscais_itens.ref` → `notas_fiscais.ref`

Campos importantes:

- `id`
- `id_nota_fiscal`
- `ref`
- `id_int`
- `id_produtos_proposta`
- `id_produto`
- `numero_item`
- `codigo_produto`
- `descricao`
- `ncm`
- `cfop`
- `unidade_comercial`
- `unidade_tributavel`
- `quantidade`
- `valor_unitario`
- `valor_bruto`
- `quantidade_tributavel`
- `valor_unitario_tributavel`
- `icms_origem`
- `icms_situacao_tributaria`
- `pis_situacao_tributaria`
- `cofins_situacao_tributaria`
- `ativo`
- `editado_manualmente`
- `observacao`
- `origem_item`
- `peso_unitario_gramas`
- `peso_total_gramas`

---

## Tabela `notas_fiscais_pagamentos`

Representa as formas de pagamento fiscal da NF-e.

Relacionamento:

`notas_fiscais_pagamentos.ref` → `notas_fiscais.ref`

Campos importantes:

- `id`
- `id_int`
- `ref`
- `id_nota_fiscal`
- `numero_parcela`
- `total_parcelas`
- `numero_duplicata`
- `data_vencimento`
- `valor`
- `forma_pagamento`
- `descricao_forma_pagamento`
- `tipo_integracao`
- `origem`
- `observacao`
- `ativo`
- `dias_pra_inicio`
- `intervalo_dias`
- `tipo_registro`

---

## Funções principais da NF-e

Funções já usadas ou esperadas:

- `fn_preparar_envio_nfe(ref)`
- `fn_montar_payload_nfe(ref)`
- `fn_salvar_retorno_focus_nfe(...)`
- `fn_clonar_rascunho_nfe(ref_origem, criado_por)`
- `fn_recalcular_totais_nfe(ref)`
- `fn_alertas_nfe(ref)`
- `fn_trocar_empresa_nfe(ref, id_empresa, usuario)`

O novo front deve priorizar essas funções em vez de montar lógica fiscal complexa no navegador.

---

## Fluxo da NF-e

1. Usuário cria ou abre rascunho de NF-e.
2. Sistema carrega dados da proposta pelo `id_int`.
3. Sistema carrega cliente, endereço, empresa e itens.
4. Usuário revisa dados fiscais.
5. Sistema valida dados obrigatórios.
6. Sistema chama `fn_preparar_envio_nfe(ref)`.
7. Se houver erro de validação, exibe alertas.
8. Se estiver pronta, envia para Focus pelo fluxo backend/n8n.
9. Sistema consulta status.
10. Se autorizada, salva número, série, chave, protocolo, XML e DANFE.
11. Se rejeitada, salva erro e mostra correções necessárias.

---

## Status da NF-e

Status esperados:

- PENDENTE
- PRONTA_PARA_ENVIO
- PROCESSANDO
- AUTORIZADA
- ERRO_ENVIO
- REJEITADA
- CANCELADA
- DENEGADA

A interface deve usar badges claros para cada status.

---

## Página de lista de NF-e

Objetivo:

Listar rascunhos, notas enviadas, autorizadas, rejeitadas e canceladas.

Filtros:

- ref;
- cliente;
- id_int;
- empresa;
- status;
- ambiente;
- número NF;
- chave;
- período;
- vendedor/criador.

Colunas desktop sugeridas:

- Ref
- Cliente
- Empresa
- Valor
- Status
- Nº NF
- Série
- Data
- Ações

No mobile, cada nota vira card.

---

## Página de cadastro/edição da NF-e

Esta é uma das telas mais importantes do módulo fiscal.

A página deve ser organizada por seções ou abas.

Sugestão de abas:

1. Resumo
2. Emitente
3. Destinatário
4. Itens
5. Transporte/Frete
6. Pagamentos
7. Totais
8. Informações adicionais
9. Validação
10. Documentos/Retorno Focus
11. Histórico

---

## Cabeçalho da NF-e

O cabeçalho deve mostrar:

- ref;
- status;
- ambiente;
- empresa emitente;
- cliente;
- valor total;
- número NF, se autorizado;
- série, se autorizado;
- chave, se autorizado.

Ações principais:

- Validar
- Preparar envio
- Enviar NF-e
- Consultar status
- Baixar DANFE
- Baixar XML
- Clonar rascunho

Ações críticas:

- Trocar empresa emitente
- Cancelar NF-e
- Excluir rascunho, se permitido

---

## Aba Resumo

Deve mostrar:

- proposta origem;
- cliente;
- empresa;
- valor produtos;
- valor frete;
- desconto;
- total NF;
- status;
- alertas principais;
- documentos disponíveis.

---

## Aba Emitente

Dados vêm da tabela:

`empresas`

Campos importantes:

- razão social;
- nome fantasia;
- CNPJ;
- inscrição estadual;
- inscrição municipal;
- regime tributário;
- endereço;
- município;
- UF;
- CEP;
- ambiente NF-e;
- habilitação NF-e.

Regra:

O usuário não deve editar dados da empresa diretamente dentro da nota.  
A nota apenas mostra a empresa emitente selecionada.

Se precisar trocar empresa, usar RPC segura:

`fn_trocar_empresa_nfe`

---

## Aba Destinatário

Dados vêm de:

- `clientes`
- `enderecos`

Campos importantes:

- nome;
- documento;
- inscrição estadual;
- tipo contribuinte;
- endereço;
- cidade;
- UF;
- CEP;
- e-mail;
- telefone.

Validações importantes:

- CPF/CNPJ obrigatório;
- endereço obrigatório;
- UF obrigatória;
- CEP obrigatório;
- tipo contribuinte coerente;
- IE obrigatória ou isenta conforme regra.

---

## Aba Itens

Fonte:

`notas_fiscais_itens`

Deve permitir revisar:

- número do item;
- código produto;
- descrição;
- NCM;
- CFOP;
- unidade;
- quantidade;
- valor unitário;
- valor bruto;
- origem ICMS;
- CST/CSOSN;
- PIS;
- COFINS;
- peso.

Itens podem vir da proposta, mas precisam poder ser revisados antes do envio.

Alterações em itens fiscais devem ser tratadas com cuidado.

---

## Aba Transporte/Frete

Deve mostrar:

- modalidade do frete;
- valor do frete;
- transportadora;
- CNPJ/CPF da transportadora;
- IE;
- endereço;
- município;
- UF;
- volumes;
- peso líquido;
- peso bruto;
- espécie;
- marca;
- numeração.

Fonte:

- `notas_fiscais`
- `cotacao_frete`
- `clientes`, quando transportadora cadastrada
- `enderecos`, para endereço da transportadora

---

## Aba Pagamentos

Fonte:

`notas_fiscais_pagamentos`

Deve mostrar:

- forma de pagamento fiscal;
- valor;
- parcelas;
- vencimento;
- duplicatas;
- origem;
- observação.

Deve validar divergência entre:

- valor total da NF;
- soma dos pagamentos fiscais.

---

## Aba Totais

Deve mostrar:

- valor dos produtos;
- valor do frete;
- desconto;
- valor total da NF;
- total dos pagamentos;
- divergências.

Se houver diferença, exibir alerta.

---

## Aba Informações adicionais

Campos:

- informações complementares;
- observações internas;
- endereço de entrega observação;
- informações adicionais ao contribuinte.

---

## Aba Validação

Deve chamar ou exibir resultado de:

`fn_alertas_nfe(ref)`

Deve separar:

- erros bloqueantes;
- alertas não bloqueantes;
- informações.

Exemplo:

- documento ausente;
- endereço incompleto;
- item sem NCM;
- item sem CFOP;
- pagamento divergente;
- empresa não habilitada;
- frete inconsistente.

A validação deve ser visual e amigável.

---

## Aba Documentos / Retorno Focus

Deve mostrar:

- status Focus;
- status SEFAZ;
- mensagem SEFAZ;
- código status;
- número NF;
- série;
- chave;
- protocolo;
- data autorização;
- XML;
- DANFE;
- payload retorno, em área técnica recolhida.

Botões:

- abrir DANFE;
- baixar XML;
- copiar chave;
- consultar status.

---

# Parte 2 — NFS-e Nacional

## Tabela principal da NFS-e

Tabela:

`public.notas_servico`

Chave principal operacional:

`ref`

Exemplo:

`NFS-16251-001`

Também se relaciona com:

`id_int`

que representa a proposta/orçamento de origem.

---

## Tabelas relacionadas da NFS-e

- `notas_servico`
- `nfse_servicos_padrao`
- `clientes`
- `enderecos`
- `empresas`
- `nfe_naturezas_operacao`
- `propostas`
- `pagamentos_v2`

---

## Tabela `notas_servico`

Campos importantes:

- `id`
- `id_int`
- `ref`
- `id_empresa`
- `id_cliente`
- `status`
- `status_focus`
- `status_prefeitura`
- `mensagem_prefeitura`
- `ambiente`
- `municipio_prestacao`
- `uf_prestacao`
- `id_servico_padrao`
- `codigo_servico`
- `codigo_tributario_municipio`
- `item_lista_servico`
- `cnae`
- `discriminacao`
- `valor_servicos`
- `valor_deducoes`
- `valor_pis`
- `valor_cofins`
- `valor_inss`
- `valor_ir`
- `valor_csll`
- `aliquota_iss`
- `iss_retido`
- `numero_nfse`
- `codigo_verificacao`
- `caminho_xml`
- `caminho_pdf`
- `url_xml`
- `url_pdf`
- `erro_codigo`
- `erro_mensagem`
- `payload_envio`
- `payload_retorno`
- `criado_por_nome`
- `ultima_tentativa_em`
- `tentativas_envio`
- `numero_dps`
- `serie_dps`
- `id_natureza_operacao`
- `natureza_operacao`
- `codigo_nbs`
- `valor_desconto`
- `base_calculo_iss`
- `valor_iss`
- `valor_liquido`
- `codigo_indicador_operacao`
- `indicador_destinatario`
- `codigo_tributacao_nacional_iss`
- `regime_especial_tributacao`
- `codigo_opcao_simples_nacional`
- `situacao_tributaria_pis_cofins`
- `forma_pagamento`
- `informacoes_complementares`
- `informacoes_fisco`

---

## Tabela `nfse_servicos_padrao`

Representa serviços padrão usados na criação da NFS-e.

Campos importantes:

- `id`
- `nome`
- `descricao_padrao`
- `municipio_prestacao`
- `uf_prestacao`
- `codigo_servico`
- `codigo_tributario_municipio`
- `item_lista_servico`
- `cnae`
- `aliquota_iss`
- `iss_retido`
- `ativo`
- `codigo_nbs`

Serviço padrão conhecido:

- Serviços de impressão / composição gráfica
- município: Porto Alegre
- UF: RS
- item lista serviço: 13.05
- código tributação nacional ISS: 130501
- código NBS: 121012200

---

## Funções principais da NFS-e

Funções já usadas ou esperadas:

- `fn_criar_rascunho_nfse(...)`
- `fn_preparar_envio_nfse(ref)`
- `fn_montar_payload_nfse(ref)`
- `fn_alertas_nfse(ref)`
- `fn_nfse_recalcular_totais(ref)`
- `fn_clonar_rascunho_nfse(ref_origem, criado_por)`
- `fn_trocar_empresa_nfse(ref, id_empresa, usuario)`

---

## Fluxo da NFS-e

1. Usuário cria ou abre rascunho de NFS-e.
2. Sistema carrega proposta/cliente/empresa.
3. Sistema define serviço padrão.
4. Usuário revisa discriminação e valores.
5. Sistema valida tomador, serviço, empresa e tributação.
6. Sistema chama `fn_preparar_envio_nfse(ref)`.
7. Se houver erro, exibe alertas.
8. Se estiver pronta, envia para Focus `/v2/nfsen`.
9. Sistema consulta status.
10. Se autorizada, salva número, código de verificação, XML e DANFSE.
11. Se rejeitada, salva erro e orienta correção.

---

## Status da NFS-e

Status esperados:

- PENDENTE
- PRONTA_PARA_ENVIO
- PROCESSANDO
- AUTORIZADA
- ERRO_ENVIO
- REJEITADA
- CANCELADA

---

## Página de lista de NFS-e

Filtros:

- ref;
- tomador;
- id_int;
- empresa;
- status;
- ambiente;
- número NFS-e;
- período.

Colunas desktop sugeridas:

- Ref
- Tomador
- Empresa
- Valor
- Status
- Nº NFS-e
- Data
- Ações

---

## Página de cadastro/edição da NFS-e

Sugestão de abas:

1. Resumo
2. Prestador
3. Tomador
4. Serviço
5. Valores e impostos
6. Tributação Nacional
7. Validação
8. Documentos/Retorno Focus
9. Histórico

---

## Cabeçalho da NFS-e

Deve mostrar:

- ref;
- status;
- ambiente;
- empresa prestadora;
- tomador;
- valor líquido;
- número NFS-e;
- código de verificação.

Ações principais:

- Validar
- Preparar envio
- Enviar NFS-e
- Consultar status
- Baixar DANFSE
- Baixar XML
- Clonar rascunho

Ações críticas:

- Trocar empresa prestadora
- Cancelar NFS-e
- Excluir rascunho, se permitido

---

## Aba Prestador

Fonte:

`empresas`

Campos:

- razão social;
- CNPJ;
- inscrição municipal;
- município;
- UF;
- regime tributário;
- ambiente NFS-e;
- habilitação NFS-e;
- código município NFS-e.

Regra:

Não editar dados da empresa diretamente dentro da nota.  
Usar cadastro de empresas.

---

## Aba Tomador

Fonte:

- `clientes`
- `enderecos`

Campos:

- nome;
- CPF/CNPJ;
- inscrição municipal, se houver;
- e-mail;
- endereço;
- cidade;
- UF;
- CEP.

Validações:

- documento obrigatório;
- endereço obrigatório;
- município obrigatório;
- UF obrigatória;
- CEP obrigatório.

---

## Aba Serviço

Fonte:

- `notas_servico`
- `nfse_servicos_padrao`

Campos:

- serviço padrão;
- código serviço;
- código tributação nacional ISS;
- item lista serviço;
- CNAE, se usado;
- código NBS;
- discriminação;
- município prestação;
- UF prestação.

O campo `discriminacao` é central para a NFS-e.

---

## Aba Valores e impostos

Campos:

- valor serviços;
- deduções;
- desconto;
- base cálculo ISS;
- alíquota ISS;
- valor ISS;
- ISS retido;
- PIS;
- COFINS;
- INSS;
- IR;
- CSLL;
- valor líquido.

Deve recalcular usando função segura sempre que possível.

---

## Aba Tributação Nacional

Campos relacionados à NFS-e Nacional:

- `codigo_tributacao_nacional_iss`
- `codigo_nbs`
- `codigo_indicador_operacao`
- `indicador_destinatario`
- `regime_especial_tributacao`
- `codigo_opcao_simples_nacional`
- `situacao_tributaria_pis_cofins`
- campos IBS/CBS, quando utilizados.

Essa aba pode ser avançada e não precisa aparecer para usuário comum se os defaults estiverem corretos.

---

## Aba Validação NFS-e

Deve chamar ou exibir resultado de:

`fn_alertas_nfse(ref)`

Separar:

- erros bloqueantes;
- alertas;
- informações.

Exemplos:

- tomador sem documento;
- endereço incompleto;
- empresa não habilitada;
- serviço sem código tributação;
- valor zerado;
- discriminação vazia;
- inscrição municipal ausente, se for apenas alerta.

---

## Aba Documentos / Retorno Focus NFS-e

Deve mostrar:

- status Focus;
- status prefeitura;
- mensagem prefeitura;
- número NFS-e;
- código verificação;
- XML;
- DANFSE;
- payload retorno, recolhido.

Botões:

- abrir DANFSE;
- baixar XML;
- copiar código verificação;
- consultar status.

---

# Parte 3 — Integração Focus

## Conceito

A integração com a Focus é responsável por enviar, consultar e receber documentos fiscais.

O front não deve chamar a Focus diretamente com credenciais.

O envio deve passar por backend seguro:

- n8n;
- Edge Function;
- RPC;
- fluxo controlado.

---

## Multiempresa

Cada empresa pode ter sua própria configuração e credencial na Focus.

Empresas conhecidas:

- Ideal
- Birô
- E3

A nota deve usar a empresa definida em:

`id_empresa`

A empresa define:

- CNPJ;
- certificado;
- ambiente;
- série;
- habilitação NF-e;
- habilitação NFS-e;
- credencial Focus;
- dados fiscais.

---

## Troca de empresa emitente/prestadora

A troca de empresa deve ser feita por RPC segura.

Funções:

- `fn_trocar_empresa_nfe`
- `fn_trocar_empresa_nfse`

Regras:

- permitir apenas enquanto nota não estiver autorizada;
- bloquear se já houver XML/DANFE/DANFSE;
- limpar payloads antigos;
- limpar erros antigos;
- voltar status para PENDENTE;
- atualizar ambiente conforme empresa.

Nunca fazer update direto de `id_empresa` pelo front.

---

## Documentos fiscais

Documentos fiscais devem ser salvos no Supabase Storage.

NF-e:

- XML
- DANFE

NFS-e:

- XML
- DANFSE/PDF

Na tabela, salvar:

- caminho do arquivo;
- URL assinada, se usada;
- data de geração, se existir.

Observação:

Signed URLs expiram.  
O ideal é manter também o caminho fixo do arquivo no Storage para gerar nova URL quando necessário.

---

## Erros e retornos

Erros da Focus devem ser salvos e exibidos de forma amigável.

Campos:

- `erro_codigo`
- `erro_mensagem`
- `erros_validacao`
- `payload_retorno`

Regra:

Não mostrar payload técnico cru como mensagem principal.

Mostrar:

- mensagem simples;
- possível causa;
- orientação de correção;
- detalhe técnico recolhido.

---

# Parte 4 — Páginas gerais do módulo fiscal

## Página inicial fiscal

Pode reunir:

- resumo NF-e;
- resumo NFS-e;
- notas pendentes;
- notas com erro;
- notas autorizadas;
- atalhos para criar rascunho;
- alertas fiscais.

Cards:

- NF-e pendentes
- NF-e autorizadas
- NF-e com erro
- NFS-e pendentes
- NFS-e autorizadas
- NFS-e com erro

---

## Menu fiscal

Itens sugeridos:

- Visão geral fiscal
- NF-e
- NFS-e
- Serviços padrão NFS-e
- Naturezas de operação / CFOP
- NCM
- Empresas fiscais
- Configurações Focus, se permitido

---

## Menu de ações por linha

Seguir Skill 02.

Não usar vários ícones soltos.

A coluna final deve ser:

`Ações`

Ações NF-e:

- Abrir NF-e
- Validar
- Preparar envio
- Enviar
- Consultar status
- Baixar DANFE
- Baixar XML
- Copiar chave
- Clonar rascunho
- Trocar empresa
- Cancelar

Ações NFS-e:

- Abrir NFS-e
- Validar
- Preparar envio
- Enviar
- Consultar status
- Baixar DANFSE
- Baixar XML
- Copiar código verificação
- Clonar rascunho
- Trocar empresa
- Cancelar

Ações críticas separadas no final.

---

## Ações críticas

Sempre exigir confirmação para:

- enviar NF-e;
- enviar NFS-e;
- cancelar NF-e;
- cancelar NFS-e;
- trocar empresa;
- excluir rascunho;
- reenviar nota;
- alterar dados fiscais após preparação;
- limpar payload;
- editar item fiscal manualmente.

---

## Alertas fiscais

O sistema deve alertar quando:

- empresa não está habilitada;
- cliente sem documento;
- endereço incompleto;
- item sem NCM;
- item sem CFOP;
- valor total divergente;
- pagamento fiscal divergente;
- serviço sem código;
- tomador sem dados;
- nota rejeitada;
- nota autorizada sem XML salvo;
- nota autorizada sem DANFE/DANFSE salvo;
- ambiente errado;
- credencial Focus incorreta;
- série/número inválidos.

---

## Responsividade

No desktop:

- tela com abas;
- resumo lateral;
- tabelas de itens e pagamentos;
- painel de validação.

No mobile:

- cabeçalho compacto;
- abas em scroll horizontal;
- itens em cards;
- ações em menu inferior;
- painel de validação em cards;
- botões críticos bem destacados.

---

## O que este módulo faz

Este módulo permite:

- criar rascunho NF-e;
- criar rascunho NFS-e;
- revisar dados fiscais;
- editar dados fiscais permitidos;
- validar dados;
- preparar payload;
- enviar para Focus;
- consultar status;
- salvar documentos;
- abrir XML/DANFE/DANFSE;
- clonar rascunho;
- trocar empresa com segurança;
- visualizar erros e alertas.

---

## O que este módulo não faz

Este módulo não deve:

- criar proposta;
- confirmar pagamento;
- aprovar pedido;
- alterar cliente sem controle;
- expor credenciais Focus;
- chamar Focus diretamente do navegador;
- alterar empresa emitente com update direto;
- emitir nota sem confirmação;
- ignorar validações internas;
- apagar histórico fiscal.

---

## Componentes necessários

- FiscalDashboardPage
- NfeListPage
- NfeDetailPage
- NfeForm
- NfeHeader
- NfeActionsMenu
- NfeItensTable
- NfePagamentosPanel
- NfeTransportePanel
- NfeValidacaoPanel
- NfeDocumentosPanel
- NfseListPage
- NfseDetailPage
- NfseForm
- NfseHeader
- NfseActionsMenu
- NfseServicoPanel
- NfseValoresPanel
- NfseTributacaoPanel
- NfseValidacaoPanel
- NfseDocumentosPanel
- FiscalStatusBadge
- FiscalAlertCard
- TrocarEmpresaFiscalDialog
- EnviarNotaConfirmDialog
- CancelarNotaDialog

---

## Serviços necessários

- nfeService
- nfseService
- fiscalService
- empresasFiscalService
- focusService
- storageFiscalService
- validacaoFiscalService
- naturezaOperacaoService
- ncmService
- servicosPadraoNfseService

---

## RPCs / funções recomendadas

NF-e:

- criar rascunho NF-e;
- clonar rascunho NF-e;
- recalcular totais NF-e;
- validar NF-e;
- preparar envio NF-e;
- trocar empresa NF-e;
- salvar retorno Focus NF-e.

NFS-e:

- criar rascunho NFS-e;
- clonar rascunho NFS-e;
- recalcular totais NFS-e;
- validar NFS-e;
- preparar envio NFS-e;
- trocar empresa NFS-e;
- salvar retorno Focus NFS-e.

---

## Primeira implementação sugerida

Etapa 1:

- criar lista de NF-e;
- criar lista de NFS-e;
- filtros por status, empresa, cliente e período.

Etapa 2:

- criar detalhe da NF-e com abas;
- exibir resumo, emitente, destinatário, itens, pagamentos e validação.

Etapa 3:

- criar detalhe da NFS-e com abas;
- exibir resumo, prestador, tomador, serviço, valores e validação.

Etapa 4:

- integrar validações via RPC;
- mostrar erros e alertas amigáveis.

Etapa 5:

- integrar preparação de envio;
- exibir payload técnico recolhido.

Etapa 6:

- integrar envio/consulta via backend existente;
- salvar documentos.

Etapa 7:

- criar ações de clonar, trocar empresa e consultar status.

---

## Resultado esperado

Ao final deste módulo, o sistema deve permitir:

- gerenciar NF-e e NFS-e em uma área fiscal clara;
- criar e editar rascunhos com segurança;
- validar antes de enviar;
- enviar usando Focus/backend;
- consultar status;
- salvar e abrir documentos;
- entender erros fiscais;
- reduzir risco de emissão incorreta;
- melhorar muito a operação em relação ao FlutterFlow.

---

## Observações importantes

O módulo fiscal é sensível e deve ser construído com prioridade em segurança e clareza.

As páginas de cadastro/edição são críticas porque concentram muitos campos fiscais.

O novo sistema deve evitar telas longas e confusas.

Usar abas, cards, validações visuais e alertas claros.

A regra principal é:

O usuário precisa saber exatamente o que falta corrigir antes de enviar a nota.

Não emitir nota fiscal sem validação e confirmação.