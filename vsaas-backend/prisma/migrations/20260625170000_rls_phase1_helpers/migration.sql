-- B-3b Fase 1: helpers de RLS (NÃO habilita RLS ainda).
-- Cria função current_tenant_id() que lê app.tenant_id da sessão (settable via
-- SET LOCAL). Próximas fases vão ENABLE ROW LEVEL SECURITY em tabelas
-- específicas, uma por vez. Ver docs/B-3b-RLS-PLAN.md.

-- Helper: tenant atual da sessão (NULL se não setado)
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS UUID AS $$
DECLARE
  v_id TEXT;
BEGIN
  v_id := current_setting('app.tenant_id', true);
  IF v_id IS NULL OR v_id = '' THEN
    RETURN NULL;
  END IF;
  RETURN v_id::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION current_tenant_id() IS
  'B-3b RLS: lê app.tenant_id da sessão Postgres. App deve fazer SET LOCAL app.tenant_id antes de cada transação user-facing. NULL = sem scope (RLS policies vão rejeitar).';

-- Helper: super admin bypass (settable via SET LOCAL app.is_super_admin = 'true')
CREATE OR REPLACE FUNCTION current_is_super_admin() RETURNS BOOLEAN AS $$
BEGIN
  RETURN current_setting('app.is_super_admin', true) = 'true';
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION current_is_super_admin() IS
  'B-3b RLS: retorna true quando a sessão setou app.is_super_admin=true. Permite bypass de policies para operações administrativas legítimas (cron, backup, SUPER_ADMIN UI).';
