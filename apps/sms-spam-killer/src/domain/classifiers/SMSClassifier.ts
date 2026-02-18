/**
 * @fileoverview SMS Classifier
 *
 * Implements the Classifier contract for SMS/iMessage classification.
 * Delegates to OpenAI for AI-based classification.
 *
 * This classifier:
 * - Loads type definitions from configuration
 * - Uses OpenAI for AI-based classification
 * - Returns ClassifierResult with proper Classification shape
 *
 * @module domain/classifiers/SMSClassifier
 */

import type {
    Classifier,
    ClassifierResult,
    ClassifierContext,
    Entity,
} from "@tagrouter/engine";
import { createClassification } from "@tagrouter/engine";
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
 * Configuration options for SMSClassifier.
 */
export interface SMSClassifierConfig {
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

    /**
     * Whether to halt the classifier chain on successful classification.
     * Defaults to false.
     */
    readonly haltOnClassification?: boolean;
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
 * SMS Classifier
 *
 * Implements the Classifier contract for SMS/iMessage messages.
 * Delegates classification to the OpenAIClassifier.
 *
 * @example
 * ```typescript
 * const classifier = new SMSClassifier({
 *     types: loadedTypes,
 *     systemPrompt: "You are an SMS classifier...",
 * });
 *
 * await classifier.initialize();
 *
 * const result = await classifier.evaluate(entity, context);
 * if (result) {
 *     console.log(result.classification.type);
 * }
 * ```
 */
export class SMSClassifier implements Classifier {
    readonly id: string;
    readonly name        = "SMS Classifier";
    readonly description = "AI-powered SMS/iMessage classifier using OpenAI";

    private openaiClassifier: OpenAIClassifier;
    private config: SMSClassifierConfig;
    private initialized = false;

    /**
     * Create a new SMS classifier.
     *
     * @param config - Classifier configuration
     * @param id - Optional custom classifier ID
     */
    constructor(config: SMSClassifierConfig, id: string = "sms-classifier") {
        this.id = id;
        this.config = {
            ...config,
            systemPrompt        : config.systemPrompt || DEFAULT_SMS_SYSTEM_PROMPT,
            haltOnClassification: config.haltOnClassification ?? false,
        };

        this.openaiClassifier = new OpenAIClassifier(
            `${id}-openai`,
            config.openai
        );
    }

    /**
     * Initialize the classifier.
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

        // Set system prompt and configure with types
        this.openaiClassifier.setSystemPrompt(this.config.systemPrompt);
        await this.openaiClassifier.configure(this.config.types);

        this.initialized = true;
    }

    /**
     * Evaluate an entity and return a classification result.
     *
     * This is the primary method called by the TagRouterEngine.
     *
     * @param entity - The SMS message entity to evaluate
     * @param context - Evaluation context with config and logger
     * @returns ClassifierResult with classification, or null if unable to classify
     */
    async evaluate(
        entity: Entity<object>,
        context: ClassifierContext
    ): Promise<ClassifierResult | null> {
        if (!this.initialized) {
            throw new Error("Classifier not initialized. Call initialize() first.");
        }

        // Cast through unknown since Entity<object> doesn't overlap with SMSMessage
        const smsEntity = entity as unknown as SMSMessage;

        context.logger.debug("Evaluating SMS message", {
            entityId: entity.id,
            sender  : smsEntity.metadata?.sender,
            length  : entity.content.length,
        });

        try {
            // Convert entity to ClassifiableItem for the OpenAI classifier
            const item = entityToClassifiableItem(entity);

            // Call the underlying classifier
            const oldClassification = await this.openaiClassifier.classify(item, {
                includeExplanation: true,
            });

            // Convert old Classification format to new contract format
            const classification = createClassification(
                oldClassification.type,
                oldClassification.confidence,
                oldClassification.explanation || "Classified by AI",
                this.id
            );

            context.logger.info("Classification complete", {
                entityId  : entity.id,
                type      : classification.type,
                confidence: classification.confidence,
            });

            return {
                classification,
                halt       : this.config.haltOnClassification,
                annotations: {
                    model : this.config.openai?.model || "gpt-4o-mini",
                    sender: smsEntity.metadata?.sender,
                },
            };
        }
        catch (error) {
            context.logger.error("Classification failed", {
                entityId: entity.id,
                error   : error instanceof Error ? error.message : String(error),
            });

            // Return unknown classification on error rather than throwing
            const unknownType = this.config.types.find(t => t.id === "unknown");
            const classification = createClassification(
                unknownType?.id || "unknown",
                0,
                `Classification error: ${error instanceof Error ? error.message : String(error)}`,
                this.id
            );

            return {
                classification,
                halt       : false,
                annotations: { error: true },
            };
        }
    }

    /**
     * Check if the classifier is initialized.
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
