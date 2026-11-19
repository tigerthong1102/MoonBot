ALTER TABLE "user" ADD COLUMN product_updates INTEGER CHECK (product_updates IN (0, 1));
