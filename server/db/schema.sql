-- orange-invest v1 schema. Idempotent: every statement is IF NOT EXISTS, so `npm run db:init` can run
-- any number of times. There is no migration tool (v1 decision). Once a table has shipped, a change
-- to it needs a separate, reviewed ALTER.
--
-- Conventions:
--   money      BIGINT paise. amount_paise is always positive; direction says which way it moved.
--   txn_date   DATE, the calendar date in IST, exactly as the bank printed it.
--   timestamps DATETIME(3) in UTC (the server sets session time_zone = '+00:00').
--   scoping    every user-owned row carries user_id, and every query filters on it.

CREATE TABLE IF NOT EXISTS users (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email       VARCHAR(254)    NOT NULL,
  role        ENUM('user','admin') NOT NULL DEFAULT 'user' COMMENT 'added in BE-009; db-init adds it to older tables',
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS uploads (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id         BIGINT UNSIGNED NOT NULL,
  filename        VARCHAR(255)    NOT NULL,
  file_hash       CHAR(64)        NOT NULL COMMENT 'sha256 of the file bytes',
  source_format   VARCHAR(40)     NOT NULL COMMENT 'parser that read it, e.g. bank-csv',
  rows_total      INT UNSIGNED    NOT NULL DEFAULT 0,
  rows_inserted   INT UNSIGNED    NOT NULL DEFAULT 0,
  rows_duplicate  INT UNSIGNED    NOT NULL DEFAULT 0,
  rows_rejected   INT UNSIGNED    NOT NULL DEFAULT 0,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_uploads_user_created (user_id, created_at),
  CONSTRAINT fk_uploads_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS transactions (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id          BIGINT UNSIGNED NOT NULL,
  upload_id        BIGINT UNSIGNED NOT NULL COMMENT 'the upload that first inserted this row',
  source           VARCHAR(40)     NOT NULL,
  txn_date         DATE            NOT NULL,
  description_raw  VARCHAR(500)    NOT NULL,
  merchant         VARCHAR(120)    NULL,
  category         VARCHAR(40)     NOT NULL,
  amount_paise     BIGINT UNSIGNED NOT NULL,
  direction        ENUM('debit','credit') NOT NULL,
  balance_paise    BIGINT          NULL COMMENT 'signed: overdraft balances are negative',
  channel          ENUM('UPI','NEFT','IMPS','RTGS','CARD','ATM','CASH','CHEQUE','OTHER') NOT NULL DEFAULT 'OTHER',
  ref              VARCHAR(64)     NULL,
  raw_json         JSON            NOT NULL COMMENT 'the original CSV row, kept so it can be re-parsed',
  dedup_hash       CHAR(64)        NOT NULL COMMENT 'sha256 of the normalised identity fields',
  created_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_txn_user_dedup (user_id, dedup_hash),
  KEY idx_txn_user_date (user_id, txn_date),
  KEY idx_txn_user_category (user_id, category),
  KEY idx_txn_upload (upload_id),
  CONSTRAINT chk_txn_amount_positive CHECK (amount_paise > 0),
  CONSTRAINT fk_txn_user   FOREIGN KEY (user_id)   REFERENCES users (id)   ON DELETE CASCADE,
  CONSTRAINT fk_txn_upload FOREIGN KEY (upload_id) REFERENCES uploads (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- One classification per normalised merchant key, shared by all users, so each merchant is sent to
-- the LLM at most once. 'rule' rows come from the keyword map and 'llm' rows from the fallback.
CREATE TABLE IF NOT EXISTS merchant_categories (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  merchant_key  VARCHAR(120)    NOT NULL,
  category      VARCHAR(40)     NOT NULL,
  source        ENUM('rule','llm') NOT NULL,
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_merchant_key (merchant_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS conversations (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NOT NULL,
  title       VARCHAR(60)     NULL,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_conv_user_updated (user_id, updated_at),
  CONSTRAINT fk_conv_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS messages (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  conversation_id  BIGINT UNSIGNED NOT NULL,
  user_id          BIGINT UNSIGNED NOT NULL COMMENT 'denormalised so every read can scope by user',
  role             ENUM('user','assistant') NOT NULL,
  content          MEDIUMTEXT      NOT NULL,
  tool_calls_json  JSON            NULL COMMENT 'assistant only: tool calls and results, for tracing; never sent to the client',
  created_at       DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_msg_conv (conversation_id, id),
  KEY idx_msg_user (user_id),
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_user FOREIGN KEY (user_id)         REFERENCES users (id)         ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- AI observability (BE-009) ----------
-- One row per chat turn. Filtered and summed fields are typed columns. Provider error messages
-- are never stored: only the error class and the HTTP status.
CREATE TABLE IF NOT EXISTS ai_traces (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id               BIGINT UNSIGNED NOT NULL,
  conversation_id       BIGINT UNSIGNED NOT NULL,
  user_message_id       BIGINT UNSIGNED NULL,
  assistant_message_id  BIGINT UNSIGNED NULL,
  status                ENUM('IN_PROGRESS','SUCCEEDED','FAILED') NOT NULL DEFAULT 'IN_PROGRESS',
  error_stage           VARCHAR(20)     NULL COMMENT 'model | tool | record | internal',
  error_class           VARCHAR(64)     NULL,
  provider_http_status  SMALLINT        NULL,
  model                 VARCHAR(64)     NOT NULL,
  prompt_version        VARCHAR(16)     NOT NULL,
  rounds                SMALLINT        NOT NULL DEFAULT 0,
  tokens_in             INT UNSIGNED    NOT NULL DEFAULT 0,
  tokens_out            INT UNSIGNED    NOT NULL DEFAULT 0,
  latency_ms            INT UNSIGNED    NULL,
  created_at            DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at           DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_trace_created (created_at),
  KEY idx_trace_status_created (status, created_at),
  KEY idx_trace_conv (conversation_id, id),
  KEY idx_trace_user_created (user_id, created_at),
  CONSTRAINT fk_trace_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_trace_conv FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_trace_umsg FOREIGN KEY (user_message_id) REFERENCES messages (id) ON DELETE SET NULL,
  CONSTRAINT fk_trace_amsg FOREIGN KEY (assistant_message_id) REFERENCES messages (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- seq is shared by model and tool calls within a trace, so the timeline interleaves them in order.
CREATE TABLE IF NOT EXISTS ai_model_calls (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  trace_id              BIGINT UNSIGNED NOT NULL,
  seq                   SMALLINT        NOT NULL,
  model                 VARCHAR(64)     NOT NULL,
  status                ENUM('IN_PROGRESS','SUCCEEDED','FAILED') NOT NULL DEFAULT 'IN_PROGRESS',
  tokens_in             INT UNSIGNED    NULL,
  tokens_out            INT UNSIGNED    NULL,
  latency_ms            INT UNSIGNED    NULL,
  finish_reason         VARCHAR(32)     NULL,
  requested_tools       SMALLINT        NOT NULL DEFAULT 0,
  error_class           VARCHAR(64)     NULL,
  provider_http_status  SMALLINT        NULL,
  created_at            DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_model_call_seq (trace_id, seq),
  CONSTRAINT fk_model_call_trace FOREIGN KEY (trace_id) REFERENCES ai_traces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_tool_calls (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  trace_id           BIGINT UNSIGNED NOT NULL,
  seq                SMALLINT        NOT NULL,
  round              SMALLINT        NOT NULL,
  name               VARCHAR(64)     NOT NULL,
  args_json          JSON            NULL COMMENT 'scrubbed; {"invalidJson":true} when the model sent bad JSON',
  validation_status  ENUM('OK','REJECTED') NULL,
  result_json        JSON            NULL COMMENT 'summary, capped at 4 KB',
  status             ENUM('IN_PROGRESS','SUCCEEDED','FAILED','REJECTED') NOT NULL DEFAULT 'IN_PROGRESS',
  latency_ms         INT UNSIGNED    NULL,
  error              VARCHAR(300)    NULL COMMENT 'our validation message, or an error class; never provider text',
  created_at         DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tool_call_seq (trace_id, seq),
  KEY idx_tool_call_name (name),
  CONSTRAINT fk_tool_call_trace FOREIGN KEY (trace_id) REFERENCES ai_traces (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS ai_trace_reviews (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  trace_id     BIGINT UNSIGNED NOT NULL,
  verdict      ENUM('good','bad','needs_fix') NOT NULL,
  note         VARCHAR(2000)   NOT NULL DEFAULT '',
  reviewer_id  BIGINT UNSIGNED NULL,
  version      INT UNSIGNED    NOT NULL DEFAULT 1,
  updated_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_review_trace (trace_id),
  CONSTRAINT fk_review_trace FOREIGN KEY (trace_id) REFERENCES ai_traces (id) ON DELETE CASCADE,
  CONSTRAINT fk_review_user FOREIGN KEY (reviewer_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- Evals (BE-010) ----------
CREATE TABLE IF NOT EXISTS eval_runs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  label           VARCHAR(120)    NULL,
  model           VARCHAR(64)     NOT NULL,
  prompt_version  VARCHAR(16)     NOT NULL,
  status          ENUM('RUNNING','FINISHED','BLOCKED') NOT NULL DEFAULT 'RUNNING',
  cases_total     INT UNSIGNED    NOT NULL DEFAULT 0,
  cases_passed    INT UNSIGNED    NOT NULL DEFAULT 0,
  cases_failed    INT UNSIGNED    NOT NULL DEFAULT 0,
  cases_blocked   INT UNSIGNED    NOT NULL DEFAULT 0,
  started_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at     DATETIME(3)     NULL,
  PRIMARY KEY (id),
  KEY idx_eval_run_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS eval_results (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  run_id       BIGINT UNSIGNED NOT NULL,
  case_id      VARCHAR(64)     NOT NULL,
  risk         ENUM('high','normal') NOT NULL,
  persona      VARCHAR(254)    NOT NULL,
  attempt      SMALLINT        NOT NULL,
  verdict      ENUM('pass','fail','blocked') NOT NULL,
  gates_json   JSON            NOT NULL,
  answer_text  MEDIUMTEXT      NULL,
  trace_id     BIGINT UNSIGNED NULL COMMENT 'no FK: a trace may be deleted later; the result stays',
  latency_ms   INT UNSIGNED    NULL,
  created_at   DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_eval_result (run_id, case_id, attempt),
  CONSTRAINT fk_eval_result_run FOREIGN KEY (run_id) REFERENCES eval_runs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
