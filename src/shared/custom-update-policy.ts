export const CUSTOM_UPDATE_INSTRUCTIONS =
  'Install with bin/orca-custom install (the custom build may lag behind).'

export function isCustomBuild(version: string): boolean {
  return /\+custom\.\d+$/.test(version)
}
