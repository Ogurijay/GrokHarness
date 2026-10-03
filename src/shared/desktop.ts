export type DesktopState = {
  version: string;
  packaged: boolean;
  cli: {
    installed: boolean;
    authenticated: boolean;
    checking: boolean;
    loggingIn: boolean;
    binary?: string;
    version?: string;
    error?: string;
  };
  update: {
    phase: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
    latestVersion?: string;
    percent?: number;
    message?: string;
    error?: string;
  };
};

export const DESKTOP_RELEASES = "https://github.com/Ogurijay/GrokHarness/releases";
export const GROK_INSTALL_GUIDE = "https://github.com/xai-org/grok-build";

export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (value: string) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
  const next = parse(candidate);
  const present = parse(current);
  if (!next || !present) return false;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(next[i]) - Number(present[i]);
    if (diff) return diff > 0;
  }
  return false;
}

export function hasWindowsUpdateAssets(assets: unknown): boolean {
  if (!Array.isArray(assets)) return false;
  const names = assets.map((asset) => typeof asset?.name === "string" ? asset.name : "");
  return names.includes("latest.yml") && names.some((name) => /^Grok-Harness-Setup-\d+\.\d+\.\d+\.exe$/.test(name));
}
