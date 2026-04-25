/**
 * Custom Docker-backed bind-mount sandbox provider for `@ai-hero/sandcastle`.
 *
 * See `./docker.ts` and `./chown.ts` for the design notes that explain why
 * this lives in the project instead of using the upstream provider directly.
 */
export {
  type BaseRef,
  captureBaseRef,
  countCommitsAhead,
  formatBaseRef,
} from "./git.ts"
export { docker, SMOKE_DOCKER_OPTIONS, type DockerOptions } from "./docker.ts"
export {
  createIssueSandbox,
  type PlannedIssue,
  runImplementer,
  runMerger,
  runPlanner,
  runReviewer,
} from "./stages.ts"
export {
  removeVolumes,
  workspaceVolumes,
  type VolumeMount,
  type WorkspaceVolumeNames,
} from "./volumes.ts"
export { claudeCustom } from "./agent.ts"
export {
  type EligibleIssue,
  moveStatus,
  pickNextEligibleIssue,
  type ProjectContext,
  resolveProject,
  type StatusName,
} from "./project.ts"
