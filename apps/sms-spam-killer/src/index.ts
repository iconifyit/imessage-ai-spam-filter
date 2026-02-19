/**
 * @fileoverview SMS Spam Killer - Main Entry Point
 *
 * This is the main entry point for the SMS Spam Killer application.
 * It uses the TagRouterEngine to wire together the domain components
 * (provider, classifiers, actions) and orchestrate the processing pipeline.
 *
 * @module sms-spam-killer
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Engine
import { TagRouterEngine, type DomainRegistration } from "@tagrouter/engine";

// Domain components
import {
    IMessageEntityProvider,
    SMSClassificationPlugin,
    DeleteSpamActionPlugin,
    NotifySpamActionPlugin,
} from "./domain/index.js";

// Config loader
import { loadTypeDefinitionsWithFallback } from "./config/index.js";

// Get directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Application configuration
 */
interface AppConfig {
    /** Polling interval in milliseconds */
    pollingInterval: number;

    /** Dry run mode - don't actually delete */
    dryRun: boolean;

    /** System prompt for the classifier */
    systemPrompt: string;
}

/**
 * Default system prompt for SMS classification
 */
const DEFAULT_SYSTEM_PROMPT = `You are an SMS message classifier. Your job is to categorize incoming text messages.

Categories:
{{categories}}

Respond with a JSON object containing:
- tag: The category ID (must be one of the listed categories)
- confidence: A number between 0 and 1 indicating your confidence
- explanation: A brief explanation of why you chose this category

Be precise and consistent. Focus on the message content and sender information.
When uncertain, use lower confidence scores and consider the "unknown" category.`;

/**
 * Create the SMS domain registration for the TagRouterEngine.
 *
 * @param config - Application configuration
 * @returns Domain registration with provider, classifiers, and actions
 */
async function createSMSDomain(config: AppConfig): Promise<DomainRegistration> {
    // Load type definitions
    const typesPath = join(__dirname, "..", "config", "types.yml");
    const types = loadTypeDefinitionsWithFallback(typesPath);

    console.log(`[INFO] Loaded ${types.length} type definitions`);

    // Create provider
    const provider = new IMessageEntityProvider({
        inboundOnly: true,
    });

    // Create classifier plugin
    const classifier = new SMSClassificationPlugin({
        types,
        systemPrompt: config.systemPrompt,
    });

    // Initialize classifier (loads OpenAI config)
    await classifier.initialize();

    // Create action plugins
    const actions = [
        new NotifySpamActionPlugin({
            bindings: {
                spam          : { minConfidence: 0.7 },
                scam          : { minConfidence: 0.7 },
                political_spam: { minConfidence: 0.7 },
            },
        }),
        new DeleteSpamActionPlugin({
            bindings: {
                spam: { minConfidence: 0.9 },
                scam: { minConfidence: 0.9 },
            },
            dryRun: config.dryRun,
        }),
    ];

    return {
        id         : "sms",
        name       : "SMS Spam Killer",
        provider,
        classifiers: [classifier],
        actions,
        config     : {
            dryRun: config.dryRun,
        },
    };
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
    console.log("=".repeat(60));
    console.log("SMS Spam Killer v2.0.0 (TagRouterEngine)");
    console.log("=".repeat(60));

    // Parse CLI args
    const args = process.argv.slice(2);
    const dryRun = !args.includes("--live");

    if (dryRun) {
        console.log("\n⚠️  DRY RUN MODE - No messages will be deleted");
        console.log("   Use --live to enable actual deletion\n");
    }
    else {
        console.log("\n🔴 LIVE MODE - Messages WILL be deleted\n");
    }

    // Build configuration
    const config: AppConfig = {
        pollingInterval: 30000, // 30 seconds
        dryRun,
        systemPrompt   : DEFAULT_SYSTEM_PROMPT,
    };

    // Create the engine
    const engine = new TagRouterEngine({
        pollingInterval: config.pollingInterval,
        batchSize      : 10,
    });

    // Subscribe to engine events for observability
    engine.eventBus.subscribe("engine:started", () => {
        console.log(`[ENGINE] Started - polling every ${config.pollingInterval}ms`);
    });

    engine.eventBus.subscribe("engine:stopped", () => {
        console.log("[ENGINE] Stopped");
    });

    engine.eventBus.subscribe("message:classified", (event) => {
        const data = event.data as { messageId: string; type: string; confidence: number };
        console.log(`[CLASSIFIED] ${data.messageId}: ${data.type} (${(data.confidence * 100).toFixed(0)}%)`);
    });

    engine.eventBus.subscribe("message:unclassified", (event) => {
        const data = event.data as { messageId: string };
        console.log(`[UNCLASSIFIED] ${data.messageId}: No classification match`);
    });

    engine.eventBus.subscribe("message:actionExecuted", (event) => {
        const data = event.data as { messageId: string; actionId: string; success: boolean; error?: string };
        const status = data.success ? "✓" : "✗";
        console.log(`[ACTION] ${status} ${data.actionId} for ${data.messageId}${data.error ? `: ${data.error}` : ""}`);
    });

    engine.eventBus.subscribe("engine:error", (event) => {
        console.error("[ENGINE ERROR]", event.data);
    });

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
        console.log("\nShutting down...");
        await engine.stop();
        process.exit(0);
    });

    process.on("SIGTERM", async () => {
        await engine.stop();
        process.exit(0);
    });

    try {
        // Create and register the SMS domain
        const smsDomain = await createSMSDomain(config);
        engine.registerDomain(smsDomain);

        // Start the engine
        await engine.start();

        console.log("\n[INFO] SMS Spam Killer is running. Press Ctrl+C to stop.\n");
    }
    catch (error) {
        console.error("[FATAL] Failed to start application:", error);
        process.exit(1);
    }
}

// Run if this is the main module
main().catch(console.error);

// Export for testing
export { createSMSDomain };
