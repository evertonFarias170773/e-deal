$content = Get-Content ".env.local"
foreach ($line in $content) {
  if ($line -match "^NEXT_PUBLIC_SUPABASE_URL=(.+)$") {
    $env:NEXT_PUBLIC_SUPABASE_URL = $matches[1].Trim()
  }
  if ($line -match "^NEXT_PUBLIC_SUPABASE_ANON_KEY=(.+)$") {
    $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $matches[1].Trim()
  }
  if ($line -match "^MAESTRO_AVULSO_ENABLED=(.*)$") {
    $env:MAESTRO_AVULSO_ENABLED = $matches[1].Trim()
  }
}
npx tsx src/features/maestro/core/simple/test_orcamento_catalogo_real.ts
