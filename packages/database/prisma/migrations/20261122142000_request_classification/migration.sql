-- CreateEnum
CREATE TYPE "RequestClass" AS ENUM ('DOCUMENT', 'STATIC', 'API', 'OTHER');

-- AlterTable
ALTER TABLE "network_requests" ADD COLUMN "request_class" "RequestClass";

-- CreateIndex
CREATE INDEX "network_requests_scan_id_request_class_idx" ON "network_requests"("scan_id", "request_class");
