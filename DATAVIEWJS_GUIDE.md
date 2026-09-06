# Motion Database — DataviewJS Integration Guide

The plugin exposes a global `window.motiondb` API that any DataviewJS block can call.
Databases are loaded on demand and do not need to be open in a panel first.

---

## API Reference

### `motiondb.create(name)` → `Promise<MotionDB>`

Creates a database for an embedded app and returns its open instance. If the
same database is already open, its existing instance is returned.

### `motiondb.open(name)` → `Promise<MotionDB>`
Returns the database instance. Useful when you want to run several queries
against the same db without repeating the name each time.

Prefer `motiondb.query()` and `motiondb.select()` in DataviewJS. They persist
writes before their promises resolve.

### `motiondb.query(dbName, sql)` → `Promise<Result[]>`
Raw exec. Returns an array of result objects (one per statement).
Each result is either:
- `{ type: 'rows', columns: string[], rows: any[][] }`
- `{ type: 'ok', message: string, count: number }`

PostgreSQL-style positional parameters are supported:
```js
const rows = await motiondb.select(
  'mydb',
  'SELECT * FROM users WHERE age >= $1 AND status = $2',
  [18, 'active']
);
```

### `motiondb.select(dbName, sql)` → `Promise<Object[]>`
Like `query` but returns plain row objects — much easier for DataviewJS tables.
```js
// Returns: [{ id: 1, name: 'Alice', score: 9.5 }, ...]
const rows = await motiondb.select('mydb', 'SELECT * FROM users');
```

### `motiondb.list()` → `Promise<{ name, tables[] }[]>`
Lists all databases and their tables.

### `motiondb.seed(dbName)` → `Promise<{ ok, errors }>`
Seeds the database with the built-in Northwind sample schema:
`categories`, `suppliers`, `products`, `customers`, `orders`, `order_items`
Plus two views: `order_totals`, `product_revenue`.

---

## Quick Start

### 1. Seed the sample database
Run this once in any DataviewJS block to load the Northwind demo data:

````js
```dataviewjs
const result = await motiondb.seed('My Database');
dv.paragraph(`Seeded: ${result.ok} statements OK, ${result.errors.length} errors`);
if (result.errors.length) dv.paragraph(result.errors.map(e => e.message).join('\n'));
```
````

### 2. Simple table query

````js
```dataviewjs
const rows = await motiondb.select('My Database', `
  SELECT name, country, city
  FROM customers
  ORDER BY name ASC
`);

if (!rows.length) { dv.paragraph('No rows.'); return; }
dv.table(Object.keys(rows[0]), rows.map(r => Object.values(r)));
```
````

### 3. JOIN across tables

````js
```dataviewjs
const rows = await motiondb.select('My Database', `
  SELECT
    c.name      AS customer,
    o.order_date,
    o.status,
    SUM(oi.quantity * oi.unit_price) AS total
  FROM customers c
  JOIN orders o        ON o.customer_id = c.id
  JOIN order_items oi  ON oi.order_id   = o.id
  GROUP BY o.id
  ORDER BY o.order_date DESC
`);

dv.table(['Customer', 'Date', 'Status', 'Total'], rows.map(r => [
  r.customer,
  r.order_date,
  r.status,
  '$' + r.total.toFixed(2)
]));
```
````

### 4. Query the built-in views

````js
```dataviewjs
// order_totals view: order_id, customer, status, total
const rows = await motiondb.select('My Database',
  'SELECT * FROM order_totals ORDER BY total DESC LIMIT 5'
);
dv.table(Object.keys(rows[0]), rows.map(r => Object.values(r)));
```
````

````js
```dataviewjs
// product_revenue view: product, category, units_sold, revenue
const rows = await motiondb.select('My Database',
  'SELECT * FROM product_revenue ORDER BY revenue DESC'
);
dv.table(['Product', 'Category', 'Units Sold', 'Revenue'],
  rows.map(r => [r.product, r.category, r.units_sold, '$' + r.revenue]));
```
````

### 5. Aggregates and stats

````js
```dataviewjs
const [summary] = await motiondb.query('My Database', `
  SELECT
    COUNT(DISTINCT customer_id) AS customers,
    COUNT(*)                    AS orders,
    ROUND(SUM(total), 2)        AS revenue
  FROM order_totals
`);

const row = summary.rows[0];
dv.paragraph(`
**Customers:** ${row[0]}  
**Orders:** ${row[1]}  
**Total Revenue:** $${row[2]}
`);
```
````

### 6. Filtering with parameters

````js
```dataviewjs
const country = 'Germany'; // swap this for dv.current().country etc.

const rows = await motiondb.select('My Database', `
  SELECT name, city, email
  FROM customers
  WHERE country = '${country}'
  ORDER BY name ASC
`);

dv.header(3, `Customers in ${country}`);
if (!rows.length) { dv.paragraph('None found.'); return; }
dv.table(['Name', 'City', 'Email'], rows.map(r => [r.name, r.city, r.email]));
```
````

### 7. Low-stock product alert

````js
```dataviewjs
const rows = await motiondb.select('My Database', `
  SELECT p.name, cat.name AS category, p.stock, p.unit_price
  FROM products p
  JOIN categories cat ON p.category_id = cat.id
  WHERE p.stock < 20
  ORDER BY p.stock ASC
`);

dv.header(3, '⚠️ Low Stock Products');
dv.table(['Product', 'Category', 'Stock', 'Price'],
  rows.map(r => [r.name, r.category, r.stock, '$' + r.unit_price]));
```
````

### 8. Write data from DataviewJS (INSERT/UPDATE)

````js
```dataviewjs
// Insert a new customer
await motiondb.query('My Database', `
  INSERT INTO customers (name, email, country, city)
  VALUES ('New Customer', 'new@example.com', 'PH', 'Manila')
`);

dv.paragraph('Customer added.');
```
````

---

## Sample SQL Queries for the Terminal

These work directly in the built-in SQL terminal:

```sql
-- All tables
SHOW TABLES;

-- Schema of a table
DESCRIBE products;

-- Top 5 products by revenue
SELECT p.name, SUM(oi.quantity * oi.unit_price) AS revenue
FROM order_items oi
JOIN products p ON oi.product_id = p.id
GROUP BY p.id
ORDER BY revenue DESC
LIMIT 5;

-- Orders with totals
SELECT * FROM order_totals ORDER BY total DESC;

-- Products per category
SELECT cat.name AS category, COUNT(*) AS products, ROUND(AVG(p.unit_price),2) AS avg_price
FROM products p
JOIN categories cat ON p.category_id = cat.id
GROUP BY cat.id
ORDER BY products DESC;

-- Customers with no orders (LEFT JOIN + IS NULL)
SELECT c.name, c.country
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.id IS NULL;

-- Order items with full detail
SELECT
  c.name     AS customer,
  o.order_date,
  p.name     AS product,
  oi.quantity,
  oi.unit_price,
  ROUND(oi.quantity * oi.unit_price, 2) AS line_total
FROM customers c
JOIN orders o       ON o.customer_id = c.id
JOIN order_items oi ON oi.order_id   = o.id
JOIN products p     ON oi.product_id = p.id
ORDER BY o.order_date DESC, line_total DESC;
```

---

## Notes

- The database file lives at `motion-databases/<name>.motiondb.json` in your vault.
- All data is stored as JSON — back it up like any other vault file.
- `motiondb.seed()` uses `IF NOT EXISTS` on every statement, so it's safe to call multiple times.
- DataviewJS blocks re-run on every file open/reload, so queries are always fresh.
