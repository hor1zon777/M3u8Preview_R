-- 为动态解析源增加元数据字段。
-- m3u8Url 继续作为“最近一次解析出的可播放地址”缓存使用。
ALTER TABLE "media" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'DIRECT_M3U8';
ALTER TABLE "media" ADD COLUMN "sourceOriginalUrl" TEXT;
ALTER TABLE "media" ADD COLUMN "sourcePlugin" TEXT;
ALTER TABLE "media" ADD COLUMN "sourceResolvedAt" DATETIME;
ALTER TABLE "media" ADD COLUMN "sourceLastError" TEXT;
ALTER TABLE "media" ADD COLUMN "sourceMeta" TEXT;

CREATE INDEX "media_sourceType_idx" ON "media"("sourceType");
CREATE INDEX "media_sourcePlugin_idx" ON "media"("sourcePlugin");
