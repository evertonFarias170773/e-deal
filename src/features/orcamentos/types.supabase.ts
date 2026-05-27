export type SupabaseValue = string | number | bigint | boolean | null | undefined | Array<unknown> | Record<string, unknown>;

export type SupabasePropostaRow = Record<string, SupabaseValue> & {
  id?: SupabaseValue;
  id_int?: SupabaseValue;
  id_cliente?: SupabaseValue;
  cliente?: SupabaseValue;
  os_ideal?: SupabaseValue;
  created_at?: SupabaseValue;
  vendedor?: SupabaseValue;
  status_interno?: SupabaseValue;
  valor_total?: SupabaseValue;
  valor?: SupabaseValue;
  is_avulso?: SupabaseValue;
  texto_whatsapp?: SupabaseValue;
  obs_proposta?: SupabaseValue;
};

export type SupabasePagamentoTipoCobrancaRow = {
  id_int?: SupabaseValue;
  tipo_cobranca?: SupabaseValue;
};

