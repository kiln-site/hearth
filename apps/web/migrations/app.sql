CREATE TABLE IF NOT EXISTS kiln_relay (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  hostname VARCHAR(253) NOT NULL,
  port SMALLINT UNSIGNED NOT NULL DEFAULT 4100,
  use_tls BOOLEAN NOT NULL DEFAULT TRUE,
  token_ciphertext TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_connected_at TIMESTAMP(3) NULL,
  last_error VARCHAR(512) NULL,
  managed_ember_count INT UNSIGNED NULL,
  node_arch VARCHAR(32) NULL,
  node_platform VARCHAR(32) NULL,
  node_version VARCHAR(120) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY kiln_relay_endpoint_unique (hostname, port)
);

CREATE TABLE IF NOT EXISTS kiln_setting (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NULL,
  setting_key VARCHAR(191) NOT NULL,
  setting_value JSON NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY kiln_setting_scope_unique (user_id, setting_key)
);

CREATE TABLE IF NOT EXISTS kiln_instance (
  relay_id CHAR(36) NOT NULL,
  instance_id CHAR(40) NOT NULL,
  display_name VARCHAR(120) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (relay_id, instance_id),
  UNIQUE KEY kiln_instance_relay_name_unique (relay_id, display_name),
  CONSTRAINT kiln_instance_relay_fk
    FOREIGN KEY (relay_id) REFERENCES kiln_relay (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kiln_file_activity (
  relay_id CHAR(36) NOT NULL,
  instance_id CHAR(40) NOT NULL,
  path_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  path VARCHAR(2048) NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  last_viewed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_edited_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (relay_id, instance_id, path_hash),
  KEY kiln_file_activity_recent_idx (relay_id, instance_id, pinned, last_viewed_at),
  CONSTRAINT kiln_file_activity_instance_fk
    FOREIGN KEY (relay_id, instance_id)
    REFERENCES kiln_instance (relay_id, instance_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS kiln_auth_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(36) NULL,
  event VARCHAR(120) NOT NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  metadata JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY kiln_auth_audit_user_created_idx (user_id, created_at)
);

CREATE TABLE IF NOT EXISTS kiln_access_grant (
  id CHAR(36) NOT NULL PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  relay_id CHAR(36) NOT NULL,
  resource_type ENUM('relay', 'instance') NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  role ENUM('owner', 'admin', 'operator', 'viewer') NOT NULL,
  granted_by VARCHAR(36) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY kiln_access_grant_scope_unique (user_id, relay_id, resource_type, resource_id),
  KEY kiln_access_grant_relay_resource_idx (relay_id, resource_type, resource_id),
  KEY kiln_access_grant_user_idx (user_id)
);

CREATE TABLE IF NOT EXISTS kiln_invitation (
  id CHAR(36) NOT NULL PRIMARY KEY,
  token_hash CHAR(64) NOT NULL,
  email VARCHAR(320) NOT NULL,
  relay_id CHAR(36) NOT NULL,
  instance_id VARCHAR(64) NULL,
  role ENUM('owner', 'admin', 'operator', 'viewer') NOT NULL,
  invited_by VARCHAR(36) NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  accepted_at TIMESTAMP(3) NULL,
  revoked_at TIMESTAMP(3) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY kiln_invitation_token_unique (token_hash),
  KEY kiln_invitation_email_pending_idx (email, expires_at),
  KEY kiln_invitation_relay_idx (relay_id, created_at)
);
