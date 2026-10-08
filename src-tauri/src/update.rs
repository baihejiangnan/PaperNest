//! GitHub Release based updater.
//!
//! Windows installed builds download a signed MSI to PaperNest's local update
//! cache and launch it in passive mode. Portable builds download a signed new
//! EXE beside the currently running EXE and never overwrite the running file.
//! All network traffic shares PaperNest's explicit HTTP/HTTPS/SOCKS5 proxy layer.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use minisign_verify::{PublicKey, Signature};
use reqwest::header::{ACCEPT, CONTENT_LENGTH, USER_AGENT};
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::{
    portable::{self, InstallMode},
    proxy::{network_client, USER_AGENT_VALUE},
};

const RELEASES_URL: &str = "https://github.com/baihejiangnan/PaperNest/releases";
const LATEST_MANIFEST_URL: &str =
    "https://github.com/baihejiangnan/PaperNest/releases/latest/download/latest.json";
const UPDATE_PUBLIC_KEY: &str = include_str!("../updater.pub");
const MAX_UPDATE_BYTES: usize = 512 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone)]
struct UpdateAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Debug, Clone, Deserialize)]
struct UpdateManifest {
    version: String,
    #[serde(default)]
    notes: String,
    pub_date: Option<String>,
    #[serde(default)]
    platforms: HashMap<String, ManifestArtifact>,
}

#[derive(Debug, Clone, Deserialize)]
struct ManifestArtifact {
    url: String,
    signature: String,
    size: Option<u64>,
}

struct UpdatePackage {
    asset: UpdateAsset,
    signature: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub mode: String,
    pub release_url: String,
    pub notes: String,
    pub published_at: Option<String>,
    pub can_download: bool,
    pub asset_name: Option<String>,
    pub asset_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedUpdate {
    pub version: String,
    pub mode: String,
    pub path: String,
    pub already_downloaded: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDownloadProgress {
    downloaded: u64,
    total: u64,
}

fn parse_version(value: &str) -> Result<Version, String> {
    Version::parse(value.trim().trim_start_matches('v'))
        .map_err(|e| format!("invalid release version '{value}': {e}"))
}

fn mode_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        match portable::current_mode() {
            InstallMode::Portable => "portable",
            InstallMode::Installed => "installed",
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        "unsupported"
    }
}

fn artifact_names(version: &str, mode: &str) -> Option<(String, String)> {
    match mode {
        "portable" => {
            let name = format!("PaperNest-{version}.exe");
            Some((name.clone(), format!("{name}.sig")))
        }
        "installed" => {
            let name = format!("PaperNest_{version}_x64.msi");
            Some((name.clone(), format!("{name}.sig")))
        }
        _ => None,
    }
}

fn manifest_package(
    manifest: &UpdateManifest,
    mode: &str,
) -> Result<Option<UpdatePackage>, String> {
    let version = parse_version(&manifest.version)?.to_string();
    let Some((name, _)) = artifact_names(&version, mode) else {
        return Ok(None);
    };
    let key = match mode {
        "installed" => "windows-x86_64",
        "portable" => "windows-x86_64-portable",
        _ => return Ok(None),
    };
    let url = format!("{RELEASES_URL}/download/v{version}/{name}");
    if let Some(artifact) = manifest.platforms.get(key) {
        if artifact.url != url {
            return Err(format!("unexpected update URL for {key}"));
        }
        if artifact
            .size
            .is_some_and(|size| size > MAX_UPDATE_BYTES as u64)
        {
            return Err("update package is unexpectedly large".to_string());
        }
        if artifact.signature.trim().is_empty() {
            return Ok(None);
        }
        return Ok(Some(UpdatePackage {
            asset: UpdateAsset {
                name,
                browser_download_url: url,
                size: artifact.size.unwrap_or(0),
            },
            signature: Some(artifact.signature.trim().to_string()),
        }));
    }
    // Releases through v0.1.6 only list the MSI in latest.json, but publish
    // both signed Windows artifacts. Fetch the EXE's .sig at download time;
    // never infer its signature from the MSI or skip verification.
    if mode == "portable" && manifest_package(manifest, "installed")?.is_some() {
        return Ok(Some(UpdatePackage {
            asset: UpdateAsset {
                name,
                browser_download_url: url,
                size: 0,
            },
            signature: None,
        }));
    }
    Ok(None)
}

fn parse_manifest(text: &str) -> Result<UpdateManifest, String> {
    // Windows PowerShell's UTF-8 output in older releases includes a BOM.
    let manifest: UpdateManifest = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("invalid update metadata: {e}"))?;
    parse_version(&manifest.version)?;
    Ok(manifest)
}

