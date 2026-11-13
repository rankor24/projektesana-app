// The shape of a viewer target as it travels between windows (shared/viewer.ts ViewTarget, kept structural here so the relay does
// not depend on the viewer's tab model).
export type PreviewTargetLike = { kind: string; [k: string]: unknown };
