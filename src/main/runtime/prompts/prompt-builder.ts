/**
 * PromptBuilder — centralized registry for prompt templates with Zod
 * schema validation of template parameters.
 *
 * Every prompt in the Ralph agent pipeline is registered here by name.
 * Templates are pure functions that receive a validated params object and
 * return a prompt string.
 *
 * Usage:
 * ```ts
 * import { prompts } from "./prompts";
 * const text = prompts.render("discovery-start", { seedSentence, ... });
 * ```
 */

import type { z, ZodType } from "zod";

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** A registered prompt template: its Zod schema + render function. */
export interface PromptTemplate<TSchema extends ZodType = ZodType> {
  /** Human-readable description of what this prompt does. */
  readonly description: string;
  /** Zod schema that validates the template parameters. */
  readonly schema: TSchema;
  /** Pure render function — returns the final prompt string. */
  readonly render: (params: z.infer<TSchema>) => string;
}

/**
 * Type-safe mapping from prompt name → PromptTemplate.
 * This is the registry contract; the concrete map is populated at module load.
 */
export type PromptRegistry = Record<string, PromptTemplate>;

// ---------------------------------------------------------------------------
// PromptBuilder class
// ---------------------------------------------------------------------------

export class PromptBuilder {
  private readonly templates = new Map<string, PromptTemplate>();

  /**
   * Register a named prompt template.
   * Throws if a template with the same name is already registered.
   */
  register<TSchema extends ZodType>(name: string, template: PromptTemplate<TSchema>): void {
    if (this.templates.has(name)) {
      throw new Error(`PromptBuilder: duplicate template name "${name}".`);
    }
    this.templates.set(name, template as PromptTemplate);
  }

  /**
   * Render a prompt by name, validating params against the registered schema.
   * Throws if the template name is unknown or params fail validation.
   */
  render<TParams = unknown>(name: string, params: TParams): string {
    const template = this.templates.get(name);
    if (!template) {
      throw new Error(`PromptBuilder: unknown template "${name}".`);
    }
    const validated = template.schema.parse(params);
    return template.render(validated);
  }

  /**
   * Check whether a template with the given name is registered.
   */
  has(name: string): boolean {
    return this.templates.has(name);
  }

  /**
   * Return an array of all registered template names.
   */
  list(): string[] {
    return [...this.templates.keys()];
  }

  /**
   * Return the raw template definition for a given name, or undefined.
   * Useful for testing or introspection.
   */
  get(name: string): PromptTemplate | undefined {
    return this.templates.get(name);
  }
}