async fn fetch_latest_manifest(
    proxy_enabled: bool,
    proxy_url: &str,
) -> Result<UpdateManifest, String> {
    let client = network_client(proxy_enabled, proxy_url, Duration::from_secs(15))?;
    let mut response = client
        .get(LATEST_MANIFEST_URL)
        .header(USER_AGENT, USER_AGENT_VALUE)
        .header(ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| format!("could not connect to GitHub: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "update metadata returned HTTP {} while checking for updates",
            response.status()
        ));
    }

    let mut data = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("could not read update metadata: {e}"))?
    {
        if data.len().saturating_add(chunk.len()) > MAX_MANIFEST_BYTES {
            return Err("update metadata is unexpectedly large".to_string());
        }
        data.extend_from_slice(&chunk);
    }
    let text =
        std::str::from_utf8(&data).map_err(|e| format!("invalid update metadata encoding: {e}"))?;
    parse_manifest(text)
}

fn release_info(
    manifest: &UpdateManifest,
    current_version: &str,
    mode: &str,
) -> Result<UpdateInfo, String> {
    let current = parse_version(current_version)?;
    let latest = parse_version(&manifest.version)?;
    let update_available = latest > current;
    let latest_version = latest.to_string();

    let package = manifest_package(manifest, mode)?;

    Ok(UpdateInfo {
        current_version: current.to_string(),
        latest_version,
        update_available,
        mode: mode.to_string(),
        release_url: format!("{RELEASES_URL}/tag/v{latest}"),
        notes: manifest.notes.clone(),
        published_at: manifest.pub_date.clone(),
        can_download: package.is_some(),
        asset_name: package.as_ref().map(|item| item.asset.name.clone()),
        asset_size: package
            .as_ref()
            .and_then(|item| (item.asset.size > 0).then_some(item.asset.size)),
    })
}

#[tauri::command]
pub async fn check_for_update(
    proxy_enabled: bool,
    proxy_url: String,
) -> Result<UpdateInfo, String> {
    let manifest = fetch_latest_manifest(proxy_enabled, &proxy_url).await?;
    release_info(&manifest, env!("CARGO_PKG_VERSION"), mode_name())
}

async fn fetch_signature(client: &reqwest::Client, asset: &UpdateAsset) -> Result<String, String> {
    let response = client
        .get(&asset.browser_download_url)
        .header(USER_AGENT, USER_AGENT_VALUE)
        .send()
        .await
        .map_err(|e| format!("could not download update signature: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "signature download returned HTTP {}",
            response.status()
        ));
    }
    let text = response
        .text()
        .await
        .map_err(|e| format!("could not read update signature: {e}"))?;
    if text.trim().is_empty() || text.len() > 64 * 1024 {
        return Err("update signature is invalid".to_string());
    }
    Ok(text.trim().to_string())
}

async fn fetch_artifact(
    app: &AppHandle,
    client: &reqwest::Client,
    asset: &UpdateAsset,
) -> Result<Vec<u8>, String> {
    let mut response = client
        .get(&asset.browser_download_url)
        .header(USER_AGENT, USER_AGENT_VALUE)
        .send()
        .await
        .map_err(|e| format!("could not download update: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "update download returned HTTP {}",
            response.status()
        ));
    }

    let total = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .or_else(|| response.content_length())
        .unwrap_or(asset.size);

    if total as usize > MAX_UPDATE_BYTES || asset.size as usize > MAX_UPDATE_BYTES {
        return Err("update package is unexpectedly large".to_string());
    }

    let mut buffer = Vec::with_capacity((total as usize).min(32 * 1024 * 1024));
    let mut downloaded = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("update download interrupted: {e}"))?
    {
        if buffer.len().saturating_add(chunk.len()) > MAX_UPDATE_BYTES {
            return Err("update package exceeded the size limit".to_string());
        }
        buffer.extend_from_slice(&chunk);
        downloaded += chunk.len() as u64;
        let _ = app.emit(
            "update-download-progress",
            UpdateDownloadProgress { downloaded, total },
        );
    }

    if asset.size > 0 && downloaded != asset.size {
        return Err(format!(
            "update size mismatch: expected {} bytes, received {}",
            asset.size, downloaded
        ));
    }

    Ok(buffer)
}

