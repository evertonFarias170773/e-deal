type SupabaseQueryResponse<T> = {
  data: T | null;
  error: Error | null;
};

type SupabaseReadOnlyQuery<T> = {
  order(column: string, options?: { ascending?: boolean }): SupabaseReadOnlyQuery<T>;
  limit(count: number): SupabaseReadOnlyQuery<T>;
  returns<U = T>(): Promise<SupabaseQueryResponse<U>>;
};

type SupabaseReadOnlyTable = {
  select(columns: string): SupabaseReadOnlyQuery<unknown[]>;
};

type SupabaseReadOnlyClient = {
  from(table: string): SupabaseReadOnlyTable;
};

function buildHeaders(anonKey: string) {
  return {
    apikey: anonKey,
    authorization: `Bearer ${anonKey}`,
    accept: "application/json"
  };
}

function createQueryExecutor<T>(
  baseUrl: string,
  anonKey: string,
  table: string,
  columns: string,
  orderColumn?: string,
  ascending = true,
  limitCount?: number
): SupabaseReadOnlyQuery<T> {
  return {
    order(column, options) {
      return createQueryExecutor<T>(
        baseUrl,
        anonKey,
        table,
        columns,
        column,
        options?.ascending ?? true,
        limitCount
      );
    },
    limit(count) {
      return createQueryExecutor<T>(
        baseUrl,
        anonKey,
        table,
        columns,
        orderColumn,
        ascending,
        count
      );
    },
    async returns<U = T>() {
      try {
        const url = new URL(`${baseUrl.replace(/\/$/, "")}/rest/v1/${table}`);
        url.searchParams.set("select", columns);

        if (orderColumn) {
          url.searchParams.set("order", `${orderColumn}.${ascending ? "asc" : "desc"}`);
        }

        if (typeof limitCount === "number") {
          url.searchParams.set("limit", String(limitCount));
        }

        const response = await fetch(url.toString(), {
          headers: buildHeaders(anonKey)
        });

        if (!response.ok) {
          return {
            data: null,
            error: new Error(`Supabase request failed (${response.status})`)
          };
        }

        const data = (await response.json()) as U;
        return {
          data,
          error: null
        };
      } catch (error) {
        return {
          data: null,
          error: error instanceof Error ? error : new Error("Supabase request failed")
        };
      }
    }
  };
}

function createReadOnlyClient(baseUrl: string, anonKey: string): SupabaseReadOnlyClient {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          return createQueryExecutor(baseUrl, anonKey, table, columns);
        }
      };
    }
  };
}

let supabaseClient: SupabaseReadOnlyClient | null = null;

export function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createReadOnlyClient(url, anonKey);
  }

  return supabaseClient;
}
