-- Baixa manual em Contas a Receber: forma de recebimento + observacao.
-- Aditivo e nao-destrutivo (colunas nullable). Nao altera valores, proposta,
-- cliente, vencimento nem RLS. O historico da baixa e capturado automaticamente
-- por trg_audit_boletos -> audit.log_row_changes_v2 (changed_fields).
alter table public.boletos
  add column if not exists forma_recebimento text,
  add column if not exists obs_recebimento text;

comment on column public.boletos.forma_recebimento is 'Forma de recebimento informada na baixa manual do Contas a Receber (PIX/CARTAO/DINHEIRO/BONIFICADO/OUTROS). Pagamento recebido fora do boleto bancario.';
comment on column public.boletos.obs_recebimento is 'Observacao da baixa manual (obrigatoria quando forma_recebimento = OUTROS).';
