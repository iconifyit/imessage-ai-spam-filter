/**
 * OpenAI-based text classifier
 *
 * Uses GPT models to classify messages into configured categories.
 * Supports structured output for reliable JSON responses.
 */

import OpenAI from "openai";

/**
 * Type definition for classification categories.
 * Aligned with @tagrouter/engine expectations.
 */
export interface TypeDefinition {
    /** Unique identifier for this type */
    readonly id: string;

    /** Human-readable description */
    readonly description: string;

    /** Optional examples */
    examples?: string[];
}

/**
 * Item that can be classified
 */
export interface ClassifiableItem {
    /** Unique identifier */
    id: string;

    /** Content to classify */
    content: string;

    /** Optional metadata (e.g., sender info) */
    metadata?: Record<string, unknown>;
}

/**
 * Options for classification
 */
export interface ClassifyOptions {
    /** Include explanation in result */
    includeExplanation?: boolean;

    /** Additional context for classification */
    context?: Record<string, unknown>;
}

/**
 * Classification result from the OpenAI classifier
 */
export interface Classification {
    /** Classification type (e.g., "spam", "personal") */
    type: string;

    /** Confidence score between 0.0 and 1.0 */
    confidence: number;

    /** Explanation for the classification */
    explanation?: string;

    /** Identifier of the classifier that produced this */
    classifierId: string;
}

/**
 * Configuration options for the OpenAI classifier
 */
export interface OpenAIClassifierConfig {
    /** OpenAI API key (defaults to OPENAI_API_KEY env var) */
    apiKey?: string;

    /** Model to use (default: gpt-4o-mini) */
    model?: string;

    /** Temperature for responses (default: 0.1 for consistency) */
    temperature?: number;

    /** Maximum tokens for response */
    maxTokens?: number;

    /**
     * Custom system prompt template.
     *
     * Use {{categories}} as a placeholder for the auto-generated category list.
     * If not provided, you must set the full prompt via setSystemPrompt().
     *
     * Example:
     * ```
     * You are an email classifier for a support system.
     *
     * Categories:
     * {{categories}}
     *
     * Respond with JSON containing: tag, confidence, explanation
     * ```
     */
    systemPrompt?: string;
}

/**
 * Build the category list from tag definitions
 */
function buildCategoryList(tags: TypeDefinition[]): string {
    return tags
        .map(tag => {
            const examples = tag.examples?.length
                ? `\n    Examples: ${tag.examples.map(e => `"${e}"`).join(", ")}`
                : "";
            return `  - ${tag.id}: ${tag.description}${examples}`;
        })
        .join("\n");
}

/**
 * Build the user prompt for an item
 */
function buildUserPrompt(
    item: ClassifiableItem,
    context?: Record<string, unknown>
): string {
    let prompt = `Classify this message:`;

    // Get sender from metadata if available (narrow to string for type safety)
    const sender = item.metadata?.sender;
    if (typeof sender === "string" && sender.trim().length > 0) {
        prompt += `\n\nSender: ${sender}`;
    }

    prompt += `\nMessage: "${item.content}"`;

    if (context && Object.keys(context).length > 0) {
        prompt += `\n\nContext:`;
        for (const [key, value] of Object.entries(context)) {
            prompt += `\n- ${key}: ${value}`;
        }
    }

    return prompt;
}

/**
 * OpenAI-based classifier implementation
 */
export class OpenAIClassifier {
    readonly id: string;
    readonly name: string = "OpenAI Classifier";

    private client: OpenAI;
    private config: Required<Omit<OpenAIClassifierConfig, "apiKey" | "systemPrompt">> & {
        systemPrompt?: string;
    };
    private tags: TypeDefinition[] = [];
    private systemPrompt: string = "";

    constructor(id: string = "openai", config: OpenAIClassifierConfig = {}) {
        this.id = id;

        this.client = new OpenAI({
            apiKey: config.apiKey ?? process.env.OPENAI_API_KEY,
        });

        this.config = {
            model      : config.model ?? "gpt-4o-mini",
            temperature: config.temperature ?? 0.1,
            maxTokens  : config.maxTokens ?? 256,
            systemPrompt: config.systemPrompt,
        };
    }

