-- ROLLBACK de 20261006_nfse_endereco_tomador — ultimo passo: a coluna.
-- Rodar DEPOIS dos quatro arquivos de funcao desta pasta (as funcoes novas citam a coluna).
-- Apaga a escolha de endereco gravada nas notas criadas depois da migration.
alter table public.notas_servico drop column if exists id_endereco_tomador;
