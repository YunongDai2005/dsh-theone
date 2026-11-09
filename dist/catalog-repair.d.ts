import type { DatabaseSync } from 'node:sqlite';
export declare const CATALOG_ORPHAN_REPAIR = "catalog-orphan-repair-v1";
export interface CatalogOrphan {
    sourceId: string;
    title: string;
    sessionId: string;
}
export interface CatalogOrphanRepair extends CatalogOrphan {
    targetId: string;
    targetTitle: string;
}
/** Read-only, shared by import cleanup, the one-time repair and its dry run. Absence of a
 * source alone is insufficient: any evidence of a Worker, routing or user work protects it. */
export declare function catalogOrphans(db: DatabaseSync): CatalogOrphan[];
/** Old rows no longer say which turn they lost. Repair only a finished, single-owner session;
 * a mixed session or an absent owner is ambiguous and must be left alone. */
export declare function catalogOrphanRepairs(db: DatabaseSync): CatalogOrphanRepair[];