    /**
     * Set a custom system prompt.
     *
     * Use {{categories}} as a placeholder for the auto-generated category list.
     * If no placeholder is found, categories will be appended.
     *
     * @param prompt - The system prompt template
     */
    setSystemPrompt(prompt: string): void {
        this.config.systemPrompt = prompt;
        // Rebuild if tags are already configured
        if (this.tags.length > 0) {
            this.buildPrompt();
        }
    }

    /**
     * Build the final system prompt from template and tags
     */
    private buildPrompt(): void {
        const categoryList = buildCategoryList(this.tags);

        if (this.config.systemPrompt) {
            // User provided a custom prompt
            if (this.config.systemPrompt.includes("{{categories}}")) {
                // Replace placeholder with category list
                this.systemPrompt = this.config.systemPrompt.replace(
                    "{{categories}}",
                    categoryList
                );
            }
            else {
                // Append categories to the end
                this.systemPrompt = `${this.config.systemPrompt}\n\nCategories:\n${categoryList}`;
            }
        }
        else {
            // No custom prompt - require user to set one
            throw new Error(
                "No system prompt configured. Use setSystemPrompt() or pass systemPrompt in config."
            );
        }
    }

    /**
     * Configure the classifier with tag definitions
     */
    async configure(tags: TypeDefinition[]): Promise<void> {
        this.tags = tags;
        this.buildPrompt();
    }

    /**
     * Classify a single item
     */
    async classify(
        item: ClassifiableItem,
        options?: ClassifyOptions
    ): Promise<Classification> {
        if (this.tags.length === 0) {
            throw new Error("Classifier not configured. Call configure() with tag definitions first.");
        }

        const userPrompt = buildUserPrompt(item, options?.context);

        try {
            const response = await this.client.chat.completions.create({
                model          : this.config.model,
                temperature    : this.config.temperature,
                max_tokens     : this.config.maxTokens,
                response_format: { type: "json_object" },
                messages       : [
                    { role: "system", content: this.systemPrompt },
                    { role: "user", content: userPrompt },
                ],
            });

            const content = response.choices[0]?.message?.content;

            if (!content) {
                throw new Error("No response from OpenAI");
            }

            const result = JSON.parse(content) as {
                tag: string;
                confidence: number;
                explanation?: string;
            };

            // Validate the tag is one we know about
            const validTag = this.tags.some(t => t.id === result.tag);
            if (!validTag) {
                // Fall back to "unknown" if available, otherwise use first tag
                const unknownTag = this.tags.find(t => t.id === "unknown");
                result.tag = unknownTag?.id ?? this.tags[0].id;
                result.confidence = Math.min(result.confidence, 0.5);
            }

            return {
                type        : result.tag,
                confidence  : result.confidence,
                explanation : (options?.includeExplanation && result.explanation) ? result.explanation : "Classified by OpenAI",
                classifierId: this.id,
            };
        }
        catch (error) {
            // On error, return unknown with low confidence
            const unknownTag = this.tags.find((t) => t.id === "unknown");

            return {
                type        : unknownTag?.id ?? this.tags[0]?.id ?? "unknown",
                confidence  : 0,
                explanation : `Classification failed: ${error instanceof Error ? error.message : String(error)}`,
                classifierId: this.id,
            };
        }
    }

    /**
     * Classify multiple items in batch
     *
     * Note: This implementation calls classify() sequentially.
     * For high throughput, consider implementing parallel calls with rate limiting.
     */
    async classifyBatch(
        items: ClassifiableItem[],
        options?: ClassifyOptions
    ): Promise<Classification[]> {
        const results: Classification[] = [];

        for (const item of items) {
            const classification = await this.classify(item, options);
            results.push(classification);
        }

        return results;
    }
}
