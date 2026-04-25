/**
 * Custom Docker-backed bind-mount sandbox provider for `@ai-hero/sandcastle`.
 *
 * See `./docker.ts` and `./chown.ts` for the design notes that explain why
 * this lives in the project instead of using the upstream provider directly.
 */
export { docker, SMOKE_DOCKER_OPTIONS, type DockerOptions } from "./docker.ts";
export {
  removeVolumes,
  workspaceVolumes,
  type VolumeMount,
  type WorkspaceVolumeNames,
} from "./volumes.ts";
