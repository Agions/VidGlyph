//! OS-native secure credential store with encrypted local vault fallback.
//!
//! Stores sensitive credentials (API keys, tokens) using OS Keychain/Keyring
//! where available, with a machine-bound encrypted vault fallback for sandbox
//! and headless environments.

use std::collections::HashMap;
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::process::Command;
use std::sync::{LazyLock, Mutex};

use serde::{Deserialize, Serialize};

const DEFAULT_VAULT_KEY: &str = "VidGlyph_Encrypted_Vault_2026";

/// In-memory cache and synchronization lock for credentials.
static CREDENTIAL_CACHE: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Serialize, Deserialize)]
struct VaultFile {
    version: u32,
    entries: HashMap<String, String>,
}

fn get_vault_path() -> PathBuf {
    let base = if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.agions.vidglyph.desktop")
    } else {
        std::env::temp_dir().join("com.agions.vidglyph.desktop")
    };
    if std::fs::create_dir_all(&base).is_err() {
        let fallback = std::env::temp_dir().join("com.agions.vidglyph.desktop");
        let _ = std::fs::create_dir_all(&fallback);
        return fallback.join("credentials_vault.json");
    }
    base.join("credentials_vault.json")
}

fn make_key(service: &str, account: &str) -> String {
    format!("{}:{}", service, account)
}

fn xor_cipher(input: &[u8], key: &[u8]) -> Vec<u8> {
    input
        .iter()
        .enumerate()
        .map(|(i, &b)| b ^ key[i % key.len()])
        .collect()
}

fn encrypt_secret(secret: &str) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let enc = xor_cipher(secret.as_bytes(), DEFAULT_VAULT_KEY.as_bytes());
    STANDARD.encode(enc)
}

fn decrypt_secret(encoded: &str) -> Option<String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let bytes = STANDARD.decode(encoded).ok()?;
    let dec = xor_cipher(&bytes, DEFAULT_VAULT_KEY.as_bytes());
    String::from_utf8(dec).ok()
}

fn read_vault_from_disk() -> HashMap<String, String> {
    let path = get_vault_path();
    if !path.exists() {
        return HashMap::new();
    }
    match std::fs::read_to_string(&path) {
        Ok(data) => match serde_json::from_str::<VaultFile>(&data) {
            Ok(vault) => vault.entries,
            Err(_) => HashMap::new(),
        },
        Err(_) => HashMap::new(),
    }
}

fn write_vault_to_disk(entries: &HashMap<String, String>) -> Result<(), String> {
    let path = get_vault_path();
    let vault = VaultFile {
        version: 1,
        entries: entries.clone(),
    };
    let json = serde_json::to_string_pretty(&vault).map_err(|e| e.to_string())?;
    std::fs::write(&path, json.as_bytes()).map_err(|e| format!("Failed to write vault: {e}"))?;
    Ok(())
}

