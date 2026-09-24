/**
 * Branded primitives.
 *
 * Every id in this system is a string, so without brands every id is
 * interchangeable — which is how a repositoryId ends up in a developerId
 * parameter. Units matter just as much: the analytics layer works in hours, the
 * database stores minutes, and mixing them silently produces a value wrong by
 * a factor of 60.
 */

declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

// ── Identifiers ─────────────────────────────────────────────────────────────
export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type TeamId = Brand<string, 'TeamId'>;
export type DeveloperId = Brand<string, 'DeveloperId'>;
export type RepositoryId = Brand<string, 'RepositoryId'>;
export type PullRequestId = Brand<string, 'PullRequestId'>;
export type IntegrationId = Brand<string, 'IntegrationId'>;
export type SyncRunId = Brand<string, 'SyncRunId'>;
export type InsightId = Brand<string, 'InsightId'>;

// ── Units ───────────────────────────────────────────────────────────────────
export type Minutes = Brand<number, 'Minutes'>;
export type Hours = Brand<number, 'Hours'>;
export type Days = Brand<number, 'Days'>;
/** A 0–1 proportion. */
export type Ratio = Brand<number, 'Ratio'>;
/** A 0–100 normalized score. */
export type Score = Brand<number, 'Score'>;

// ── Constructors ────────────────────────────────────────────────────────────
// Deliberately explicit: a cast at a boundary you can grep for beats an
// implicit conversion you cannot.

export const minutes = (n: number): Minutes => n as Minutes;
export const hours = (n: number): Hours => n as Hours;
export const days = (n: number): Days => n as Days;
export const ratio = (n: number): Ratio => n as Ratio;
export const score = (n: number): Score => n as Score;

export const minutesToHours = (m: Minutes): Hours => (m / 60) as Hours;
export const minutesToDays = (m: Minutes): Days => (m / 1440) as Days;
export const hoursToMinutes = (h: Hours): Minutes => Math.round(h * 60) as Minutes;
