//! Staff tools for privileges (`manage_privileges`): granting and revoking them on a player.
//!
//! Sensitive path, fails closed. Nobody changes their own privileges, and `manage_privileges` itself is granted
//! and revoked only with the server's command line, so privilege managers can't add more of themselves or take
//! the privilege from each other (lead, 2026-10-20). A change and its staff log entries are one transaction.
//! Sessions read privileges on every request, so a change applies at once.

use axum::{
    Json,
    extract::{Path, State},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use utoipa::ToSchema;

use super::{
    ChangeError,
    access::Staff,
    log::{self, StaffAction, check_reason},
    players::parse_player,
};
use crate::{
    app::AppState,
    error::{ApiError, ErrorBody},
    json_body::JsonBody,
    players::{
        SteamId64,
        privileges::{Privilege, Privileges},
    },
};

/// Grants and revokes privileges on a player, logging each half that changes something, and returns what
/// they hold now. `actor` None is the command line, which alone may change `manage_privileges`. A player
/// SourceJump hasn't seen is created, so staff can be set up before their first sign-in.
pub async fn change(
    db: &PgPool,
    actor: Option<SteamId64>,
    player: SteamId64,
    grant: Privileges,
    revoke: Privileges,
    reason: Option<&str>,
) -> Result<Privileges, ChangeError> {
    if actor == Some(player) {
        return Err(ChangeError::Invalid(
            "you can't change your own privileges".to_owned(),
        ));
    }
    if !grant.and(revoke).is_empty() {
        return Err(ChangeError::Invalid(
            "a privilege can't be granted and revoked at once".to_owned(),
        ));
    }
    let manage = Privileges::of(&[Privilege::ManagePrivileges]);
    if actor.is_some() && !(grant.and(manage).is_empty() && revoke.and(manage).is_empty()) {
        return Err(ChangeError::Invalid(
            "manage_privileges is granted and revoked only with the server's command line"
                .to_owned(),
        ));
    }

    let mut tx = db.begin().await?;
    sqlx::query!(
        "INSERT INTO players (steamid64, name, name_seen_at) VALUES ($1::bigint, $1::bigint::text, '-infinity')
         ON CONFLICT (steamid64) DO NOTHING",
        player.get()
    )
    .execute(&mut *tx)
    .await?;
    let bits = sqlx::query_scalar!(
        "SELECT privileges FROM players WHERE steamid64 = $1 FOR UPDATE",
        player.get()
    )
    .fetch_one(&mut *tx)
    .await?;
    let held = Privileges::from_bits(bits);
    let granted = grant.without(held);
    let revoked = revoke.and(held);
    if granted.is_empty() && revoked.is_empty() {
        return Err(ChangeError::Invalid(
            "they already hold exactly that".to_owned(),
        ));
    }

    let target = player.to_string();
    for (action, privileges) in [
        (StaffAction::GrantPrivileges, granted),
        (StaffAction::RevokePrivileges, revoked),
    ] {
        if privileges.is_empty() {
            continue;
        }
        let entry = log::Entry {
            actor,
            action,
            target: &target,
            reason,
            detail: json!({ "privileges": privileges.list() }),
        };
        log::record(&mut tx, entry).await?;
    }
    // Bits no privilege defines are left as they are.
    let now = sqlx::query_scalar!(
        "UPDATE players SET privileges = (privileges | $2) & ~$3::bigint WHERE steamid64 = $1
         RETURNING privileges",
        player.get(),
        granted.bits(),
        revoked.bits()
    )
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Privileges::from_bits(now))
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PrivilegeChange {
    /// Privileges to add. Any but `manage_privileges`.
    #[serde(default)]
    pub grant: Vec<Privilege>,
    /// Privileges to take away. Any but `manage_privileges`.
    #[serde(default)]
    pub revoke: Vec<Privilege>,
    /// Why, for staff only. 1 to 500 characters.
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct PlayerPrivileges {
    /// What the player holds after the change.
    pub privileges: Vec<Privilege>,
}

/// Grant and revoke a player's privileges. Only what changes is logged; asking for nothing new is refused.
#[utoipa::path(
    post,
    path = "/v1/staff/players/{player}/privileges",
    tag = "staff",
    params(("player" = String, Path, description = "SteamID64, SteamID2 or SteamID3")),
    request_body = PrivilegeChange,
    responses(
        (status = OK, body = PlayerPrivileges),
        (status = UNAUTHORIZED, description = "Not signed in", body = ErrorBody),
        (status = FORBIDDEN, description = "Needs manage_privileges, from SourceJump's pages", body = ErrorBody),
        (status = UNPROCESSABLE_ENTITY, description = "Not a SteamID, yourself, manage_privileges, no change or no reason", body = ErrorBody),
    ),
)]
pub async fn post_privileges(
    State(state): State<AppState>,
    staff: Staff,
    Path(player): Path<String>,
    JsonBody(request): JsonBody<PrivilegeChange>,
) -> Result<Json<PlayerPrivileges>, ApiError> {
    staff.require(Privilege::ManagePrivileges)?;
    let player = parse_player(&player)?;
    let reason = check_reason(&request.reason)?;
    let held = change(
        &state.db,
        Some(staff.steamid64),
        player,
        Privileges::of(&request.grant),
        Privileges::of(&request.revoke),
        Some(&reason),
    )
    .await?;
    Ok(Json(PlayerPrivileges {
        privileges: held.list(),
    }))
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::{Value, json};

    use super::*;
    use crate::{
        auth::sessions,
        players::privileges,
        staff::players::StaffPlayer,
        test_client::{self, TestResponse},
    };

    const STAFF: &str = "76561197960287920";
    const GABE: &str = "76561197960287930";

    async fn session(db: &PgPool, steamid: &str, held: &[Privilege]) -> String {
        let steamid64 = SteamId64::parse_any(steamid).unwrap();
        privileges::grant(db, steamid64, Privileges::of(held))
            .await
            .unwrap();
        sessions::create(db, steamid64).await.unwrap()
    }

    async fn send(
        db: &PgPool,
        method: &str,
        path: &str,
        token: &str,
        body: Option<Value>,
    ) -> TestResponse {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header("origin", "https://sourcejump.test")
            .header("content-type", "application/json")
            .header("cookie", format!("{}={token}", sessions::COOKIE))
            .body(body.map_or_else(Body::empty, |b| Body::from(b.to_string())))
            .unwrap();
        test_client::send(db, request).await
    }

    async fn change_gabe(db: &PgPool, token: &str, body: Value) -> TestResponse {
        let path = format!("/v1/staff/players/{GABE}/privileges");
        send(db, "POST", &path, token, Some(body)).await
    }

    #[sqlx::test]
    async fn grants_and_revokes_apply_at_once_and_are_logged(db: PgPool) {
        let token = session(&db, STAFF, &[Privilege::ManagePrivileges]).await;
        let gabe = session(&db, GABE, &[Privilege::PostCommunity]).await;
        // Not staff yet.
        assert_eq!(
            send(&db, "GET", "/v1/staff/log", &gabe, None).await.status,
            403
        );

        let body = json!({
            "grant": ["manage_bans", "invalidate_runs"],
            "revoke": ["post_community"],
            "reason": "Joined the ban team",
        });
        let changed: PlayerPrivileges = change_gabe(&db, &token, body).await.json();
        assert_eq!(
            changed.privileges,
            [Privilege::ManageBans, Privilege::InvalidateRuns]
        );
        assert_eq!(
            send(&db, "GET", "/v1/staff/log", &gabe, None).await.status,
            200
        );

        // Asking again for what they hold changes nothing; only the real change is logged.
        let again = json!({ "grant": ["manage_bans"], "reason": "Twice" });
        assert_eq!(change_gabe(&db, &token, again).await.status, 422);
        let partly = json!({ "grant": ["manage_bans"], "revoke": ["invalidate_runs"], "reason": "Bans only" });
        let changed: PlayerPrivileges = change_gabe(&db, &token, partly).await.json();
        assert_eq!(changed.privileges, [Privilege::ManageBans]);

        let log: Vec<(String, Value, Option<String>)> =
            sqlx::query!("SELECT action, detail, reason FROM staff_log ORDER BY id")
                .fetch_all(&db)
                .await
                .unwrap()
                .into_iter()
                .map(|row| (row.action, row.detail, row.reason))
                .collect();
        let reason = |text: &str| Some(text.to_owned());
        assert_eq!(
            log,
            [
                (
                    "grant_privileges".to_owned(),
                    json!({ "privileges": ["manage_bans", "invalidate_runs"] }),
                    reason("Joined the ban team")
                ),
                (
                    "revoke_privileges".to_owned(),
                    json!({ "privileges": ["post_community"] }),
                    reason("Joined the ban team")
                ),
                (
                    "revoke_privileges".to_owned(),
                    json!({ "privileges": ["invalidate_runs"] }),
                    reason("Bans only")
                ),
            ]
        );

        let player: StaffPlayer = send(
            &db,
            "GET",
            &format!("/v1/staff/players/{GABE}"),
            &token,
            None,
        )
        .await
        .json();
        assert_eq!(player.privileges, Some(vec![Privilege::ManageBans]));
    }

    #[sqlx::test]
    async fn changes_are_checked(db: PgPool) {
        let token = session(&db, STAFF, &[Privilege::ManagePrivileges]).await;
        for body in [
            json!({ "grant": [], "revoke": [], "reason": "Nothing" }),
            json!({ "grant": ["manage_keys"], "reason": " " }),
            json!({ "grant": ["manage_keys"], "revoke": ["manage_keys"], "reason": "Both" }),
            json!({ "grant": ["manage_privileges"], "reason": "Another manager" }),
            json!({ "revoke": ["manage_privileges"], "reason": "Take it" }),
            json!({ "revoke": ["manage_keys"], "reason": "Not held" }),
        ] {
            let response = change_gabe(&db, &token, body.clone()).await;
            assert_eq!(response.status, 422, "{body}");
        }
        let own = send(
            &db,
            "POST",
            &format!("/v1/staff/players/{STAFF}/privileges"),
            &token,
            Some(json!({ "grant": ["manage_keys"], "reason": "Me" })),
        )
        .await;
        assert_eq!(own.status, 422);
        let nobody = send(
            &db,
            "POST",
            "/v1/staff/players/nobody/privileges",
            &token,
            Some(json!({ "grant": ["manage_keys"], "reason": "Who" })),
        )
        .await;
        assert_eq!(nobody.status, 422);
        assert_eq!(
            sqlx::query_scalar!("SELECT count(*) FROM staff_log")
                .fetch_one(&db)
                .await
                .unwrap(),
            Some(0)
        );

        // A player SourceJump hasn't seen can be given privileges before their first sign-in.
        let unseen = SteamId64::parse_any("76561197960287999").unwrap();
        let path = format!("/v1/staff/players/{unseen}/privileges");
        let body = json!({ "grant": ["manage_maps"], "reason": "New map team member" });
        assert_eq!(
            send(&db, "POST", &path, &token, Some(body)).await.status,
            200
        );

        // The command line may change manage_privileges, and logs no actor.
        let gabe = SteamId64::parse_any(GABE).unwrap();
        let manage = Privileges::of(&[Privilege::ManagePrivileges]);
        let held = change(&db, None, gabe, manage, Privileges::default(), None)
            .await
            .unwrap();
        assert!(held.contains(Privilege::ManagePrivileges));
    }

    #[sqlx::test]
    async fn every_route_needs_its_privilege(db: PgPool) {
        let others: Vec<Privilege> = Privilege::ALL
            .into_iter()
            .filter(|&p| p.is_staff() && p != Privilege::ManagePrivileges)
            .collect();
        let token = session(&db, STAFF, &others).await;
        let body = json!({ "grant": ["manage_keys"], "reason": "Because" });
        assert_eq!(change_gabe(&db, &token, body).await.status, 403);
        // The player page leaves privileges out for them.
        let player: StaffPlayer = send(
            &db,
            "GET",
            &format!("/v1/staff/players/{GABE}"),
            &token,
            None,
        )
        .await
        .json();
        assert!(player.privileges.is_none());
    }
}
