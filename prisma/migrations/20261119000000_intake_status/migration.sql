-- New enum values must be committed before they can be used, so this lives in its own migration.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'INTAKE' BEFORE 'IN_PROGRESS';
