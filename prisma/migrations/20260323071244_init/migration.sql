-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "S3Credential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'HETZNER',
    "endpoint" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "accessKeyEnc" TEXT NOT NULL,
    "secretKeyEnc" TEXT NOT NULL,
    "ivAccessKey" TEXT NOT NULL,
    "ivSecretKey" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "S3Credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileMetadata" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "extension" TEXT NOT NULL DEFAULT '',
    "size" BIGINT NOT NULL,
    "lastModified" TIMESTAMP(3) NOT NULL,
    "isFolder" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FileMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFileExtensionStat" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "extension" TEXT NOT NULL,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "totalSize" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserFileExtensionStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payload" JSONB NOT NULL,
    "progress" JSONB,
    "error" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "scheduleCron" TEXT,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "S3Credential_userId_idx" ON "S3Credential"("userId");

-- CreateIndex
CREATE INDEX "FileMetadata_userId_idx" ON "FileMetadata"("userId");

-- CreateIndex
CREATE INDEX "FileMetadata_credentialId_bucket_idx" ON "FileMetadata"("credentialId", "bucket");

-- CreateIndex
CREATE INDEX "FileMetadata_userId_extension_idx" ON "FileMetadata"("userId", "extension");

-- CreateIndex
CREATE UNIQUE INDEX "FileMetadata_credentialId_bucket_key_key" ON "FileMetadata"("credentialId", "bucket", "key");

-- CreateIndex
CREATE INDEX "UserFileExtensionStat_userId_idx" ON "UserFileExtensionStat"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserFileExtensionStat_userId_extension_key" ON "UserFileExtensionStat"("userId", "extension");

-- CreateIndex
CREATE INDEX "Task_status_nextRunAt_idx" ON "Task"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX "Task_type_idx" ON "Task"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Backup_key_key" ON "Backup"("key");

-- CreateIndex
CREATE INDEX "Backup_createdAt_idx" ON "Backup"("createdAt" DESC);

-- AddForeignKey
ALTER TABLE "S3Credential" ADD CONSTRAINT "S3Credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileMetadata" ADD CONSTRAINT "FileMetadata_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileMetadata" ADD CONSTRAINT "FileMetadata_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "S3Credential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFileExtensionStat" ADD CONSTRAINT "UserFileExtensionStat_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
