export {};

declare global {
  interface Window {
    motiondb?: MotionDatabasePublicApi;
    _motionDBRegistry?: Record<string, unknown>;
  }

  interface MotionDatabasePublicApi {
    readonly version: number;
    create(name: string): Promise<unknown>;
    open(name: string): Promise<unknown>;
    query(database: string, sql: string, parameters?: unknown[]): Promise<unknown[]>;
    select(database: string, sql: string, parameters?: unknown[]): Promise<Record<string, unknown>[]>;
    list(): Promise<Array<{ name: string; tables: string[] }>>;
    exec(database: unknown, sql: string, parameters?: unknown[]): Promise<unknown[]>;
    seed(database: string): Promise<{ ok: number; errors: unknown[] }>;
    subscribe(callback: (change: { name: string; filePath: string }) => void): () => void;
  }
}
