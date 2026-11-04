# 0002 PostgreSQL as the only data store
**Status:** accepted   **Date:** 2026-10-19
**Context:** The data is relational (players, maps, styles, runs, servers, keys). Leaderboards need ranking, and rulesets and zones are versioned JSON documents. Background work (replay compression, rank recomputation) needs a queue. The VPS has 4 GB of RAM.
**Decision:** PostgreSQL holds everything except large files. Ranks come from window functions over indexed personal-best tables. JSONB holds rulesets and zones. The job queue is a Postgres table read with `FOR UPDATE SKIP LOCKED`. The lead has used Postgres in other projects.
**Rejected:**
- Redis for queues and caching: another service to run and back up, with no need for it at this scale.
- A separate search engine: Postgres trigram indexes cover player and map search.
**Revisit if:** leaderboard reads outgrow indexes plus in-process caching.
**Note (2026-10-30):** ranking a whole board per request took ~1 s at 100k players. A map board page now reads in order from one index (`personal_bests_board`; personal bests copy their run's `time` and `finished_at`), and its places come from two index counts: ~1 ms for a top page, ~20 ms at place 50,000. The API turns JIT off, which only slowed these small queries.
