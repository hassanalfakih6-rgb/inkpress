-- Enums
CREATE TYPE "Priority" AS ENUM ('NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED');
CREATE TYPE "CashMethod" AS ENUM ('CASH', 'WHISH');
CREATE TYPE "EntryType" AS ENUM ('EXPENSE', 'SETTLEMENT', 'ADJUSTMENT');

-- Lookup tables
CREATE TABLE "Client" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Client_phone_key" ON "Client"("phone");
CREATE INDEX "Client_name_idx" ON "Client"("name");

CREATE TABLE "ProductType" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProductType_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProductType_name_key" ON "ProductType"("name");

CREATE TABLE "DeliveryCompany" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeliveryCompany_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeliveryCompany_name_key" ON "DeliveryCompany"("name");

CREATE TABLE "Setting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- Order: new workflow, money and relation columns
ALTER TABLE "Order"
  ALTER COLUMN "status" SET DEFAULT 'INTAKE',
  ALTER COLUMN "laborName" SET DEFAULT '',
  ADD COLUMN "note" TEXT,
  ADD COLUMN "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "openToAll" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deliverySettled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deliverySettledAt" TIMESTAMP(3),
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "receivedAt" TIMESTAMP(3),
  ADD COLUMN "createdById" UUID,
  ADD COLUMN "clientId" UUID,
  ADD COLUMN "productTypeId" UUID,
  ADD COLUMN "deliveryCompanyId" UUID;

-- Sequential, human-friendly order numbers starting at 1001, existing orders numbered by creation time
ALTER TABLE "Order" ADD COLUMN "orderNumber" INTEGER;
CREATE SEQUENCE "Order_orderNumber_seq" OWNED BY "Order"."orderNumber";
UPDATE "Order" o SET "orderNumber" = s.n
FROM (SELECT "id", 1000 + ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS n FROM "Order") s
WHERE o."id" = s."id";
SELECT setval('"Order_orderNumber_seq"', GREATEST(COALESCE((SELECT MAX("orderNumber") FROM "Order"), 1000), 1000));
ALTER TABLE "Order" ALTER COLUMN "orderNumber" SET DEFAULT nextval('"Order_orderNumber_seq"');
ALTER TABLE "Order" ALTER COLUMN "orderNumber" SET NOT NULL;
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order"("orderNumber");

-- Existing money: fully paid / received orders count as paid in full
UPDATE "Order" SET "amountPaid" = "price" WHERE "paymentDetail" = 'PAID' OR "status" = 'RECEIVED';
UPDATE "Order" SET "completedAt" = "updatedAt" WHERE "status" IN ('DONE', 'RECEIVED');
UPDATE "Order" SET "receivedAt" = "updatedAt" WHERE "status" = 'RECEIVED';
UPDATE "Order" SET "createdById" = "laborUserId" WHERE "laborUserId" IS NOT NULL;

-- Build the client database from past orders (phone numbers normalised to digits and +)
INSERT INTO "Client" ("id", "name", "phone", "createdAt", "updatedAt")
SELECT gen_random_uuid(), d."customerName", d.phone, d."firstAt", NOW()
FROM (
  SELECT DISTINCT ON (regexp_replace("phoneNumber", '[^0-9+]', '', 'g'))
    regexp_replace("phoneNumber", '[^0-9+]', '', 'g') AS phone,
    "customerName",
    MIN("createdAt") OVER (PARTITION BY regexp_replace("phoneNumber", '[^0-9+]', '', 'g')) AS "firstAt"
  FROM "Order"
  WHERE regexp_replace("phoneNumber", '[^0-9+]', '', 'g') <> ''
  ORDER BY regexp_replace("phoneNumber", '[^0-9+]', '', 'g'), "createdAt" DESC
) d;
UPDATE "Order" o SET "clientId" = c."id"
FROM "Client" c
WHERE c."phone" = regexp_replace(o."phoneNumber", '[^0-9+]', '', 'g');

ALTER TABLE "Order" ADD CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_productTypeId_fkey" FOREIGN KEY ("productTypeId") REFERENCES "ProductType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_deliveryCompanyId_fkey" FOREIGN KEY ("deliveryCompanyId") REFERENCES "DeliveryCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Order_laborUserId_idx" ON "Order"("laborUserId");
CREATE INDEX "Order_clientId_idx" ON "Order"("clientId");
CREATE INDEX "Order_deliveryCompanyId_deliverySettled_idx" ON "Order"("deliveryCompanyId", "deliverySettled");

-- Hand-off requests that need admin approval
CREATE TABLE "TransferRequest" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "fromUserId" UUID,
  "toUserId" UUID NOT NULL,
  "requestedById" UUID NOT NULL,
  "decidedById" UUID,
  "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedAt" TIMESTAMP(3),
  CONSTRAINT "TransferRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TransferRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TransferRequest_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TransferRequest_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TransferRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TransferRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "TransferRequest_status_idx" ON "TransferRequest"("status");
CREATE INDEX "TransferRequest_orderId_status_idx" ON "TransferRequest"("orderId", "status");

-- Expenses, delivery-company settlements and balance adjustments
CREATE TABLE "CashEntry" (
  "id" UUID NOT NULL,
  "type" "EntryType" NOT NULL,
  "method" "CashMethod" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "entryDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveryCompanyId" UUID,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashEntry_deliveryCompanyId_fkey" FOREIGN KEY ("deliveryCompanyId") REFERENCES "DeliveryCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CashEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "CashEntry_type_entryDate_idx" ON "CashEntry"("type", "entryDate");
