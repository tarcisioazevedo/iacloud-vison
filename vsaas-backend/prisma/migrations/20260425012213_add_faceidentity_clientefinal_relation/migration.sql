-- AddForeignKey
ALTER TABLE "FaceIdentity" ADD CONSTRAINT "FaceIdentity_clienteFinalId_fkey" FOREIGN KEY ("clienteFinalId") REFERENCES "ClienteFinal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
