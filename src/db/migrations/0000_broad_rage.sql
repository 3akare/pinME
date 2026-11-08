CREATE TABLE "burned_pins" (
	"pin" char(8) PRIMARY KEY NOT NULL,
	"sign_public_key" text NOT NULL,
	"burned_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"pin_low" char(8) NOT NULL,
	"pin_high" char(8) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_pin_low_pin_high_pk" PRIMARY KEY("pin_low","pin_high"),
	CONSTRAINT "ordered" CHECK ("contacts"."pin_low" < "contacts"."pin_high")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_pin" char(8) NOT NULL,
	"to_pin" char(8) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pins" (
	"pin" char(8) PRIMARY KEY NOT NULL,
	"box_public_key" text NOT NULL,
	"sign_public_key" text NOT NULL,
	"display_name" varchar(32) NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"personal_message" varchar(80) DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "used_nonces" (
	"pin" char(8) NOT NULL,
	"nonce" text NOT NULL,
	"used_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "used_nonces_pin_nonce_pk" PRIMARY KEY("pin","nonce")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invites_pair" ON "invites" USING btree (least("from_pin", "to_pin"),greatest("from_pin", "to_pin"));