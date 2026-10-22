-- One image costs ~200 app credits; 1000 ran out after a handful of demo turns.
ALTER TABLE "User" ALTER COLUMN "credits" SET DEFAULT 100000;
UPDATE "User" SET "credits" = 100000 WHERE "credits" < 100000;