fn decode_base64_text(value: &str, label: &str) -> Result<String, String> {
    let bytes = BASE64
        .decode(value.trim())
        .map_err(|e| format!("invalid {label} encoding: {e}"))?;
    String::from_utf8(bytes).map_err(|e| format!("invalid {label} text: {e}"))
}

fn verify_signature(data: &[u8], signature: &str) -> Result<(), String> {
    let public_key_text = decode_base64_text(UPDATE_PUBLIC_KEY, "update public key")?;
    let public_key = PublicKey::decode(&public_key_text)
        .map_err(|e| format!("invalid update public key: {e}"))?;
    let signature_text = decode_base64_text(signature, "update signature")?;
    let signature =
        Signature::decode(&signature_text).map_err(|e| format!("invalid update signature: {e}"))?;

    public_key
        .verify(data, &signature, true)
        .map_err(|e| format!("update signature verification failed: {e}"))
}

fn update_cache_dir() -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        match portable::current_mode() {
            InstallMode::Portable => portable::portable_dir()
                .map(|dir| dir.join("data").join("updates"))
                .ok_or_else(|| "cannot locate portable program directory".to_string()),
            InstallMode::Installed => portable::local_data_base()
                .map(|dir| dir.join("PaperNest").join("updates"))
                .ok_or_else(|| "cannot locate application data directory".to_string()),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("in-app update download is not enabled on this platform yet".to_string())
    }
}

fn destination_path(version: &str, mode: &str) -> Result<PathBuf, String> {
    let (asset_name, _) = artifact_names(version, mode)
        .ok_or_else(|| "in-app update download is not enabled on this platform yet".to_string())?;

    match mode {
        "portable" => portable::portable_dir()
            .map(|dir| dir.join(asset_name))
            .ok_or_else(|| "cannot locate portable program directory".to_string()),
        "installed" => Ok(update_cache_dir()?.join(asset_name)),
        _ => Err("in-app update download is not enabled on this platform yet".to_string()),
    }
}

fn signature_cache_path(version: &str, mode: &str) -> Result<PathBuf, String> {
    let (asset_name, _) =
        artifact_names(version, mode).ok_or_else(|| "unsupported update mode".to_string())?;
    Ok(update_cache_dir()?.join(format!("{asset_name}.sig")))
}

fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("invalid update path: {}", path.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("cannot create update directory {}: {e}", parent.display()))?;
    crate::fs_util::write_atomic(path, data)
        .map_err(|e| format!("cannot write update file {}: {e}", path.display()))
}

fn verify_local_update(version: &str, mode: &str) -> Result<PathBuf, String> {
    let path = destination_path(version, mode)?;
    let sig_path = signature_cache_path(version, mode)?;
    let data = std::fs::read(&path)
        .map_err(|e| format!("cannot read downloaded update {}: {e}", path.display()))?;
    let signature = std::fs::read_to_string(&sig_path)
        .map_err(|e| format!("cannot read downloaded update signature: {e}"))?;
    verify_signature(&data, signature.trim())?;
    Ok(path)
}

