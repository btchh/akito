# Motion Database

Motion Database is a local-first relational database embedded in an Obsidian
vault. It provides a PostgreSQL-familiar SQL subset through a native workspace
and a DataviewJS API.

## Development

Obsidian executes the generated `main.js`. The maintained source is
`src/main.ts`.

The first migration preserves the legacy engine in one TypeScript entry point
so behavior remains reviewable against the previous release. It is explicitly
marked as transitional; the regression suite is the safety net for splitting
the parser, executor, persistence service, integrations, and views into fully
typed modules.

1. Install Node.js 20 or later.
2. Run `npm install`.
3. Run `npm run dev` while developing, or `npm run build` for a release.

## Data safety

Database files live in `motion-databases/`. Writes are serialized per
database and staged through a temporary file before replacing the stored
snapshot. All plugin views and public API calls share one in-memory database
instance per file.

## Public API

```js
await motiondb.create('My Database'); // safe to call when bootstrapping an app

const rows = await motiondb.select('My Database',
  'SELECT * FROM customers ORDER BY name');

await motiondb.query('My Database',
  "INSERT INTO customers (name) VALUES ('Ada')");
```

Public write calls persist before their promises resolve. A transaction can
span calls to `motiondb.query`; changes are persisted when `COMMIT`
completes and discarded when `ROLLBACK` completes.

### Markdown query blocks

Queries embedded in notes are deliberately read-only:

````markdown
```motiondb
database: My Database
SELECT id, name FROM customers ORDER BY name
```
````

### Bases

On Obsidian 1.10 or later, choose the **Motion Database query** layout for a
Base view. Configure the database name and one read-only SQL statement in the
view options. Bases continues to own its file query model; this layout uses the
supported custom-view API to present Motion Database results inside the Bases
workspace.

See [DATAVIEWJS_GUIDE.md](DATAVIEWJS_GUIDE.md) for more examples.

## Compatibility

The SQL engine is PostgreSQL-inspired, not a complete PostgreSQL server. The
supported grammar and behavioral differences will be tracked explicitly as the
engine is hardened.
