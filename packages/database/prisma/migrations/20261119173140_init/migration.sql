-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scans" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error_message" TEXT,

    CONSTRAINT "scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_requests" (
    "id" UUID NOT NULL,
    "scan_id" UUID NOT NULL,
    "request_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "resource_type" TEXT,
    "request_headers" JSONB,
    "request_payload" TEXT,
    "initiator" JSONB,
    "timestamp" TIMESTAMPTZ(6) NOT NULL,
    "failure_reason" TEXT,
    "redirect_chain" JSONB,

    CONSTRAINT "network_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "network_responses" (
    "id" UUID NOT NULL,
    "network_request_id" UUID NOT NULL,
    "status_code" INTEGER,
    "response_headers" JSONB,
    "mime_type" TEXT,
    "body_size" INTEGER,
    "response_payload_reference" TEXT,

    CONSTRAINT "network_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_timings" (
    "id" UUID NOT NULL,
    "network_request_id" UUID NOT NULL,
    "dns_time" DOUBLE PRECISION,
    "connect_time" DOUBLE PRECISION,
    "tls_time" DOUBLE PRECISION,
    "ttfb" DOUBLE PRECISION,
    "download_time" DOUBLE PRECISION,
    "total_duration" DOUBLE PRECISION,
    "timing_metadata" JSONB,

    CONSTRAINT "request_timings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "scans_user_id_created_at_idx" ON "scans"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "scans_status_idx" ON "scans"("status");

-- CreateIndex
CREATE INDEX "network_requests_scan_id_timestamp_idx" ON "network_requests"("scan_id", "timestamp");

-- CreateIndex
CREATE INDEX "network_requests_scan_id_method_idx" ON "network_requests"("scan_id", "method");

-- CreateIndex
CREATE INDEX "network_requests_scan_id_resource_type_idx" ON "network_requests"("scan_id", "resource_type");

-- CreateIndex
CREATE UNIQUE INDEX "network_requests_scan_id_request_id_key" ON "network_requests"("scan_id", "request_id");

-- CreateIndex
CREATE UNIQUE INDEX "network_responses_network_request_id_key" ON "network_responses"("network_request_id");

-- CreateIndex
CREATE INDEX "network_responses_status_code_idx" ON "network_responses"("status_code");

-- CreateIndex
CREATE UNIQUE INDEX "request_timings_network_request_id_key" ON "request_timings"("network_request_id");

-- AddForeignKey
ALTER TABLE "scans" ADD CONSTRAINT "scans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_requests" ADD CONSTRAINT "network_requests_scan_id_fkey" FOREIGN KEY ("scan_id") REFERENCES "scans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "network_responses" ADD CONSTRAINT "network_responses_network_request_id_fkey" FOREIGN KEY ("network_request_id") REFERENCES "network_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_timings" ADD CONSTRAINT "request_timings_network_request_id_fkey" FOREIGN KEY ("network_request_id") REFERENCES "network_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