#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    expected_version: String,
    proxy_enabled: bool,
    proxy_url: String,
) -> Result<DownloadedUpdate, String> {
    let expected = parse_version(&expected_version)?;
    let current = parse_version(env!("CARGO_PKG_VERSION"))?;
    if expected <= current {
        return Err("requested update is not newer than the current version".to_string());
    }

    let manifest = fetch_latest_manifest(proxy_enabled, &proxy_url).await?;
    let latest = parse_version(&manifest.version)?;
    if latest != expected {
        return Err(format!(
            "latest GitHub release changed from {} to {}; check again",
            expected, latest
        ));
    }

    let mode = mode_name();
    let package = manifest_package(&manifest, mode)?
        .ok_or_else(|| "release has no signed update package for this platform".to_string())?;
    let asset = &package.asset;

    let client = network_client(proxy_enabled, &proxy_url, Duration::from_secs(180))?;
    let signature = match package.signature {
        Some(signature) => signature,
        None => {
            fetch_signature(
                &client,
                &UpdateAsset {
                    name: format!("{}.sig", asset.name),
                    browser_download_url: format!("{}.sig", asset.browser_download_url),
                    size: 0,
                },
            )
            .await?
        }
    };
    let destination = destination_path(&latest.to_string(), mode)?;
    let sig_cache = signature_cache_path(&latest.to_string(), mode)?;

    if destination.is_file() {
        if let Ok(existing) = std::fs::read(&destination) {
            if verify_signature(&existing, &signature).is_ok() {
                write_atomic(&sig_cache, signature.as_bytes())?;
                let _ = app.emit(
                    "update-download-progress",
                    UpdateDownloadProgress {
                        downloaded: existing.len() as u64,
                        total: existing.len() as u64,
                    },
                );
                return Ok(DownloadedUpdate {
                    version: latest.to_string(),
                    mode: mode.to_string(),
                    path: destination.display().to_string(),
                    already_downloaded: true,
                });
            }
        }
    }

    let data = fetch_artifact(&app, &client, asset).await?;
    verify_signature(&data, &signature)?;
    write_atomic(&destination, &data)?;
    write_atomic(&sig_cache, signature.as_bytes())?;

    Ok(DownloadedUpdate {
        version: latest.to_string(),
        mode: mode.to_string(),
        path: destination.display().to_string(),
        already_downloaded: false,
    })
}

