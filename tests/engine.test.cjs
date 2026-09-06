const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.ts'), 'utf8');
const engineSource = source.split('// ── Plugin ─')[0];
const context = { console, setTimeout, clearTimeout };
vm.runInNewContext(
  engineSource
    + '\nglobalThis.__motiondbTest = { MotionDBEngine, bindParameters, assertReadOnlyQuery, computeERDLayout };',
  context,
);

const { MotionDBEngine, bindParameters, assertReadOnlyQuery, computeERDLayout } = context.__motiondbTest;

test('executes relational queries and joins', () => {
  const db = new MotionDBEngine();
  db.exec('CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  db.exec('CREATE TABLE books (id INTEGER PRIMARY KEY, author_id INTEGER REFERENCES authors(id), title TEXT)');
  db.exec("INSERT INTO authors VALUES (1, 'Ada')");
  db.exec("INSERT INTO books VALUES (10, 1, 'Notes')");
  const [result] = db.exec(
    'SELECT authors.name, books.title FROM authors JOIN books ON authors.id = books.author_id',
  );
  assert.deepEqual(Array.from(result.columns), ['name', 'title']);
  assert.deepEqual(Array.from(result.rows[0]), ['Ada', 'Notes']);
});

test('rolls back a failed multi-statement batch', () => {
  const db = new MotionDBEngine();
  db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
  assert.throws(() => db.exec(
    "INSERT INTO items VALUES (1, 'first'); INSERT INTO items VALUES (1, 'duplicate')",
  ));
  assert.equal(db.schema.items.rows.length, 0);
});

test('a transaction error restores BEGIN state and closes the transaction', () => {
  const db = new MotionDBEngine();
  db.exec('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
  db.exec("INSERT INTO items VALUES (1, 'original')");
  db.exec('BEGIN');
  db.exec("INSERT INTO items VALUES (2, 'temporary')");
  db.exec('SAVEPOINT later');
  db.exec("INSERT INTO items VALUES (3, 'also temporary')");
  assert.throws(() => db.exec("INSERT INTO items VALUES (1, 'duplicate')"));
  assert.equal(db._inTx, false);
  assert.deepEqual(Array.from(db.schema.items.rows, row => row.id), [1]);
});

test('binds PostgreSQL-style parameters without touching quoted text', () => {
  const sql = bindParameters(
    "SELECT '$1' AS literal, name FROM users WHERE age >= $1 AND active = $2",
    [18, true],
  );
  assert.equal(
    sql,
    "SELECT '$1' AS literal, name FROM users WHERE age >= 18 AND active = TRUE",
  );
  assert.throws(() => bindParameters('SELECT $2', [1]), /was not provided/);
});

test('embedded query guard rejects writes', () => {
  assert.doesNotThrow(() => assertReadOnlyQuery('SELECT * FROM users'));
  assert.throws(() => assertReadOnlyQuery('DELETE FROM users'), /read-only/);
  assert.throws(() => assertReadOnlyQuery('SELECT * FROM users; DELETE FROM users'), /read-only/);
});

test('ERD layout keeps differently sized table cards from overlapping', () => {
  const schemas = {
    authors: { columns: [{ name: 'id' }, { name: 'name' }] },
    books: {
      columns: [
        { name: 'id' },
        { name: 'author_id', fk: { table: 'authors', col: 'id' } },
        ...Array.from({ length: 14 }, (_, index) => ({ name: `field_${index}` })),
      ],
    },
    publishers: { columns: [{ name: 'id' }, { name: 'name' }, { name: 'country' }] },
    editions: {
      columns: [
        { name: 'id' },
        { name: 'book_id', fk: { table: 'books', col: 'id' } },
        { name: 'publisher_id', fk: { table: 'publishers', col: 'id' } },
      ],
    },
  };
  const names = Object.keys(schemas);
  const { positions } = computeERDLayout(names, name => schemas[name], { verticalGap: 20 });

  for (let left = 0; left < names.length; left++) {
    for (let right = left + 1; right < names.length; right++) {
      const a = positions[names[left]];
      const b = positions[names[right]];
      const overlaps = a.x < b.x + b.w && a.x + a.w > b.x
        && a.y < b.y + b.h && a.y + a.h > b.y;
      assert.equal(overlaps, false, `${names[left]} overlaps ${names[right]}`);
    }
  }
  assert.ok(positions.books.x > positions.authors.x);
  assert.ok(positions.editions.x > positions.books.x);
});