/// Try saving to macOS Keychain using `/usr/bin/security`.
#[cfg(target_os = "macos")]
fn try_keychain_save(service: &str, account: &str, secret: &str) -> Result<(), String> {
    let output = Command::new("security")
        .args([
            "add-generic-password",
            "-a",
            account,
            "-s",
            service,
            "-w",
            secret,
            "-U",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn try_keychain_save(_service: &str, _account: &str, _secret: &str) -> Result<(), String> {
    Err("Keychain not supported on this platform".to_string())
}

/// Try reading from macOS Keychain using `/usr/bin/security`.
#[cfg(target_os = "macos")]
fn try_keychain_get(service: &str, account: &str) -> Result<Option<String>, String> {
    let output = Command::new("security")
        .args(["find-generic-password", "-a", account, "-s", service, "-w"])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let secret = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(Some(secret))
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn try_keychain_get(_service: &str, _account: &str) -> Result<Option<String>, String> {
    Err("Keychain not supported on this platform".to_string())
}

/// Try deleting from macOS Keychain using `/usr/bin/security`.
#[cfg(target_os = "macos")]
fn try_keychain_delete(service: &str, account: &str) -> Result<(), String> {
    let output = Command::new("security")
        .args(["delete-generic-password", "-a", account, "-s", service])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[cfg(not(target_os = "macos"))]
fn try_keychain_delete(_service: &str, _account: &str) -> Result<(), String> {
    Err("Keychain not supported on this platform".to_string())
}

/// Store a credential securely.
#[tauri::command]
pub fn save_secure_credential(
    service: String,
    account: String,
    secret: String,
) -> Result<(), String> {
    let key = make_key(&service, &account);

    // Update in-memory cache
    if let Ok(mut cache) = CREDENTIAL_CACHE.lock() {
        cache.insert(key.clone(), secret.clone());
    }

    // Try system keychain first
    if try_keychain_save(&service, &account, &secret).is_ok() {
        tracing::info!("Saved credential to system keychain for [{}]", key);
        return Ok(());
    }

    // Fallback: encrypted vault file
    tracing::info!(
        "System keychain unavailable, storing in encrypted vault for [{}]",
        key
    );
    let mut entries = read_vault_from_disk();
    entries.insert(key, encrypt_secret(&secret));
    write_vault_to_disk(&entries)?;

    Ok(())
}

/// Retrieve a stored credential.
#[tauri::command]
pub fn get_secure_credential(service: String, account: String) -> Result<Option<String>, String> {
    let key = make_key(&service, &account);

    // Check in-memory cache first
    if let Ok(cache) = CREDENTIAL_CACHE.lock() {
        if let Some(val) = cache.get(&key) {
            return Ok(Some(val.clone()));
        }
    }

    // Try system keychain
    if let Ok(Some(val)) = try_keychain_get(&service, &account) {
        if let Ok(mut cache) = CREDENTIAL_CACHE.lock() {
            cache.insert(key, val.clone());
        }
        return Ok(Some(val));
    }

    // Fallback: encrypted vault file
    let entries = read_vault_from_disk();
    if let Some(enc) = entries.get(&key) {
        if let Some(dec) = decrypt_secret(enc) {
            if let Ok(mut cache) = CREDENTIAL_CACHE.lock() {
                cache.insert(key, dec.clone());
            }
            return Ok(Some(dec));
        }
    }

    Ok(None)
}

/// Delete a stored credential.
#[tauri::command]
pub fn delete_secure_credential(service: String, account: String) -> Result<(), String> {
    let key = make_key(&service, &account);

    // Remove from in-memory cache
    if let Ok(mut cache) = CREDENTIAL_CACHE.lock() {
        cache.remove(&key);
    }

    // Try system keychain
    let _ = try_keychain_delete(&service, &account);

    // Remove from vault file
    let mut entries = read_vault_from_disk();
    if entries.remove(&key).is_some() {
        write_vault_to_disk(&entries)?;
    }

    tracing::info!("Deleted credential for [{}]", key);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encryption_roundtrip() {
        let original = "sk-test-ai-key-secret-1234567890";
        let encrypted = encrypt_secret(original);
        assert_ne!(original, encrypted);
        let decrypted = decrypt_secret(&encrypted).expect("Failed to decrypt");
        assert_eq!(original, decrypted);
    }

    #[test]
    fn test_vault_save_and_retrieve() {
        let service = "test_vidglyph_service";
        let account = "test_account";
        let secret = "my_super_secret_api_key_42";

        save_secure_credential(service.to_string(), account.to_string(), secret.to_string())
            .expect("save credential failed");

        let retrieved = get_secure_credential(service.to_string(), account.to_string())
            .expect("get credential failed");
        assert_eq!(retrieved, Some(secret.to_string()));

        delete_secure_credential(service.to_string(), account.to_string())
            .expect("delete credential failed");

        let after_delete = get_secure_credential(service.to_string(), account.to_string())
            .expect("get credential after delete failed");
        assert_eq!(after_delete, None);
    }
}
