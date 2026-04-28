-- Subdomínio Cloudflare provisionado por tenant (Sprint CF.1).
-- UNIQUE pra evitar colisão DNS em provisões concorrentes.
ALTER TABLE "Integrador" ADD COLUMN "cfSubdomain"   TEXT;
ALTER TABLE "Integrador" ADD COLUMN "cfDnsRecordId" TEXT;

CREATE UNIQUE INDEX "Integrador_cfSubdomain_key" ON "Integrador"("cfSubdomain");
