# SQL compatibility

Motion Database provides a PostgreSQL-familiar subset for local Obsidian data.
It is not a PostgreSQL server and does not implement the PostgreSQL wire
protocol.

## Supported

- Tables, views, and basic indexes
- `SELECT`, `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE`
- Inner, left, right, full, and cross joins
- `WHERE`, `GROUP BY`, `HAVING`, `ORDER BY`, `LIMIT`, and `OFFSET`
- Common scalar and aggregate functions
- Primary keys, foreign keys, `UNIQUE`, `NOT NULL`, and defaults
- Transactions, savepoints, commit, and rollback
- Common table expressions and set operations
- PostgreSQL-style `$1`, `$2` parameters through the public API

## Different from PostgreSQL

- A database is one versioned JSON snapshot in the vault.
- Identifiers and the available data types use a smaller compatibility set.
- Transactions are in-process and use schema snapshots.
- Index declarations are schema metadata; they are not yet query-planner
  acceleration structures.
- Concurrent access is serialized inside one Obsidian plugin process. This is
  not a multi-process database server.

## Not currently supported

- PostgreSQL network/wire connections
- Roles, grants, row-level security, or concurrent server sessions
- Stored procedures, triggers, extensions, and custom types
- PostgreSQL catalogs, query planner parity, and complete function parity
- Full-text and specialized PostgreSQL indexes

Unsupported syntax should fail explicitly rather than return a result with
different silent semantics.
