CREATE TABLE "video_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" uuid NOT NULL,
	"asset_key" text NOT NULL,
	"storage_path" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"duration_milliseconds" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"frame_rate" double precision NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "video_assets" ADD CONSTRAINT "video_assets_share_id_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "video_assets_share_asset_unique" ON "video_assets" USING btree ("share_id","asset_key");--> statement-breakpoint
CREATE INDEX "video_assets_share_idx" ON "video_assets" USING btree ("share_id");