#[tauri::command]
pub fn open_portable_update(version: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if portable::current_mode() != InstallMode::Portable {
            return Err("current PaperNest is not running in portable mode".to_string());
        }
        let version = parse_version(&version)?.to_string();
        let path = verify_local_update(&version, "portable")?;
        // PaperNest is single-instance. Launch through a short-lived helper after
        // the current process has had time to exit, otherwise the new EXE would
        // simply hand control back to the old instance.
        let escaped_path = path.to_string_lossy().replace(char::from(39), "''");
        let launch_script = format!(
            "Start-Sleep -Milliseconds 900; Start-Process -FilePath '{}'",
            escaped_path
        );
        Command::new("powershell.exe")
            .arg("-NoProfile")
            .arg("-WindowStyle")
            .arg("Hidden")
            .arg("-Command")
            .arg(launch_script)
            .spawn()
            .map_err(|e| format!("cannot open new PaperNest version: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = version;
        Err("portable update launch is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn reveal_portable_update(version: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if portable::current_mode() != InstallMode::Portable {
            return Err("current PaperNest is not running in portable mode".to_string());
        }
        let version = parse_version(&version)?.to_string();
        let path = verify_local_update(&version, "portable")?;
        Command::new("explorer.exe")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map_err(|e| format!("cannot open update folder: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = version;
        Err("update folder reveal is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn install_downloaded_update(version: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if portable::current_mode() != InstallMode::Installed {
            return Err("current PaperNest is not running in installed mode".to_string());
        }
        let version = parse_version(&version)?.to_string();
        let path = verify_local_update(&version, "installed")?;
        Command::new("msiexec.exe")
            .arg("/i")
            .arg(&path)
            .arg("/passive")
            .arg("/norestart")
            .spawn()
            .map_err(|e| format!("cannot start PaperNest installer: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = version;
        Err("installed update is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub async fn prepare_new_version(
    app: AppHandle,
    expected_version: String,
    proxy_enabled: bool,
    proxy_url: String,
) -> Result<DownloadedUpdate, String> {
    download_update(app, expected_version, proxy_enabled, proxy_url).await
}

#[tauri::command]
pub fn use_prepared_version(version: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        return match portable::current_mode() {
            InstallMode::Portable => open_portable_update(version),
            InstallMode::Installed => install_downloaded_update(version),
        };
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = version;
        Err("in-app update is not enabled on this platform yet".to_string())
    }
}

#[tauri::command]
pub fn show_prepared_version(version: String) -> Result<(), String> {
    reveal_portable_update(version)
}

#[cfg(test)]
mod tests {
    use super::{artifact_names, manifest_package, parse_manifest, parse_version, release_info};

    // Run against each staged release artifact before publishing. This exercises
    // the same embedded public key and verifier as the download/install path.
    #[test]
    #[ignore = "requires PAPERNEST_VERIFY_ARTIFACT and its .sig file"]
    fn staged_artifact_signature_accepts_original_and_rejects_tampering() {
        let path = std::env::var("PAPERNEST_VERIFY_ARTIFACT")
            .expect("set PAPERNEST_VERIFY_ARTIFACT to the signed artifact path");
        let mut data = std::fs::read(&path).expect("read staged artifact");
        let signature =
            std::fs::read_to_string(format!("{path}.sig")).expect("read staged artifact signature");
        super::verify_signature(&data, signature.trim()).expect("verify staged artifact");
        assert!(!data.is_empty(), "release artifact must not be empty");
        data[0] ^= 1;
        assert!(super::verify_signature(&data, signature.trim()).is_err());
    }

    #[test]
    fn parses_v_prefixed_versions() {
        assert_eq!(parse_version("v1.7.6").unwrap().to_string(), "1.7.6");
        assert_eq!(parse_version("1.7.6").unwrap().to_string(), "1.7.6");
    }

    #[test]
    fn windows_asset_contract_is_stable() {
        assert_eq!(
            artifact_names("1.7.6", "portable").unwrap().0,
            "PaperNest-1.7.6.exe"
        );
        assert_eq!(
            artifact_names("1.7.6", "installed").unwrap().0,
            "PaperNest_1.7.6_x64.msi"
        );
    }

    fn manifest_json() -> serde_json::Value {
        serde_json::json!({
            "version": "0.1.6",
            "notes": "Fix updates",
            "pub_date": "2026-10-08T14:46:47Z",
            "platforms": {
                "windows-x86_64": {
                    "url": "https://github.com/baihejiangnan/PaperNest/releases/download/v0.1.6/PaperNest_0.1.6_x64.msi",
                    "signature": "msi-signature",
                    "size": 5263360
                },
                "windows-x86_64-portable": {
                    "url": "https://github.com/baihejiangnan/PaperNest/releases/download/v0.1.6/PaperNest-0.1.6.exe",
                    "signature": "exe-signature",
                    "size": 9194496
                }
            }
        })
    }

    #[test]
    fn metadata_with_or_without_bom_finds_signed_packages_for_both_modes() {
        let json = manifest_json().to_string();
        for text in [json.clone(), format!("\u{feff}{json}")] {
            let manifest = parse_manifest(&text).unwrap();
            for mode in ["installed", "portable"] {
                let info = release_info(&manifest, "0.1.5", mode).unwrap();
                assert!(info.update_available && info.can_download);
                assert_eq!(info.latest_version, "0.1.6");
                assert_eq!(info.notes, "Fix updates");
                assert!(info.release_url.ends_with("/tag/v0.1.6"));
                let package = manifest_package(&manifest, mode).unwrap().unwrap();
                let expected_signature = if mode == "installed" {
                    "msi-signature"
                } else {
                    "exe-signature"
                };
                assert_eq!(package.signature.as_deref(), Some(expected_signature));
                assert_eq!(info.asset_size, Some(package.asset.size));
            }
            assert!(
                !release_info(&manifest, "0.1.6", "installed")
                    .unwrap()
                    .update_available
            );
            assert!(
                !release_info(&manifest, "0.1.7", "installed")
                    .unwrap()
                    .update_available
            );
            assert!(
                !release_info(&manifest, "0.1.5", "unsupported")
                    .unwrap()
                    .can_download
            );
        }
    }

    #[test]
    fn old_msi_only_metadata_preserves_portable_signature_download() {
        let mut json = manifest_json();
        json["platforms"]
            .as_object_mut()
            .unwrap()
            .remove("windows-x86_64-portable");
        json["platforms"]["windows-x86_64"]
            .as_object_mut()
            .unwrap()
            .remove("size");
        let manifest = parse_manifest(&format!("\u{feff}{json}")).unwrap();
        let installed = manifest_package(&manifest, "installed").unwrap().unwrap();
        assert_eq!(installed.signature.as_deref(), Some("msi-signature"));
        let portable = manifest_package(&manifest, "portable").unwrap().unwrap();
        assert!(portable
            .asset
            .browser_download_url
            .ends_with("/v0.1.6/PaperNest-0.1.6.exe"));
        assert!(portable.signature.is_none(), "EXE must fetch its own .sig");
        assert_eq!(portable.asset.size, 0);
    }

    #[test]
    fn missing_signatures_and_platforms_are_not_downloadable() {
        let mut json = manifest_json();
        json["platforms"]["windows-x86_64"]["signature"] = "  ".into();
        json["platforms"]["windows-x86_64-portable"]["signature"] = "".into();
        let manifest = parse_manifest(&json.to_string()).unwrap();
        for mode in ["installed", "portable"] {
            assert!(!release_info(&manifest, "0.1.5", mode).unwrap().can_download);
        }
        let manifest = parse_manifest(r#"{"version":"0.1.6"}"#).unwrap();
        assert!(
            !release_info(&manifest, "0.1.5", "portable")
                .unwrap()
                .can_download
        );
    }

    #[test]
    fn metadata_rejects_bad_versions_urls_and_oversized_packages() {
        assert!(parse_manifest("not json").is_err());
        assert!(parse_manifest(r#"{"version":"invalid"}"#).is_err());
        for url in ["https://example.invalid/app.msi", "http://github.com/baihejiangnan/PaperNest/releases/download/v0.1.6/PaperNest_0.1.6_x64.msi", "https://github.com/baihejiangnan/PaperNest/releases/download/v0.1.5/PaperNest_0.1.5_x64.msi"] {
            let mut json = manifest_json();
            json["platforms"]["windows-x86_64"]["url"] = url.into();
            let manifest = parse_manifest(&json.to_string()).unwrap();
            assert!(manifest_package(&manifest, "installed").is_err());
        }
        let mut json = manifest_json();
        json["platforms"]["windows-x86_64"]["size"] = (super::MAX_UPDATE_BYTES as u64 + 1).into();
        let manifest = parse_manifest(&json.to_string()).unwrap();
        assert!(manifest_package(&manifest, "installed").is_err());
    }

    #[test]
    #[ignore = "requires GitHub network access; downloads both public Windows artifacts without installing"]
    fn public_metadata_downloads_and_verifies_both_windows_packages() {
        tauri::async_runtime::block_on(async {
            let manifest = super::fetch_latest_manifest(false, "").await.unwrap();
            let client =
                crate::proxy::network_client(false, "", std::time::Duration::from_secs(180))
                    .unwrap();
            for mode in ["installed", "portable"] {
                let package = manifest_package(&manifest, mode).unwrap().unwrap();
                let signature = match package.signature {
                    Some(signature) => signature,
                    None => super::fetch_signature(
                        &client,
                        &super::UpdateAsset {
                            name: format!("{}.sig", package.asset.name),
                            browser_download_url: format!(
                                "{}.sig",
                                package.asset.browser_download_url
                            ),
                            size: 0,
                        },
                    )
                    .await
                    .unwrap(),
                };
                let mut data = client
                    .get(&package.asset.browser_download_url)
                    .header(reqwest::header::USER_AGENT, crate::proxy::USER_AGENT_VALUE)
                    .send()
                    .await
                    .unwrap()
                    .error_for_status()
                    .unwrap()
                    .bytes()
                    .await
                    .unwrap()
                    .to_vec();
                super::verify_signature(&data, &signature).unwrap();
                data[0] ^= 1;
                assert!(super::verify_signature(&data, &signature).is_err());
                println!(
                    "PASS: {} {} public metadata, download, signature and tamper rejection",
                    manifest.version, mode
                );
            }
        });
    }
}
