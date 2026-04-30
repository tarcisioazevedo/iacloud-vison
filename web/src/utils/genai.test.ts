import { describe, expect, it } from "vitest";
import type { FrigateConfig } from "@/types/frigateConfig";
import {
  getGenAIProviderDisplayName,
  getGenAIProviderForRole,
  hasGenAIRole,
} from "@/utils/genai";

describe("genai utils", () => {
  const config = {
    genai: {
      local_vision: {
        provider: "ollama",
        model: "qwen3-vl:4b",
        roles: ["chat", "descriptions"],
      },
      embeddings_api: {
        provider: "openai",
        model: "text-embedding-3-large",
        roles: ["embeddings"],
      },
    },
  } as Pick<FrigateConfig, "genai">;

  it("resolves providers by role", () => {
    expect(getGenAIProviderForRole(config, "chat")).toMatchObject({
      key: "local_vision",
      config: { provider: "ollama" },
    });
    expect(getGenAIProviderForRole(config, "embeddings")).toMatchObject({
      key: "embeddings_api",
      config: { provider: "openai" },
    });
  });

  it("reports role availability", () => {
    expect(hasGenAIRole(config, "chat")).toBe(true);
    expect(hasGenAIRole(config, "descriptions")).toBe(true);
    expect(hasGenAIRole(config, "embeddings")).toBe(true);
  });

  it("returns a formatted provider label for a role", () => {
    expect(
      getGenAIProviderDisplayName(config, "descriptions", "Generative AI"),
    ).toBe("Ollama");
    expect(
      getGenAIProviderDisplayName(config, "embeddings", "Generative AI"),
    ).toBe("Openai");
  });

  it("falls back when a role is unavailable", () => {
    expect(hasGenAIRole({ genai: {} }, "chat")).toBe(false);
    expect(
      getGenAIProviderDisplayName({ genai: {} }, "chat", "Generative AI"),
    ).toBe("Generative AI");
  });
});
