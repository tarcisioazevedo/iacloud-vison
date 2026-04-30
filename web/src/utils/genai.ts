import type {
  FrigateConfig,
  GenAIProviderConfig,
  GenAIRole,
} from "@/types/frigateConfig";
import { capitalizeAll } from "./stringUtil";

export type GenAIProviderWithKey = {
  key: string;
  config: GenAIProviderConfig;
};

type ConfigWithGenAI = Pick<FrigateConfig, "genai"> | undefined;

export function getGenAIProviderForRole(
  config: ConfigWithGenAI,
  role: GenAIRole,
): GenAIProviderWithKey | null {
  if (!config?.genai) {
    return null;
  }

  for (const [key, providerConfig] of Object.entries(config.genai)) {
    if (
      providerConfig.provider &&
      Array.isArray(providerConfig.roles) &&
      providerConfig.roles.includes(role)
    ) {
      return { key, config: providerConfig };
    }
  }

  return null;
}

export function hasGenAIRole(
  config: ConfigWithGenAI,
  role: GenAIRole,
): boolean {
  return getGenAIProviderForRole(config, role) !== null;
}

export function getGenAIProviderDisplayName(
  config: ConfigWithGenAI,
  role: GenAIRole,
  fallback: string,
): string {
  const provider = getGenAIProviderForRole(config, role);

  if (!provider) {
    return fallback;
  }

  return capitalizeAll(provider.config.provider || provider.key);
}
