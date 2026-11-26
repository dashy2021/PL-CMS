import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_media_centre_link_type" AS ENUM('file', 'external');
  CREATE TYPE "public"."enum_media_centre_category" AS ENUM('announcements', 'analyst-awards', 'partnerships', 'customer-wins', 'people-culture', 'in-the-press');
  CREATE TYPE "public"."enum_media_centre_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__media_centre_v_version_link_type" AS ENUM('file', 'external');
  CREATE TYPE "public"."enum__media_centre_v_version_category" AS ENUM('announcements', 'analyst-awards', 'partnerships', 'customer-wins', 'people-culture', 'in-the-press');
  CREATE TYPE "public"."enum__media_centre_v_version_status" AS ENUM('draft', 'published');
  CREATE TABLE "media_centre" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"excerpt" varchar,
  	"image_id" integer,
  	"link_type" "enum_media_centre_link_type" DEFAULT 'file',
  	"file_id" integer,
  	"url" varchar,
  	"featured" boolean DEFAULT false,
  	"featured_image_id" integer,
  	"category" "enum_media_centre_category",
  	"published_at" timestamp(3) with time zone,
  	"read_time" varchar,
  	"generate_slug" boolean DEFAULT true,
  	"slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_media_centre_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "_media_centre_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_title" varchar,
  	"version_excerpt" varchar,
  	"version_image_id" integer,
  	"version_link_type" "enum__media_centre_v_version_link_type" DEFAULT 'file',
  	"version_file_id" integer,
  	"version_url" varchar,
  	"version_featured" boolean DEFAULT false,
  	"version_featured_image_id" integer,
  	"version_category" "enum__media_centre_v_version_category",
  	"version_published_at" timestamp(3) with time zone,
  	"version_read_time" varchar,
  	"version_generate_slug" boolean DEFAULT true,
  	"version_slug" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__media_centre_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  ALTER TABLE "media" ADD COLUMN "_objectkey" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "media_centre_id" integer;
  ALTER TABLE "media_centre" ADD CONSTRAINT "media_centre_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "media_centre" ADD CONSTRAINT "media_centre_file_id_media_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "media_centre" ADD CONSTRAINT "media_centre_featured_image_id_media_id_fk" FOREIGN KEY ("featured_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_media_centre_v" ADD CONSTRAINT "_media_centre_v_parent_id_media_centre_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."media_centre"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_media_centre_v" ADD CONSTRAINT "_media_centre_v_version_image_id_media_id_fk" FOREIGN KEY ("version_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_media_centre_v" ADD CONSTRAINT "_media_centre_v_version_file_id_media_id_fk" FOREIGN KEY ("version_file_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_media_centre_v" ADD CONSTRAINT "_media_centre_v_version_featured_image_id_media_id_fk" FOREIGN KEY ("version_featured_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "media_centre_image_idx" ON "media_centre" USING btree ("image_id");
  CREATE INDEX "media_centre_file_idx" ON "media_centre" USING btree ("file_id");
  CREATE INDEX "media_centre_featured_idx" ON "media_centre" USING btree ("featured");
  CREATE INDEX "media_centre_featured_image_idx" ON "media_centre" USING btree ("featured_image_id");
  CREATE INDEX "media_centre_category_idx" ON "media_centre" USING btree ("category");
  CREATE INDEX "media_centre_published_at_idx" ON "media_centre" USING btree ("published_at");
  CREATE UNIQUE INDEX "media_centre_slug_idx" ON "media_centre" USING btree ("slug");
  CREATE INDEX "media_centre_updated_at_idx" ON "media_centre" USING btree ("updated_at");
  CREATE INDEX "media_centre_created_at_idx" ON "media_centre" USING btree ("created_at");
  CREATE INDEX "media_centre__status_idx" ON "media_centre" USING btree ("_status");
  CREATE INDEX "_media_centre_v_parent_idx" ON "_media_centre_v" USING btree ("parent_id");
  CREATE INDEX "_media_centre_v_version_version_image_idx" ON "_media_centre_v" USING btree ("version_image_id");
  CREATE INDEX "_media_centre_v_version_version_file_idx" ON "_media_centre_v" USING btree ("version_file_id");
  CREATE INDEX "_media_centre_v_version_version_featured_idx" ON "_media_centre_v" USING btree ("version_featured");
  CREATE INDEX "_media_centre_v_version_version_featured_image_idx" ON "_media_centre_v" USING btree ("version_featured_image_id");
  CREATE INDEX "_media_centre_v_version_version_category_idx" ON "_media_centre_v" USING btree ("version_category");
  CREATE INDEX "_media_centre_v_version_version_published_at_idx" ON "_media_centre_v" USING btree ("version_published_at");
  CREATE INDEX "_media_centre_v_version_version_slug_idx" ON "_media_centre_v" USING btree ("version_slug");
  CREATE INDEX "_media_centre_v_version_version_updated_at_idx" ON "_media_centre_v" USING btree ("version_updated_at");
  CREATE INDEX "_media_centre_v_version_version_created_at_idx" ON "_media_centre_v" USING btree ("version_created_at");
  CREATE INDEX "_media_centre_v_version_version__status_idx" ON "_media_centre_v" USING btree ("version__status");
  CREATE INDEX "_media_centre_v_created_at_idx" ON "_media_centre_v" USING btree ("created_at");
  CREATE INDEX "_media_centre_v_updated_at_idx" ON "_media_centre_v" USING btree ("updated_at");
  CREATE INDEX "_media_centre_v_latest_idx" ON "_media_centre_v" USING btree ("latest");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_centre_fk" FOREIGN KEY ("media_centre_id") REFERENCES "public"."media_centre"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_media_centre_id_idx" ON "payload_locked_documents_rels" USING btree ("media_centre_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "media_centre" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_media_centre_v" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "media_centre" CASCADE;
  DROP TABLE "_media_centre_v" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_media_centre_fk";
  
  DROP INDEX "payload_locked_documents_rels_media_centre_id_idx";
  ALTER TABLE "media" DROP COLUMN "_objectkey";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "media_centre_id";
  DROP TYPE "public"."enum_media_centre_link_type";
  DROP TYPE "public"."enum_media_centre_category";
  DROP TYPE "public"."enum_media_centre_status";
  DROP TYPE "public"."enum__media_centre_v_version_link_type";
  DROP TYPE "public"."enum__media_centre_v_version_category";
  DROP TYPE "public"."enum__media_centre_v_version_status";`)
}
