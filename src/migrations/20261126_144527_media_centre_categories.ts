import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "media_centre_categories" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"_order" varchar,
  	"title" varchar NOT NULL,
  	"generate_slug" boolean DEFAULT true,
  	"slug" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  DROP INDEX "media_centre_category_idx";
  DROP INDEX "_media_centre_v_version_version_category_idx";
  ALTER TABLE "media_centre" ADD COLUMN "category_id" integer;
  ALTER TABLE "_media_centre_v" ADD COLUMN "version_category_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "media_centre_categories_id" integer;
  CREATE INDEX "media_centre_categories__order_idx" ON "media_centre_categories" USING btree ("_order");
  CREATE UNIQUE INDEX "media_centre_categories_slug_idx" ON "media_centre_categories" USING btree ("slug");
  CREATE INDEX "media_centre_categories_updated_at_idx" ON "media_centre_categories" USING btree ("updated_at");
  CREATE INDEX "media_centre_categories_created_at_idx" ON "media_centre_categories" USING btree ("created_at");
  ALTER TABLE "media_centre" ADD CONSTRAINT "media_centre_category_id_media_centre_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."media_centre_categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_media_centre_v" ADD CONSTRAINT "_media_centre_v_version_category_id_media_centre_ca_4ceb389f_fk" FOREIGN KEY ("version_category_id") REFERENCES "public"."media_centre_categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_centre_categories_fk" FOREIGN KEY ("media_centre_categories_id") REFERENCES "public"."media_centre_categories"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_media_centre_categories_id_idx" ON "payload_locked_documents_rels" USING btree ("media_centre_categories_id");
  -- The six tabs the old select field offered, in the website's tab order.
  INSERT INTO "media_centre_categories" ("_order", "title", "slug", "generate_slug") VALUES
    ('a0', 'Announcements', 'announcements', false),
    ('a1', 'Analyst & Awards', 'analyst-awards', false),
    ('a2', 'Partnerships', 'partnerships', false),
    ('a3', 'Customer Wins', 'customer-wins', false),
    ('a4', 'People & Culture', 'people-culture', false),
    ('a5', 'In The Press', 'in-the-press', false);
  UPDATE "media_centre" AS m SET "category_id" = c."id"
    FROM "media_centre_categories" AS c WHERE c."slug" = m."category"::text;
  UPDATE "_media_centre_v" AS v SET "version_category_id" = c."id"
    FROM "media_centre_categories" AS c WHERE c."slug" = v."version_category"::text;
  CREATE INDEX "media_centre_category_idx" ON "media_centre" USING btree ("category_id");
  CREATE INDEX "_media_centre_v_version_version_category_idx" ON "_media_centre_v" USING btree ("version_category_id");
  ALTER TABLE "media_centre" DROP COLUMN "category";
  ALTER TABLE "_media_centre_v" DROP COLUMN "version_category";
  DROP TYPE "public"."enum_media_centre_category";
  DROP TYPE "public"."enum__media_centre_v_version_category";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_media_centre_category" AS ENUM('announcements', 'analyst-awards', 'partnerships', 'customer-wins', 'people-culture', 'in-the-press');
  CREATE TYPE "public"."enum__media_centre_v_version_category" AS ENUM('announcements', 'analyst-awards', 'partnerships', 'customer-wins', 'people-culture', 'in-the-press');
  ALTER TABLE "media_centre" ADD COLUMN "category" "enum_media_centre_category";
  ALTER TABLE "_media_centre_v" ADD COLUMN "version_category" "enum__media_centre_v_version_category";
  UPDATE "media_centre" AS m SET "category" = c."slug"::"enum_media_centre_category"
    FROM "media_centre_categories" AS c
    WHERE c."id" = m."category_id"
      AND c."slug" IN ('announcements', 'analyst-awards', 'partnerships', 'customer-wins', 'people-culture', 'in-the-press');
  UPDATE "_media_centre_v" AS v SET "version_category" = c."slug"::"enum__media_centre_v_version_category"
    FROM "media_centre_categories" AS c
    WHERE c."id" = v."version_category_id"
      AND c."slug" IN ('announcements', 'analyst-awards', 'partnerships', 'customer-wins', 'people-culture', 'in-the-press');
  ALTER TABLE "media_centre_categories" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "media_centre_categories" CASCADE;
  ALTER TABLE "media_centre" DROP CONSTRAINT IF EXISTS "media_centre_category_id_media_centre_categories_id_fk";
  
  ALTER TABLE "_media_centre_v" DROP CONSTRAINT IF EXISTS "_media_centre_v_version_category_id_media_centre_ca_4ceb389f_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_media_centre_categories_fk";
  
  DROP INDEX "payload_locked_documents_rels_media_centre_categories_id_idx";
  DROP INDEX "media_centre_category_idx";
  DROP INDEX "_media_centre_v_version_version_category_idx";
  CREATE INDEX "media_centre_category_idx" ON "media_centre" USING btree ("category");
  CREATE INDEX "_media_centre_v_version_version_category_idx" ON "_media_centre_v" USING btree ("version_category");
  ALTER TABLE "media_centre" DROP COLUMN "category_id";
  ALTER TABLE "_media_centre_v" DROP COLUMN "version_category_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "media_centre_categories_id";`)
}
