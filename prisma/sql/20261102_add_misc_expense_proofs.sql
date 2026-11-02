-- Additional proof files for miscellaneous expenses. Existing bill columns
-- remain the first attachment for backward compatibility.
BEGIN;

CREATE TABLE IF NOT EXISTS "MiscellaneousExpenseProof" (
    "id"         TEXT             NOT NULL,
    "expenseId"  TEXT             NOT NULL,
    "path"       TEXT             NOT NULL,
    "name"       TEXT             NOT NULL,
    "type"       TEXT             NOT NULL,
    "size"       INTEGER          NOT NULL,
    "uploadedAt" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT,

    CONSTRAINT "MiscellaneousExpenseProof_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MiscellaneousExpenseProof_expenseId_fkey"
        FOREIGN KEY ("expenseId") REFERENCES "MiscellaneousExpense"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "MiscellaneousExpenseProof_path_key"
    ON "MiscellaneousExpenseProof"("path");
CREATE INDEX IF NOT EXISTS "MiscellaneousExpenseProof_expenseId_uploadedAt_idx"
    ON "MiscellaneousExpenseProof"("expenseId", "uploadedAt");

COMMIT;
