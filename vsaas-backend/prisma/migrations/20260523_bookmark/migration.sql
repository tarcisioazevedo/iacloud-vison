CREATE TABLE IF NOT EXISTS "Bookmark" (
  "id"         text PRIMARY KEY,
  "userId"     text NOT NULL,
  "cameraId"   text NOT NULL,
  "atTime"     timestamp(3) NOT NULL,
  "note"       text,
  "createdAt"  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "Bookmark_cameraId_atTime_idx"
  ON "Bookmark" ("cameraId", "atTime" DESC);
CREATE INDEX IF NOT EXISTS "Bookmark_userId_idx"
  ON "Bookmark" ("userId");
