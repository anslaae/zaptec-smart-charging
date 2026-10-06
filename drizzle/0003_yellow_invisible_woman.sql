CREATE TABLE "scheduler_heartbeat" (
	"id" text PRIMARY KEY NOT NULL,
	"last_tick_at" timestamp with time zone NOT NULL
);
