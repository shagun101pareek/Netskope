-- AlterTable
ALTER TABLE "scans" ADD COLUMN "capture_bodies" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "network_requests" ADD COLUMN "query_params" JSONB,
ADD COLUMN "request_size" INTEGER,
ADD COLUMN "request_payload_truncated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "request_body_omitted_reason" TEXT;

-- AlterTable
ALTER TABLE "network_responses" ADD COLUMN "status_text" TEXT,
ADD COLUMN "remote_address" TEXT,
ADD COLUMN "response_body" TEXT,
ADD COLUMN "body_omitted_reason" TEXT,
ADD COLUMN "body_truncated" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "ReplayStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "request_replays" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scan_id" UUID NOT NULL,
    "network_request_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "headers" JSONB NOT NULL,
    "body" TEXT,
    "confirm_mutation" BOOLEAN NOT NULL DEFAULT false,
    "send_credentials" BOOLEAN NOT NULL DEFAULT false,
    "status" "ReplayStatus" NOT NULL DEFAULT 'PENDING',
    "original_status" INTEGER,
    "replay_status" INTEGER,
    "original_duration" DOUBLE PRECISION,
    "replay_duration" DOUBLE PRECISION,
    "response_excerpt" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "request_replays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_overrides" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "scan_id" UUID NOT NULL,
    "test_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "assertion" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "test_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "request_replays_scan_id_created_at_idx" ON "request_replays"("scan_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "request_replays_user_id_idx" ON "request_replays"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "test_overrides_scan_id_test_key_key" ON "test_overrides"("scan_id", "test_key");

-- AddForeignKey
ALTER TABLE "request_replays" ADD CONSTRAINT "request_replays_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_replays" ADD CONSTRAINT "request_replays_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_replays" ADD CONSTRAINT "request_replays_network_request_id_fkey" FOREIGN KEY ("network_request_id") REFERENCES "network_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_overrides" ADD CONSTRAINT "test_overrides_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_overrides" ADD CONSTRAINT "test_overrides_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
