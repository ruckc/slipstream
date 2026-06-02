use crate::error::AppError;
use axum::{extract::FromRequestParts, http::request::Parts};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use parking_lot::RwLock;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tracing::{debug, info, warn};

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    #[serde(rename = "projectId")]
    pub project_id: String,
    pub permissions: Vec<String>,
    pub exp: u64,
    pub iat: u64,
}

// ---------------------------------------------------------------------------
// JWKS types
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct JwkKey {
    kty: String,
    kid: String,
    #[serde(rename = "use")]
    _key_use: Option<String>,
    n: Option<String>,
    e: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Jwks {
    keys: Vec<JwkKey>,
}

// ---------------------------------------------------------------------------
// Cache internals
// ---------------------------------------------------------------------------

struct CachedKeys {
    keys: Vec<JwkKey>,
    fetched_at: Instant,
}

// ---------------------------------------------------------------------------
// JwksCache
// ---------------------------------------------------------------------------

pub struct JwksCache {
    client: Client,
    url: String,
    project_id: String,
    cache: RwLock<Option<CachedKeys>>,
}

const CACHE_TTL: Duration = Duration::from_secs(300); // 5 minutes

impl JwksCache {
    pub async fn new(url: String, project_id: String) -> anyhow::Result<Self> {
        let client = Client::builder().timeout(Duration::from_secs(10)).build()?;

        let instance = Self {
            client,
            url,
            project_id,
            cache: RwLock::new(None),
        };

        // Fetch immediately on startup — fail fast if unreachable.
        instance.fetch_keys().await?;
        info!("JWKS keys loaded successfully");

        Ok(instance)
    }

    async fn fetch_keys(&self) -> anyhow::Result<()> {
        info!("Fetching JWKS from {}", self.url);
        let resp = self
            .client
            .get(&self.url)
            .send()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to fetch JWKS: {}", e))?;

        if !resp.status().is_success() {
            return Err(anyhow::anyhow!(
                "JWKS endpoint returned status {}",
                resp.status()
            ));
        }

        let jwks: Jwks = resp
            .json()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to parse JWKS: {}", e))?;

        debug!("Fetched {} JWK keys", jwks.keys.len());

        let mut guard = self.cache.write();
        *guard = Some(CachedKeys {
            keys: jwks.keys,
            fetched_at: Instant::now(),
        });

        Ok(())
    }

    fn find_key<'a>(cached: &'a CachedKeys, kid: &str) -> Option<&'a JwkKey> {
        cached.keys.iter().find(|k| k.kid == kid && k.kty == "RSA")
    }

    pub async fn validate(&self, token: &str) -> Result<Claims, AppError> {
        // Decode header without verification to extract `kid`.
        let header = jsonwebtoken::decode_header(token)
            .map_err(|e| AppError::Unauthorized(format!("Invalid token header: {}", e)))?;

        let kid = header
            .kid
            .as_deref()
            .ok_or_else(|| AppError::Unauthorized("Token missing kid".to_string()))?
            .to_string();

        self.try_validate(token, &kid).await
    }

    async fn try_validate(&self, token: &str, kid: &str) -> Result<Claims, AppError> {
        // Check cache freshness.
        let cache_valid = {
            let guard = self.cache.read();
            guard
                .as_ref()
                .map(|c| c.fetched_at.elapsed() < CACHE_TTL)
                .unwrap_or(false)
        };

        if !cache_valid {
            if let Err(e) = self.fetch_keys().await {
                warn!("Failed to refresh JWKS keys: {}", e);
                // Continue with stale keys rather than failing hard.
            }
        }

        // Try to find key in cache.
        let decoding_key_opt = self.build_decoding_key(kid);

        if decoding_key_opt.is_none() {
            // kid not found — attempt one re-fetch in case of key rotation.
            warn!("kid '{}' not found in JWKS cache, re-fetching", kid);
            self.fetch_keys()
                .await
                .map_err(|e| AppError::Unauthorized(format!("Failed to refresh JWKS: {}", e)))?;
        }

        let decoding_key = self
            .build_decoding_key(kid)
            .ok_or_else(|| AppError::Unauthorized(format!("Unknown kid: {}", kid)))?;

        let mut validation = Validation::new(Algorithm::RS256);
        validation.validate_exp = true;
        // Require aud == "agent:{project_id}" — tokens not scoped to this agent are rejected.
        validation.set_audience(&[format!("agent:{}", self.project_id)]);

        let token_data = decode::<Claims>(token, &decoding_key, &validation)
            .map_err(|e| AppError::Unauthorized(format!("Token validation failed: {}", e)))?;

        let claims = token_data.claims;

        // Validate projectId claim.
        if claims.project_id != self.project_id {
            return Err(AppError::Unauthorized(format!(
                "Token projectId '{}' does not match this agent's project '{}'",
                claims.project_id, self.project_id
            )));
        }

        Ok(claims)
    }

    fn build_decoding_key(&self, kid: &str) -> Option<DecodingKey> {
        let guard = self.cache.read();
        guard
            .as_ref()
            .and_then(|c| Self::find_key(c, kid))
            .and_then(|k| {
                let n = k.n.as_deref()?;
                let e = k.e.as_deref()?;
                let n_bytes = URL_SAFE_NO_PAD.decode(n).ok()?;
                let e_bytes = URL_SAFE_NO_PAD.decode(e).ok()?;
                Some(DecodingKey::from_rsa_raw_components(&n_bytes, &e_bytes))
            })
    }
}

// ---------------------------------------------------------------------------
// Permission helper
// ---------------------------------------------------------------------------

pub fn require_permission(claims: &Claims, permission: &str) -> Result<(), AppError> {
    if claims.permissions.contains(&permission.to_string()) {
        Ok(())
    } else {
        Err(AppError::Forbidden(format!(
            "Missing permission: {permission}"
        )))
    }
}

// ---------------------------------------------------------------------------
// Axum extractor
// ---------------------------------------------------------------------------

/// Newtype wrapper placed in axum Extensions so AuthUser can pull it.
#[derive(Clone)]
pub struct JwksCacheExt(pub Arc<JwksCache>);

pub struct AuthUser(pub Claims);

impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        // Pull the JwksCache from axum Extensions (added by the router layer).
        let jwks_ext = parts
            .extensions
            .get::<JwksCacheExt>()
            .ok_or_else(|| AppError::Internal(anyhow::anyhow!("JwksCache not in extensions")))?
            .clone();

        // Extract the Bearer token from the Authorization header.
        let auth_header = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".to_string()))?;

        let token = auth_header.strip_prefix("Bearer ").ok_or_else(|| {
            AppError::Unauthorized("Authorization header must be Bearer token".to_string())
        })?;

        let claims = jwks_ext.0.validate(token).await?;

        Ok(AuthUser(claims))
    }
}
