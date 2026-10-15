CREATE TABLE signup_verification_policy (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  activated_at TEXT
);
INSERT INTO signup_verification_policy(singleton, activated_at) VALUES(1, NULL);

CREATE TABLE signup_verification_legacy_users (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE signup_verification_identities (
  google_sub TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  verified_at TEXT,
  delivery_window_start TEXT NOT NULL,
  delivery_attempts INTEGER NOT NULL DEFAULT 0,
  next_delivery_at TEXT,
  delivery_lease TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE signup_verification_flows (
  id TEXT PRIMARY KEY,
  google_sub TEXT NOT NULL REFERENCES signup_verification_identities(google_sub) ON DELETE CASCADE,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose = 'SIGNUP'),
  browser_hash TEXT NOT NULL,
  csrf_hash TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  link_hash TEXT UNIQUE,
  link_expires_at TEXT,
  consumed_at TEXT,
  confirmation_receipt TEXT,
  superseded_at TEXT,
  delivery_status TEXT NOT NULL CHECK(delivery_status IN ('READY','SENDING','ACCEPTED','FAILED','UNCERTAIN','NOT_CONFIGURED')),
  delivery_attempt_id TEXT,
  provider_message_id TEXT,
  failure_code TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX signup_verification_flow_subject_idx ON signup_verification_flows(google_sub, email);
CREATE INDEX signup_verification_flow_expiry_idx ON signup_verification_flows(expires_at);

CREATE TRIGGER signup_verification_user_soft_deleted AFTER UPDATE OF deleted_at ON users WHEN NEW.deleted_at IS NOT NULL BEGIN DELETE FROM signup_verification_legacy_users WHERE user_id = NEW.id; DELETE FROM signup_verification_identities WHERE google_sub = NEW.google_sub; END;

CREATE TRIGGER signup_verification_user_deleted AFTER DELETE ON users BEGIN DELETE FROM signup_verification_identities WHERE google_sub = OLD.google_sub; END;
