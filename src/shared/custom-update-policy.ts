export const CUSTOM_UPDATE_INSTRUCTIONS =
  'Run bin/orca-custom install from the orca-custom repository to install the latest custom build. A custom build for this upstream release may not be available yet.'

export function isCustomBuild(version: string): boolean {
  return /\+custom\.\d+$/.test(version)
}
