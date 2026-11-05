# API contract examples
One example exchange per endpoint, for plugin developers and the plugin's mock server. The exact schema is `../openapi.json`.

The values are illustrations, not policy: real rulesets, styles and zones come from SourceJump's data. `cargo test` checks every file here against the API (`crates/api/src/contract.rs`). The plugin (`sourcejump/plugins`) follows them in its `docs/plugin-api.md`, updated with the lead's OK.
