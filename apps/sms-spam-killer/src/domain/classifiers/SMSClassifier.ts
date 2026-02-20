/**
 * @fileoverview SMS Classification Plugin
 *
 * Implements the ClassificationPlugin contract for SMS/iMessage classification.
 * Delegates to OpenAI for AI-based classification.
 *
 * @module domain/classifiers/SMSClassifier
 */

import type {
    ClassificationPlugin,
    ClassificationContext,
    ClassificationOutput,
    Entity,
} from "@tagrouter/engine";
import { OpenAIClassifier, type OpenAIClassifierConfig } from "../../classifiers/openai-classifier.js";
import type { SMSMessage } from "../entities/SMSMessage.js";

/**
 * Type definition for classification categories.
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
 * Configuration options for SMSClassificationPlugin.
 */
export interface SMSClassificationPluginConfig {
    /**
     * Type definitions for classification categories.
     * These define what types the classifier can return.
     */
    readonly types: TypeDefinition[];

    /**
     * System prompt for the AI classifier.
     * Use {{categories}} as placeholder for auto-generated category list.
     */
    readonly systemPrompt: string;

    /**
     * OpenAI configuration options.
     */
    readonly openai?: OpenAIClassifierConfig;
}

/**
 * Default system prompt for SMS classification.
 */
const DEFAULT_SMS_SYSTEM_PROMPT = `You are an SMS message classifier. Your job is to categorize incoming text messages.

Categories:
{{categories}}

Respond with a JSON object containing:
- tag: The category ID (must be one of the listed categories)
- confidence: A number between 0 and 1 indicating your confidence
- explanation: A brief explanation of why you chose this category

Be precise and consistent. Focus on the message content and sender information.
When uncertain, use lower confidence scores and consider the "unknown" category.`;

/**
 * Convert an Entity to a ClassifiableItem for the underlying classifier.
 *
 * @param entity - The entity to convert
 * @returns A ClassifiableItem compatible with OpenAIClassifier
 */
function entityToClassifiableItem(entity: Entity<object>): { id: string; content: string; metadata?: Record<string, unknown> } {
    return {
        id      : entity.id,
        content : entity.content,
        metadata: entity.metadata as Record<string, unknown>,
    };
}

/**
 * SMS Classification Plugin
 *
 * Implements the ClassificationPlugin contract for SMS/iMessage messages.
 * Delegates classification to the OpenAIClassifier.
 *
 * @example
 * ```typescript
 * const plugin = new SMSClassificationPlugin({
 *     types: loadedTypes,
 *     systemPrompt: "You are an SMS classifier...",
 * });
 *
 * await plugin.initialize();
 *
 * const result = await plugin.classify(message, context);
 * if (result) {
 *     console.log(result.type, result.confidence);
 * }
 * ```
 */
export class SMSClassificationPlugin implements ClassificationPlugin {
    readonly id: string;
    readonly name        = "SMS Classification Plugin";
    readonly description = "AI-powered SMS/iMessage classifier using OpenAI";

    private openaiClassifier: OpenAIClassifier;
    private config: SMSClassificationPluginConfig;
    private initialized = false;

    /**
     * Create a new SMS classification plugin.
     *
     * @param config - Plugin configuration
     * @param id - Optional custom plugin ID
     */
    constructor(config: SMSClassificationPluginConfig, id: string = "sms-classifier") {
        this.id = id;
        this.config = {
            ...config,
            systemPrompt: config.systemPrompt || DEFAULT_SMS_SYSTEM_PROMPT,
        };

        this.openaiClassifier = new OpenAIClassifier(
            `${id}-openai`,
            config.openai
        );
    }

    /**
     * Initialize the plugin.
     *
     * Configures the underlying OpenAI classifier with type definitions
     * and system prompt.
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        if (this.config.types.length === 0) {
            throw new Error("No type definitions provided. Configure types before initializing.");
        }

        this.openaiClassifier.setSystemPrompt(this.config.systemPrompt);
        await this.openaiClassifier.configure(this.config.types);

        this.initialized = true;
    }

    /**
     * Classify a message and return a classification output.
     *
     * This is the primary method called by the TagRouterEngine.
     *
     * @param message - The SMS message to classify (read-only)
     * @param context - Classification context with config and logger
     * @returns ClassificationOutput or null if unable to classify
     */
    async classify(
        message: Entity<object>,
        context: ClassificationContext
    ): Promise<ClassificationOutput | null> {
        if (!this.initialized) {
            throw new Error("Plugin not initialized. Call initialize() first.");
        }

        const smsMessage = message as unknown as SMSMessage;

        context.logger.debug("Classifying SMS message", {
            messageId: message.id,
            sender   : smsMessage.metadata?.sender,
            length   : message.content.length,
        });

        try {
            const item = entityToClassifiableItem(message);

            const result = await this.openaiClassifier.classify(item, {
                includeExplanation: true,
            });

            context.logger.info("Classification complete", {
                messageId : message.id,
                type      : result.type,
                confidence: result.confidence,
            });

            return {
                type      : result.type,
                confidence: result.confidence,
                tags      : result.explanation ? [result.explanation] : undefined,
            };
        }
        catch (error) {
            context.logger.error("Classification failed", {
                messageId: message.id,
                error    : error instanceof Error ? error.message : String(error),
            });

            // Return unknown classification on error
            return {
                type      : "unknown",
                confidence: 0,
                tags      : [`error: ${error instanceof Error ? error.message : String(error)}`],
            };
        }
    }

    /**
     * Check if the plugin is initialized.
     */
    get isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Get the configured type definitions.
     */
    get types(): readonly TypeDefinition[] {
        return this.config.types;
    }

    /**
     * Update the type definitions.
     *
     * Requires re-initialization after calling.
     *
     * @param types - New type definitions
     */
    setTypes(types: TypeDefinition[]): void {
        this.config = { ...this.config, types };
        this.initialized = false;
    }

    /**
     * Update the system prompt.
     *
     * Requires re-initialization after calling.
     *
     * @param prompt - New system prompt
     */
    setSystemPrompt(prompt: string): void {
        this.config = { ...this.config, systemPrompt: prompt };
        this.initialized = false;
    }
}
