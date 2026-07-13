-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('TRIALING', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('WAITING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('UNPAID', 'PAID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('PLATFORM_ADMIN', 'MERCHANT_OWNER', 'MERCHANT_MANAGER', 'STAFF', 'KITCHEN');

-- CreateEnum
CREATE TYPE "audit_outcome" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateEnum
CREATE TYPE "qr_code_state" AS ENUM ('ACTIVE', 'PAUSED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "order_session_status" AS ENUM ('ACTIVE', 'CONSUMED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "stall_ordering_state" AS ENUM ('OPEN', 'PAUSED', 'CLOSED');

-- CreateEnum
CREATE TYPE "public_attempt_outcome" AS ENUM ('ALLOWED', 'DENIED', 'ERROR');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'TRIALING',
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "ordering_state" "stall_ordering_state" NOT NULL DEFAULT 'OPEN',
    "is_sold_out" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stalls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_accounts" (
    "id" UUID NOT NULL,
    "auth_user_id" UUID,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "platform_role" "user_role",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stall_memberships" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "stall_id" UUID NOT NULL,
    "role" "user_role" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stall_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "csrf_token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "stall_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID,
    "outcome" "audit_outcome" NOT NULL,
    "request_id" TEXT NOT NULL,
    "ip_hash" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stall_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qr_codes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stall_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "state" "qr_code_state" NOT NULL DEFAULT 'ACTIVE',
    "token_version" INTEGER NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qr_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stall_ordering_settings" (
    "stall_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_session_ttl_seconds" INTEGER NOT NULL DEFAULT 600,
    "unconfirmed_order_timeout_seconds" INTEGER NOT NULL DEFAULT 600,
    "max_item_quantity" INTEGER NOT NULL DEFAULT 20,
    "max_unique_products" INTEGER NOT NULL DEFAULT 20,
    "max_total_quantity" INTEGER NOT NULL DEFAULT 40,
    "max_note_length" INTEGER NOT NULL DEFAULT 200,
    "max_pending_orders_per_device" INTEGER NOT NULL DEFAULT 3,
    "max_orders_per_window" INTEGER NOT NULL DEFAULT 5,
    "order_window_seconds" INTEGER NOT NULL DEFAULT 300,
    "max_sessions_per_ip_window" INTEGER NOT NULL DEFAULT 20,
    "max_sessions_per_device_window" INTEGER NOT NULL DEFAULT 10,
    "max_sessions_per_qr_window" INTEGER NOT NULL DEFAULT 100,
    "max_sessions_per_stall_window" INTEGER NOT NULL DEFAULT 500,
    "max_behavior_frequency" INTEGER NOT NULL DEFAULT 4,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stall_ordering_settings_pkey" PRIMARY KEY ("stall_id")
);

-- CreateTable
CREATE TABLE "order_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stall_id" UUID NOT NULL,
    "qr_code_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "device_hash" TEXT NOT NULL,
    "ip_hash" TEXT NOT NULL,
    "status" "order_session_status" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "order_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stall_id" UUID NOT NULL,
    "order_no" TEXT NOT NULL,
    "tracking_token_hash" TEXT NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'QR_MENU',
    "customer_name" TEXT NOT NULL,
    "customer_phone" TEXT,
    "table_label" TEXT,
    "note" TEXT,
    "status" "order_status" NOT NULL DEFAULT 'WAITING_CONFIRMATION',
    "payment_status" "payment_status" NOT NULL DEFAULT 'UNPAID',
    "total" INTEGER NOT NULL,
    "device_hash" TEXT NOT NULL,
    "pickup_code_hash" TEXT NOT NULL,
    "pickup_verified_at" TIMESTAMP(3),
    "confirmation_expires_at" TIMESTAMP(3) NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "expired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stall_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "stall_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "previous_status" "order_status",
    "new_status" "order_status",
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_order_attempts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "stall_id" UUID,
    "qr_code_id" UUID,
    "order_session_id" UUID,
    "request_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "outcome" "public_attempt_outcome" NOT NULL,
    "reason_code" TEXT NOT NULL,
    "ip_hash" TEXT,
    "device_hash" TEXT,
    "qr_token_hash" TEXT,
    "order_session_hash" TEXT,
    "behavior_hash" TEXT,
    "idempotency_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_order_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_rate_limit_buckets" (
    "id" UUID NOT NULL,
    "stall_id" UUID NOT NULL,
    "dimension_type" TEXT NOT NULL,
    "dimension_hash" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_rate_limit_buckets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stall_order_counters" (
    "stall_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stall_order_counters_pkey" PRIMARY KEY ("stall_id","business_date")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_email_key" ON "tenants"("email");

-- CreateIndex
CREATE UNIQUE INDEX "stalls_slug_key" ON "stalls"("slug");

-- CreateIndex
CREATE INDEX "stalls_tenant_id_idx" ON "stalls"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_auth_user_id_key" ON "user_accounts"("auth_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_email_key" ON "user_accounts"("email");

-- CreateIndex
CREATE INDEX "stall_memberships_stall_id_role_idx" ON "stall_memberships"("stall_id", "role");

-- CreateIndex
CREATE INDEX "stall_memberships_tenant_id_idx" ON "stall_memberships"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "stall_memberships_user_id_stall_id_key" ON "stall_memberships"("user_id", "stall_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- CreateIndex
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_stall_id_created_at_idx" ON "audit_logs"("stall_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets"("expires_at");

-- CreateIndex
CREATE INDEX "products_tenant_id_idx" ON "products"("tenant_id");

-- CreateIndex
CREATE INDEX "products_stall_id_category_idx" ON "products"("stall_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "qr_codes_token_key" ON "qr_codes"("token");

-- CreateIndex
CREATE INDEX "qr_codes_tenant_id_stall_id_idx" ON "qr_codes"("tenant_id", "stall_id");

-- CreateIndex
CREATE INDEX "qr_codes_stall_id_state_idx" ON "qr_codes"("stall_id", "state");

-- CreateIndex
CREATE INDEX "stall_ordering_settings_tenant_id_idx" ON "stall_ordering_settings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_sessions_token_hash_key" ON "order_sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "order_sessions_order_id_key" ON "order_sessions"("order_id");

-- CreateIndex
CREATE INDEX "order_sessions_stall_id_status_expires_at_idx" ON "order_sessions"("stall_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "order_sessions_device_hash_status_idx" ON "order_sessions"("device_hash", "status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tracking_token_hash_key" ON "orders"("tracking_token_hash");

-- CreateIndex
CREATE INDEX "orders_tenant_id_idx" ON "orders"("tenant_id");

-- CreateIndex
CREATE INDEX "orders_stall_id_status_idx" ON "orders"("stall_id", "status");

-- CreateIndex
CREATE INDEX "orders_stall_id_created_at_idx" ON "orders"("stall_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_confirmation_expires_at_status_idx" ON "orders"("confirmation_expires_at", "status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_stall_id_order_no_key" ON "orders"("stall_id", "order_no");

-- CreateIndex
CREATE UNIQUE INDEX "orders_stall_id_idempotency_key_key" ON "orders"("stall_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "order_items_tenant_id_stall_id_idx" ON "order_items"("tenant_id", "stall_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_events_tenant_id_created_at_idx" ON "order_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "public_order_attempts_tenant_id_created_at_idx" ON "public_order_attempts"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "public_order_attempts_stall_id_created_at_idx" ON "public_order_attempts"("stall_id", "created_at");

-- CreateIndex
CREATE INDEX "public_order_attempts_ip_hash_created_at_idx" ON "public_order_attempts"("ip_hash", "created_at");

-- CreateIndex
CREATE INDEX "public_order_attempts_device_hash_created_at_idx" ON "public_order_attempts"("device_hash", "created_at");

-- CreateIndex
CREATE INDEX "public_rate_limit_buckets_expires_at_idx" ON "public_rate_limit_buckets"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "public_rate_limit_buckets_stall_id_dimension_type_dimension_key" ON "public_rate_limit_buckets"("stall_id", "dimension_type", "dimension_hash", "window_start");

-- AddForeignKey
ALTER TABLE "stalls" ADD CONSTRAINT "stalls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stall_memberships" ADD CONSTRAINT "stall_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stall_memberships" ADD CONSTRAINT "stall_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stall_memberships" ADD CONSTRAINT "stall_memberships_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stall_ordering_settings" ADD CONSTRAINT "stall_ordering_settings_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_sessions" ADD CONSTRAINT "order_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_sessions" ADD CONSTRAINT "order_sessions_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_sessions" ADD CONSTRAINT "order_sessions_qr_code_id_fkey" FOREIGN KEY ("qr_code_id") REFERENCES "qr_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_sessions" ADD CONSTRAINT "order_sessions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_order_attempts" ADD CONSTRAINT "public_order_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_order_attempts" ADD CONSTRAINT "public_order_attempts_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_order_attempts" ADD CONSTRAINT "public_order_attempts_qr_code_id_fkey" FOREIGN KEY ("qr_code_id") REFERENCES "qr_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_rate_limit_buckets" ADD CONSTRAINT "public_rate_limit_buckets_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stall_order_counters" ADD CONSTRAINT "stall_order_counters_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE CASCADE ON UPDATE CASCADE;
