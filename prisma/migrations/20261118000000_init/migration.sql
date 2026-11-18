CREATE TYPE "Role" AS ENUM ('ADMIN', 'STAFF');
CREATE TYPE "PaymentDetail" AS ENUM ('PAID', 'NOT_PAID', 'DOWN_PAYMENT');
CREATE TYPE "ReceivingMethod" AS ENUM ('DELIVERY', 'LOCAL_DELIVERY', 'PICK_UP', 'RECEIVED');
CREATE TYPE "OrderStatus" AS ENUM ('IN_PROGRESS', 'DONE', 'CANCELED', 'RECEIVED');

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'STAFF',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Order" (
  "id" UUID NOT NULL,
  "orderDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "laborName" TEXT NOT NULL,
  "customerName" TEXT NOT NULL,
  "phoneNumber" TEXT NOT NULL,
  "orderDetail" TEXT NOT NULL,
  "price" DECIMAL(12,2) NOT NULL,
  "paymentDetail" "PaymentDetail" NOT NULL DEFAULT 'NOT_PAID',
  "receivingMethod" "ReceivingMethod" NOT NULL DEFAULT 'PICK_UP',
  "paymentMethod" TEXT NOT NULL DEFAULT 'Cash',
  "status" "OrderStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "laborUserId" UUID,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Order_laborUserId_fkey" FOREIGN KEY ("laborUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_receivingMethod_status_idx" ON "Order"("receivingMethod", "status");
CREATE INDEX "Order_orderDate_idx" ON "Order"("orderDate");
CREATE INDEX "Order_laborName_idx" ON "Order"("laborName");
