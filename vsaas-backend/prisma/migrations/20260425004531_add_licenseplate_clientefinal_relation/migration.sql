-- AddForeignKey
ALTER TABLE "LicensePlate" ADD CONSTRAINT "LicensePlate_clienteFinalId_fkey" FOREIGN KEY ("clienteFinalId") REFERENCES "ClienteFinal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
