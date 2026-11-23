export const PACK_MANIFEST: string;
export interface PackPlan {
  id: string;
  name: string;
  release: string;
  licences?: Record<string, string>;
  models?: {
    id: string;
    format: string;
    purpose: string[];
    licence: string;
    licenceFile: string;
    folder: string;
  }[];
}
export function makeManifest(top: string, plan: PackPlan): Promise<unknown>;
