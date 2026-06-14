use anyhow::Result;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

pub struct Sample {
    pub project_id: Uuid,
    pub metric: &'static str,
    pub value: f64,
    pub sampled_at: DateTime<Utc>,
}

/// Batch-inserts all samples in a single statement.
pub async fn batch_insert(pool: &PgPool, samples: Vec<Sample>) -> Result<()> {
    if samples.is_empty() {
        return Ok(());
    }

    // Build unnest-based batch insert for performance.
    let mut ids: Vec<Uuid> = Vec::with_capacity(samples.len());
    let mut project_ids: Vec<Uuid> = Vec::with_capacity(samples.len());
    let mut metrics: Vec<&str> = Vec::with_capacity(samples.len());
    let mut values: Vec<f64> = Vec::with_capacity(samples.len());
    let mut sampled_ats: Vec<DateTime<Utc>> = Vec::with_capacity(samples.len());

    for s in &samples {
        ids.push(Uuid::new_v4());
        project_ids.push(s.project_id);
        metrics.push(s.metric);
        values.push(s.value);
        sampled_ats.push(s.sampled_at);
    }

    sqlx::query(
        r#"
        INSERT INTO usage_samples (id, project_id, metric, value, sampled_at)
        SELECT u.id, u.project_id, u.metric, u.value, u.sampled_at
        FROM UNNEST($1::uuid[], $2::uuid[], $3::text[], $4::numeric[], $5::timestamptz[])
          AS u(id, project_id, metric, value, sampled_at)
        WHERE EXISTS (SELECT 1 FROM projects WHERE id = u.project_id)
        "#,
    )
    .bind(&ids)
    .bind(&project_ids)
    .bind(&metrics)
    .bind(&values)
    .bind(&sampled_ats)
    .execute(pool)
    .await?;

    Ok(())
}
