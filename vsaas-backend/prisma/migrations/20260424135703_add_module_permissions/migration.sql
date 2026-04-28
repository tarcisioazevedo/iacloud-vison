-- CreateTable
CREATE TABLE "IntegradorModule" (
    "id" TEXT NOT NULL,
    "integradorId" TEXT NOT NULL,
    "module" "AnalyticsModel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "IntegradorModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClienteFinalModule" (
    "id" TEXT NOT NULL,
    "clienteFinalId" TEXT NOT NULL,
    "module" "AnalyticsModel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,

    CONSTRAINT "ClienteFinalModule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegradorModule_integradorId_idx" ON "IntegradorModule"("integradorId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegradorModule_integradorId_module_key" ON "IntegradorModule"("integradorId", "module");

-- CreateIndex
CREATE INDEX "ClienteFinalModule_clienteFinalId_idx" ON "ClienteFinalModule"("clienteFinalId");

-- CreateIndex
CREATE UNIQUE INDEX "ClienteFinalModule_clienteFinalId_module_key" ON "ClienteFinalModule"("clienteFinalId", "module");

-- AddForeignKey
ALTER TABLE "IntegradorModule" ADD CONSTRAINT "IntegradorModule_integradorId_fkey" FOREIGN KEY ("integradorId") REFERENCES "Integrador"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClienteFinalModule" ADD CONSTRAINT "ClienteFinalModule_clienteFinalId_fkey" FOREIGN KEY ("clienteFinalId") REFERENCES "ClienteFinal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
