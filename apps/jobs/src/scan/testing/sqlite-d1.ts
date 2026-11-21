import type { DatabaseSync, SQLInputValue } from "node:sqlite"

// The slice of D1's API the copy step uses (prepare, bind, all, first,
// run, batch), over node:sqlite, the engine D1 runs. Lets a node test run
// a copy against a database the first-fill SQL files built.

type Bound = {
  sql: string
  params: SQLInputValue[]
}

function statement(db: DatabaseSync, bound: Bound) {
  function results(): Record<string, unknown>[] {
    return db
      .prepare(bound.sql)
      .all(...bound.params)
      .map((row) => ({ ...row }))
  }
  function run() {
    const result = db.prepare(bound.sql).run(...bound.params)
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes), rows_written: 0 },
    }
  }
  return {
    bind(...params: unknown[]) {
      return statement(db, {
        sql: bound.sql,
        params: params.map((param) => {
          if (
            param === null ||
            typeof param === "string" ||
            typeof param === "number"
          ) {
            return param
          }
          throw new Error(`Unsupported parameter: ${String(param)}`)
        }),
      })
    },
    async all() {
      return { success: true, results: results(), meta: {} }
    },
    async first() {
      return results()[0] ?? null
    },
    async run() {
      return run()
    },
    /** Reads return rows, writes their change count, as batch() does. */
    exec() {
      const reads = /^\s*(SELECT|WITH)\b/i.test(bound.sql)
      if (reads) return { success: true, results: results(), meta: {} }
      return run()
    },
  }
}

type Statement = ReturnType<typeof statement>

/** A D1Database over `db`; batches run in one transaction, as D1's do. */
export default function sqliteD1(db: DatabaseSync): D1Database {
  const d1 = {
    prepare(sql: string): Statement {
      return statement(db, { sql, params: [] })
    },
    async batch(statements: Statement[]) {
      db.exec("BEGIN")
      try {
        const results = statements.map((item) => item.exec())
        db.exec("COMMIT")
        return results
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
  }
  // Only the methods above are used; the rest of D1's surface is absent.
  return d1 as unknown as D1Database
}
