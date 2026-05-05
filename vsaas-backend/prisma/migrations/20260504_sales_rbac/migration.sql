-- Sprint Sales Config — RBAC granular + config singleton

CREATE TABLE "SalesPermission" (
    "id" TEXT NOT NULL,
    "role" "SalesRole",
    "salesUserId" TEXT,
    "screen" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "changedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SalesPermission_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesPermission_role_screen_key" ON "SalesPermission"("role", "screen");
CREATE UNIQUE INDEX "SalesPermission_salesUserId_screen_key" ON "SalesPermission"("salesUserId", "screen");
CREATE INDEX "SalesPermission_role_idx" ON "SalesPermission"("role");
CREATE INDEX "SalesPermission_salesUserId_idx" ON "SalesPermission"("salesUserId");

CREATE TABLE "SalesConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "slaDemoBusinessDays" INTEGER NOT NULL DEFAULT 1,
    "roundRobinEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushNotifications" BOOLEAN NOT NULL DEFAULT true,
    "customLostReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultGoalsJson" JSONB,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SalesConfig_pkey" PRIMARY KEY ("id")
);

-- Seed defaults da matriz role × screen × level
-- Convenção: NONE não é seedado (a ausência = NONE).
INSERT INTO "SalesPermission" (id, role, screen, level, "createdAt", "updatedAt") VALUES
  -- SDR: prospecção
  (gen_random_uuid()::text, 'SDR', 'executive',     'VIEW', now(), now()),
  (gen_random_uuid()::text, 'SDR', 'pipeline',      'EDIT', now(), now()),
  (gen_random_uuid()::text, 'SDR', 'demos',         'VIEW', now(), now()),
  (gen_random_uuid()::text, 'SDR', 'opportunities', 'VIEW', now(), now()),
  (gen_random_uuid()::text, 'SDR', 'activities',    'EDIT', now(), now()),
  (gen_random_uuid()::text, 'SDR', 'materials',     'VIEW', now(), now()),
  -- HUNTER
  (gen_random_uuid()::text, 'HUNTER', 'executive',     'VIEW', now(), now()),
  (gen_random_uuid()::text, 'HUNTER', 'pipeline',      'EDIT', now(), now()),
  (gen_random_uuid()::text, 'HUNTER', 'demos',         'EDIT', now(), now()),
  (gen_random_uuid()::text, 'HUNTER', 'opportunities', 'EDIT', now(), now()),
  (gen_random_uuid()::text, 'HUNTER', 'activities',    'EDIT', now(), now()),
  (gen_random_uuid()::text, 'HUNTER', 'materials',     'VIEW', now(), now()),
  -- CLOSER
  (gen_random_uuid()::text, 'CLOSER', 'executive',     'VIEW',  now(), now()),
  (gen_random_uuid()::text, 'CLOSER', 'pipeline',      'EDIT',  now(), now()),
  (gen_random_uuid()::text, 'CLOSER', 'demos',         'EDIT',  now(), now()),
  (gen_random_uuid()::text, 'CLOSER', 'opportunities', 'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'CLOSER', 'activities',    'EDIT',  now(), now()),
  (gen_random_uuid()::text, 'CLOSER', 'materials',     'VIEW',  now(), now()),
  (gen_random_uuid()::text, 'CLOSER', 'modules',       'EDIT',  now(), now()),
  -- AE (similar a CLOSER)
  (gen_random_uuid()::text, 'AE', 'executive',     'VIEW',  now(), now()),
  (gen_random_uuid()::text, 'AE', 'pipeline',      'EDIT',  now(), now()),
  (gen_random_uuid()::text, 'AE', 'demos',         'EDIT',  now(), now()),
  (gen_random_uuid()::text, 'AE', 'opportunities', 'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'AE', 'activities',    'EDIT',  now(), now()),
  (gen_random_uuid()::text, 'AE', 'materials',     'VIEW',  now(), now()),
  (gen_random_uuid()::text, 'AE', 'modules',       'EDIT',  now(), now()),
  -- CS
  (gen_random_uuid()::text, 'CS', 'executive',     'VIEW',  now(), now()),
  (gen_random_uuid()::text, 'CS', 'pipeline',      'VIEW',  now(), now()),
  (gen_random_uuid()::text, 'CS', 'demos',         'VIEW',  now(), now()),
  (gen_random_uuid()::text, 'CS', 'opportunities', 'EDIT',  now(), now()),
  (gen_random_uuid()::text, 'CS', 'activities',    'EDIT',  now(), now()),
  (gen_random_uuid()::text, 'CS', 'materials',     'VIEW',  now(), now()),
  (gen_random_uuid()::text, 'CS', 'modules',       'EDIT',  now(), now()),
  -- MANAGER
  (gen_random_uuid()::text, 'MANAGER', 'executive',     'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'MANAGER', 'pipeline',      'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'MANAGER', 'demos',         'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'MANAGER', 'opportunities', 'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'MANAGER', 'activities',    'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'MANAGER', 'team',          'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'MANAGER', 'materials',     'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'MANAGER', 'modules',       'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'MANAGER', 'config',        'ADMIN', now(), now()),
  -- DIRECTOR (igual MANAGER)
  (gen_random_uuid()::text, 'DIRECTOR', 'executive',     'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'DIRECTOR', 'pipeline',      'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'DIRECTOR', 'demos',         'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'DIRECTOR', 'opportunities', 'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'DIRECTOR', 'activities',    'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'DIRECTOR', 'team',          'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'DIRECTOR', 'materials',     'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'DIRECTOR', 'modules',       'ADMIN', now(), now()),
  (gen_random_uuid()::text, 'DIRECTOR', 'config',        'ADMIN', now(), now())
ON CONFLICT (role, screen) DO NOTHING;

-- Singleton config
INSERT INTO "SalesConfig" (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;
