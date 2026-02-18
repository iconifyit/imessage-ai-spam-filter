/**
 * @fileoverview Type Definition Loader
 *
 * Loads classification type definitions from YAML configuration files.
 *
 * @module config/loadTypes
 */

import { readFileSync, existsSync } from "fs";
import { parse as parseYaml } from "yaml";
import type { TypeDefinition } from "../domain/classifiers/SMSClassifier.js";

/**
 * Raw type definition from YAML file
 */
interface RawTypeDefinition {
    id: string;
    description: string;
    examples?: string[];
}

/**
 * YAML file structure
 */
interface TypesYamlFile {
    types: RawTypeDefinition[];
}

/**
 * Load type definitions from a YAML file.
 *
 * @param filePath - Path to the types.yml file
 * @returns Array of TypeDefinition objects
 * @throws Error if file doesn't exist or is invalid
 *
 * @example
 * ```typescript
 * const types = loadTypeDefinitions("./config/types.yml");
 * console.log(types);
 * // [{ id: "spam", description: "Spam messages" }, ...]
 * ```
 */
export function loadTypeDefinitions(filePath: string): TypeDefinition[] {
    if (!existsSync(filePath)) {
        throw new Error(`Type definitions file not found: ${filePath}`);
    }

    const content = readFileSync(filePath, "utf-8");
    const parsed = parseYaml(content) as TypesYamlFile;

    if (!parsed?.types || !Array.isArray(parsed.types)) {
        throw new Error("Invalid types file format: expected { types: [...] }");
    }

    // Validate and transform each type definition
    return parsed.types.map((raw, index) => {
        if (!raw.id || typeof raw.id !== "string") {
            throw new Error(`Invalid type at index ${index}: missing or invalid 'id'`);
        }

        if (!raw.description || typeof raw.description !== "string") {
            throw new Error(`Invalid type at index ${index}: missing or invalid 'description'`);
        }

        const typeDef: TypeDefinition = {
            id         : raw.id,
            description: raw.description,
        };

        if (raw.examples && Array.isArray(raw.examples)) {
            typeDef.examples = raw.examples;
        }

        return typeDef;
    });
}

/**
 * Load type definitions with fallback to default types.
 *
 * @param filePath - Path to the types.yml file
 * @returns Array of TypeDefinition objects
 */
export function loadTypeDefinitionsWithFallback(filePath: string): TypeDefinition[] {
    try {
        return loadTypeDefinitions(filePath);
    }
    catch (error) {
        console.warn(`Failed to load types from ${filePath}:`, error);
        return getDefaultTypes();
    }
}

/**
 * Get default type definitions.
 */
export function getDefaultTypes(): TypeDefinition[] {
    return [
        {
            id         : "spam",
            description: "Spam, scam, or unwanted promotional messages",
        },
        {
            id         : "personal",
            description: "Personal messages from friends, family, or known contacts",
        },
        {
            id         : "promotional",
            description: "Marketing and promotional messages from businesses",
        },
        {
            id         : "transactional",
            description: "Legitimate transactional messages (banks, deliveries, appointments)",
        },
        {
            id         : "verification",
            description: "2FA codes, login verification, security codes",
        },
        {
            id         : "unknown",
            description: "Cannot be classified into other categories",
        },
    ];
}
