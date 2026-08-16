CREATE TABLE "civilon_db_probe" (
	"id" serial PRIMARY KEY,
	"probe_key" text NOT NULL UNIQUE,
	"probe_value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
