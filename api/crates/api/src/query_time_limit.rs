//! A ceiling on how long one database statement may run while serving a request, so a slow query can't hold
//! one of the request pool's connections for long (backend audit 2026-11-05). Requests use a pool with the
//! limit; startup, migrations, background jobs and the CLI use one without it. Work inside a request that is
//! long by design, such as recounts and bulk invalidation, lifts it for its own transaction.

use sqlx::{PgConnection, postgres::PgConnectOptions};

/// Far above the slowest read measured on the old site's records (under 0.1 s), so only a runaway statement
/// meets it. The client then gets a 500, which every client treats as temporary.
pub const LIMIT: &str = "5s";

/// `options` with the limit on every connection.
pub fn apply(options: PgConnectOptions) -> PgConnectOptions {
    options.options([("statement_timeout", LIMIT)])
}

/// Lifts the limit until the caller's transaction ends. Outside a transaction it does nothing, which is only
/// the case on the pool without the limit.
pub async fn lift(conn: &mut PgConnection) -> Result<(), sqlx::Error> {
    sqlx::query!("SET LOCAL statement_timeout = 0")
        .execute(conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::{PgPool, postgres::PgPoolOptions};

    #[sqlx::test]
    async fn stops_long_statements_until_lifted(db: PgPool) {
        let options = super::apply((*db.connect_options()).clone());
        let limited = PgPoolOptions::new().connect_with(options).await.unwrap();

        let refused = sqlx::query("SELECT pg_sleep(6)").execute(&limited).await;
        assert!(
            refused.is_err_and(|error| error.to_string().contains("statement timeout")),
            "a statement over the limit is cancelled"
        );

        let mut tx = limited.begin().await.unwrap();
        super::lift(&mut tx).await.unwrap();
        let shown: String = sqlx::query_scalar("SHOW statement_timeout")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
        assert_eq!(shown, "0");
        tx.rollback().await.unwrap();

        let back: String = sqlx::query_scalar("SHOW statement_timeout")
            .fetch_one(&limited)
            .await
            .unwrap();
        assert_eq!(back, "5s", "lifting lasts only for the transaction");
    }
}
