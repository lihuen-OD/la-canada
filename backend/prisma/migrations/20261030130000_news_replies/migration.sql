-- CreateTable
CREATE TABLE "news_replies" (
    "id" UUID NOT NULL,
    "news_report_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quoted_reply_id" UUID,

    CONSTRAINT "news_replies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "news_replies_news_report_id_created_at_id_idx" ON "news_replies"("news_report_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "news_replies_id_news_report_id_key" ON "news_replies"("id", "news_report_id");

-- AddForeignKey
ALTER TABLE "news_replies" ADD CONSTRAINT "news_replies_news_report_id_fkey" FOREIGN KEY ("news_report_id") REFERENCES "news_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_replies" ADD CONSTRAINT "news_replies_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_replies" ADD CONSTRAINT "news_replies_quoted_reply_id_news_report_id_fkey" FOREIGN KEY ("quoted_reply_id", "news_report_id") REFERENCES "news_replies"("id", "news_report_id") ON DELETE RESTRICT ON UPDATE CASCADE;
