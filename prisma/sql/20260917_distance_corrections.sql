CREATE TABLE "DistanceCorrection" (
  "id" TEXT NOT NULL, "journeyId" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "originalDistanceKm" DOUBLE PRECISION NOT NULL, "submittedDistanceKm" DOUBLE PRECISION NOT NULL, "finalDistanceKm" DOUBLE PRECISION, "screenshotPath" TEXT NOT NULL, "screenshotName" TEXT NOT NULL, "screenshotType" TEXT NOT NULL, "screenshotSize" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "differenceKm" DOUBLE PRECISION NOT NULL, "differencePercent" DOUBLE PRECISION NOT NULL, "endpointMatch" BOOLEAN NOT NULL DEFAULT false, "usableGpsPoints" INTEGER NOT NULL DEFAULT 0, "suspiciousActivity" BOOLEAN NOT NULL DEFAULT false, "reviewReason" TEXT, "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedAt" TIMESTAMP(3), "reviewedById" TEXT, "adminNote" TEXT, CONSTRAINT "DistanceCorrection_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DistanceCorrection_journeyId_key" ON "DistanceCorrection"("journeyId");
CREATE INDEX "DistanceCorrection_employeeId_status_idx" ON "DistanceCorrection"("employeeId", "status");
CREATE INDEX "DistanceCorrection_status_submittedAt_idx" ON "DistanceCorrection"("status", "submittedAt");
ALTER TABLE "DistanceCorrection" ADD CONSTRAINT "DistanceCorrection_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DistanceCorrection" ADD CONSTRAINT "DistanceCorrection_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
