/**
 * @fileoverview Unit tests for senderList utility functions
 *
 * Tests cover:
 * - parseListFile: parsing text files with entries, comments, and blank lines
 * - parseContactsFile: parsing JSON contact files with phone/email extraction
 * - senderMatchesList: matching senders against lists using exact, partial, and phone normalization
 * - Edge cases: missing files, invalid JSON, empty entries, phone number variations
 * - Error handling: graceful failures for file read errors
 *
 * @module domain/utils/__tests__/senderList
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	parseListFile,
	parseContactsFile,
	senderMatchesList,
	type ContactEntry,
} from "../domain/utils/senderList.js";

/**
 * Fixed test timestamp for consistent test results.
 * All dates derived relative to this time.
 */
const TEST_TIME = "2025-02-15T10:00:00.000Z";

// Mock the fs module for file system operations
vi.mock("fs", () => ({
	readFileSync : vi.fn(),
	existsSync   : vi.fn(),
}));

import { readFileSync, existsSync } from "fs";

const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);

describe("parseListFile", () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		consoleErrorSpy.mockRestore();
		vi.clearAllMocks();
	});

	// Scenario: Parse valid file with entries, comments, and blank lines
	it("should parse valid file with entries, comments, and blank lines", () => {
		const fileContent = `# Friends list
+15551234567
mom@icloud.com

# Work contacts
boss@company.com
+18005559999`;

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(fileContent as any);

		const result = parseListFile("/path/to/friends.txt");

		expect(result).toEqual([
			"+15551234567",
			"mom@icloud.com",
			"boss@company.com",
			"+18005559999",
		]);
	});

	// Scenario: Parse file and normalize all entries to lowercase
	it("should normalize all entries to lowercase", () => {
		const fileContent = `JOHN@EXAMPLE.COM
Mary.Smith@Yahoo.Com
+15551234567`;

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(fileContent as any);

		const result = parseListFile("/path/to/contacts.txt");

		expect(result).toEqual([
			"john@example.com",
			"mary.smith@yahoo.com",
			"+15551234567",
		]);
	});

	// Scenario: Trim whitespace from entries
	it("should trim leading and trailing whitespace from entries", () => {
		const fileContent = `  +15551234567
   dad@gmail.com

  MOM  `;

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(fileContent as any);

		const result = parseListFile("/path/to/list.txt");

		expect(result).toEqual(["+15551234567", "dad@gmail.com", "mom"]);
	});

	// Scenario: Return empty array for non-existent file
	it("should return empty array for non-existent file", () => {
		mockExistsSync.mockReturnValue(false);

		const result = parseListFile("/path/to/nonexistent.txt");

		expect(result).toEqual([]);
		expect(mockReadFileSync).not.toHaveBeenCalled();
	});

	// Scenario: Return empty array for empty file
	it("should return empty array for empty file", () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue("" as any);

		const result = parseListFile("/path/to/empty.txt");

		expect(result).toEqual([]);
	});

	// Scenario: Return empty array for file with only comments
	it("should return empty array for file with only comments", () => {
		const fileContent = `# This is a comment
# Another comment
# Just comments here`;

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(fileContent as any);

		const result = parseListFile("/path/to/comments.txt");

		expect(result).toEqual([]);
	});

	// Scenario: Return empty array for file with only blank lines
	it("should return empty array for file with only blank lines", () => {
		const fileContent = `



`;

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(fileContent as any);

		const result = parseListFile("/path/to/blank.txt");

		expect(result).toEqual([]);
	});

	// Scenario: Handle file read errors gracefully
	it("should handle file read errors gracefully and return empty array", () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockImplementation(() => {
			throw new Error("Permission denied");
		});

		const result = parseListFile("/path/to/restricted.txt");

		expect(result).toEqual([]);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Error reading list file"),
			expect.any(Error)
		);
	});

	// Scenario: Ignore lines starting with # (comments)
	it("should ignore lines starting with # anywhere in the file", () => {
		const fileContent = `#commented.email@example.com
valid@example.com
# Another comment
+15551234567
#spam@bad.com`;

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(fileContent as any);

		const result = parseListFile("/path/to/mixed.txt");

		expect(result).toEqual(["valid@example.com", "+15551234567"]);
	});

	// Scenario: Preserve special characters and formatting in entries
	it("should preserve special characters in phone numbers and emails", () => {
		const fileContent = `+1 (555) 123-4567
contact+tag@example.com
+44-20-7946-0958`;

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(fileContent as any);

		const result = parseListFile("/path/to/formatted.txt");

		expect(result).toEqual([
			"+1 (555) 123-4567",
			"contact+tag@example.com",
			"+44-20-7946-0958",
		]);
	});
});

describe("parseContactsFile", () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		consoleErrorSpy.mockRestore();
		vi.clearAllMocks();
	});

	// Scenario: Parse contacts with phone numbers
	it("should parse contacts with phone numbers", () => {
		const contacts: ContactEntry[] = [
			{
				firstName : "John",
				lastName  : "Doe",
				name      : "John Doe",
				email     : "",
				phone     : "+15551234567",
			},
			{
				firstName : "Jane",
				lastName  : "Smith",
				name      : "Jane Smith",
				email     : "",
				phone     : "(804) 555-9876",
			},
		];

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(contacts) as any);

		const result = parseContactsFile("/path/to/contacts.json");

		expect(result).toEqual(["+15551234567", "(804) 555-9876"]);
	});

	// Scenario: Parse contacts with email addresses
	it("should parse contacts with email addresses", () => {
		const contacts: ContactEntry[] = [
			{
				firstName : "Bob",
				lastName  : "Johnson",
				name      : "Bob Johnson",
				email     : "bob@example.com",
				phone     : "",
			},
			{
				firstName : "Alice",
				lastName  : "Brown",
				name      : "Alice Brown",
				email     : "alice@company.org",
				phone     : "",
			},
		];

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(contacts) as any);

		const result = parseContactsFile("/path/to/contacts.json");

		expect(result).toEqual(["bob@example.com", "alice@company.org"]);
	});

	// Scenario: Parse contacts with both phone and email (produces two entries per contact)
	it("should parse contacts with both phone and email, producing two entries per contact", () => {
		const contacts: ContactEntry[] = [
			{
				firstName : "Mom",
				lastName  : "Smith",
				name      : "Mom Smith",
				email     : "mom@icloud.com",
				phone     : "(804) 555-1234",
			},
		];

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(contacts) as any);

		const result = parseContactsFile("/path/to/contacts.json");

		expect(result).toEqual(["(804) 555-1234", "mom@icloud.com"]);
	});

	// Scenario: Skip contacts with neither phone nor email
	it("should skip contacts with neither phone nor email", () => {
		const contacts: ContactEntry[] = [
			{
				firstName : "John",
				lastName  : "Doe",
				name      : "John Doe",
				email     : "",
				phone     : "+15551234567",
			},
			{
				firstName : "Nobody",
				lastName  : "Important",
				name      : "Nobody Important",
				email     : "",
				phone     : "",
			},
			{
				firstName : "Jane",
				lastName  : "Smith",
				name      : "Jane Smith",
				email     : "jane@example.com",
				phone     : "",
			},
		];

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(contacts) as any);

		const result = parseContactsFile("/path/to/contacts.json");

		expect(result).toEqual(["+15551234567", "jane@example.com"]);
	});

	// Scenario: Normalize all entries to lowercase
	it("should normalize all entries to lowercase", () => {
		const contacts: ContactEntry[] = [
			{
				firstName : "John",
				lastName  : "Doe",
				name      : "John Doe",
				email     : "JOHN@EXAMPLE.COM",
				phone     : "+1 (555) 234-5678",
			},
			{
				firstName : "Bob",
				lastName  : "Johnson",
				name      : "Bob Johnson",
				email     : "Bob.Johnson@Company.Org",
				phone     : "",
			},
		];

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(contacts) as any);

		const result = parseContactsFile("/path/to/contacts.json");

		expect(result).toEqual([
			"+1 (555) 234-5678",
			"john@example.com",
			"bob.johnson@company.org",
		]);
	});

	// Scenario: Return empty array for non-existent file
	it("should return empty array for non-existent file", () => {
		mockExistsSync.mockReturnValue(false);

		const result = parseContactsFile("/path/to/nonexistent.json");

		expect(result).toEqual([]);
		expect(mockReadFileSync).not.toHaveBeenCalled();
	});

	// Scenario: Return empty array for invalid JSON
	it("should return empty array for invalid JSON", () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue("{ invalid json }" as any);

		const result = parseContactsFile("/path/to/invalid.json");

		expect(result).toEqual([]);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Error reading contacts file"),
			expect.any(Error)
		);
	});

	// Scenario: Return empty array for non-array JSON
	it("should return empty array for non-array JSON", () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify({ name: "not an array" }) as any);

		const result = parseContactsFile("/path/to/invalid.json");

		expect(result).toEqual([]);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Contacts file is not an array")
		);
	});

	// Scenario: Handle empty contacts array
	it("should handle empty contacts array", () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify([]) as any);

		const result = parseContactsFile("/path/to/empty.json");

		expect(result).toEqual([]);
	});

	// Scenario: Handle file read errors gracefully
	it("should handle file read errors gracefully and return empty array", () => {
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockImplementation(() => {
			throw new Error("Access denied");
		});

		const result = parseContactsFile("/path/to/restricted.json");

		expect(result).toEqual([]);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Error reading contacts file"),
			expect.any(Error)
		);
	});

	// Scenario: Extract multiple phone/email combinations from various formats
	it("should extract from realistically formatted contact entries", () => {
		const contacts: ContactEntry[] = [
			{
				firstName : "Sarah",
				lastName  : "Williams",
				name      : "Sarah Williams",
				email     : "Sarah.Williams@TechCorp.com",
				phone     : "+1 (650) 253-0000",
			},
			{
				firstName : "Marcus",
				lastName  : "Brown",
				name      : "Marcus Brown",
				email     : "marcus@startup.io",
				phone     : "415-555-0133",
			},
			{
				firstName : "Lisa",
				lastName  : "Garcia",
				name      : "Lisa Garcia",
				email     : "lisa.garcia+work@email.com",
				phone     : "+44 20 7946 0958",
			},
		];

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(contacts) as any);

		const result = parseContactsFile("/path/to/contacts.json");

		expect(result).toEqual([
			"+1 (650) 253-0000",
			"sarah.williams@techcorp.com",
			"415-555-0133",
			"marcus@startup.io",
			"+44 20 7946 0958",
			"lisa.garcia+work@email.com",
		]);
	});
});

describe("senderMatchesList", () => {
	// Scenario: Exact match (case-insensitive)
	it("should match exact sender against list entry (case-insensitive)", () => {
		const list = ["+15551234567", "mom@icloud.com", "dad"];

		expect(senderMatchesList("+15551234567", list)).toBe(true);
		expect(senderMatchesList("+15551234567", list)).toBe(true);
		expect(senderMatchesList("MOM@ICLOUD.COM", list)).toBe(true);
		expect(senderMatchesList("Mom@ICloud.Com", list)).toBe(true);
		expect(senderMatchesList("DAD", list)).toBe(true);
		expect(senderMatchesList("DaD", list)).toBe(true);
	});

	// Scenario: Partial match — sender contains entry
	it("should match when sender contains entry (partial match)", () => {
		const list = ["spam alert", "suspicious"];

		expect(senderMatchesList("Important: spam alert notification", list)).toBe(
			true
		);
		expect(senderMatchesList("SPAM ALERT SCAM", list)).toBe(true);
		expect(senderMatchesList("This is suspicious activity", list)).toBe(true);
	});

	// Scenario: Partial match — entry contains sender
	it("should match when entry contains sender (partial match)", () => {
		const list = ["crypto alerts and notifications", "finance news"];

		expect(senderMatchesList("crypto alerts", list)).toBe(true);
		expect(senderMatchesList("CRYPTO ALERTS", list)).toBe(true);
		expect(senderMatchesList("alerts", list)).toBe(true);
		expect(senderMatchesList("finance", list)).toBe(true);
	});

	// Scenario: Phone number normalization — +1 prefix vs no prefix
	it("should normalize phone numbers with and without +1 country code", () => {
		const list = ["+18005551234"];

		expect(senderMatchesList("8005551234", list)).toBe(true);
		expect(senderMatchesList("+18005551234", list)).toBe(true);
		expect(senderMatchesList("(800) 555-1234", list)).toBe(true);
	});

	// Scenario: Phone number normalization — formatted vs raw digits
	it("should normalize phone numbers with different formatting", () => {
		const list = ["+1-804-555-1234"];

		expect(senderMatchesList("8045551234", list)).toBe(true);
		expect(senderMatchesList("804-555-1234", list)).toBe(true);
		expect(senderMatchesList("(804) 555-1234", list)).toBe(true);
		expect(senderMatchesList("+1 (804) 555-1234", list)).toBe(true);
	});

	// Scenario: Phone number normalization — country code suffix matching
	it("should match phone numbers by suffix (country code handling)", () => {
		const list = ["+445551234567"];

		expect(senderMatchesList("+1445551234567", list)).toBe(true);
		expect(senderMatchesList("445551234567", list)).toBe(true);
	});

	// Scenario: Minimum digit length enforcement
	it("should not match via phone digits when number has fewer than 7 digits", () => {
		const list = ["xyz9876543abc"];

		expect(senderMatchesList("5678", list)).toBe(false);
		expect(senderMatchesList("12345", list)).toBe(false);
		expect(senderMatchesList("123", list)).toBe(false);
		expect(senderMatchesList("1", list)).toBe(false);
	});

	// Scenario: Minimum digit length enforcement with formatting
	it("should enforce minimum digits even with formatting", () => {
		const list = ["abcd1234567efgh"];

		expect(senderMatchesList("555-1234", list)).toBe(false);
		expect(senderMatchesList("(555) 1234", list)).toBe(false);
	});

	// Scenario: Return false for empty sender
	it("should return false for empty sender", () => {
		const list = ["+15551234567", "mom@icloud.com"];

		expect(senderMatchesList("", list)).toBe(false);
	});

	// Scenario: Return false for empty list
	it("should return false for empty list", () => {
		expect(senderMatchesList("+15551234567", [])).toBe(false);
		expect(senderMatchesList("someone@example.com", [])).toBe(false);
	});

	// Scenario: Return false for no match
	it("should return false when sender does not match any entry", () => {
		const list = ["+18005551234", "trusted@company.org", "mom"];

		expect(senderMatchesList("+15559999999", list)).toBe(false);
		expect(senderMatchesList("untrusted@other.com", list)).toBe(false);
		expect(senderMatchesList("stranger", list)).toBe(false);
	});

	// Scenario: Mixed list with phones, emails, and names
	it("should match against mixed list with phones, emails, and names", () => {
		const list = [
			"+18005551234",
			"mom@icloud.com",
			"dad",
			"spam alerts",
			"(415) 555-0133",
		];

		expect(senderMatchesList("+18005551234", list)).toBe(true);
		expect(senderMatchesList("8005551234", list)).toBe(true);
		expect(senderMatchesList("mom@icloud.com", list)).toBe(true);
		expect(senderMatchesList("Dad", list)).toBe(true);
		expect(senderMatchesList("Important spam alerts", list)).toBe(true);
		expect(senderMatchesList("4155550133", list)).toBe(true);
		expect(senderMatchesList("+15559999999", list)).toBe(false);
	});

	// Scenario: Case-insensitive matching throughout
	it("should perform all matching operations case-insensitively", () => {
		const list = ["crypto alerts", "finance", "+1 (555) 234-5678"];

		expect(senderMatchesList("crypto alerts", list)).toBe(true);
		expect(senderMatchesList("CRYPTO ALERTS", list)).toBe(true);
		expect(senderMatchesList("Important: crypto alerts notification", list)).toBe(
			true
		);
		expect(senderMatchesList("finance", list)).toBe(true);
		expect(senderMatchesList("FINANCE", list)).toBe(true);
		expect(senderMatchesList("5552345678", list)).toBe(true);
	});

	// Scenario: Email variations should match via exact case-insensitive match
	it("should match email addresses exactly (case-insensitive)", () => {
		const list = ["contact@example.com"];

		expect(senderMatchesList("contact@example.com", list)).toBe(true);
		expect(senderMatchesList("Contact@Example.Com", list)).toBe(true);
		expect(senderMatchesList("CONTACT@EXAMPLE.COM", list)).toBe(true);
	});

	// Scenario: Realistic spam detection scenarios
	it("should handle realistic spam detection scenarios", () => {
		const foesList = [
			"+18005551234",
			"spam@phishing-bank.com",
			"crypto scheme",
			"+44 20 7946 0958",
		];

		expect(senderMatchesList("+18005551234", foesList)).toBe(true);
		expect(senderMatchesList("800-555-1234", foesList)).toBe(true);
		expect(senderMatchesList("spam@phishing-bank.com", foesList)).toBe(true);
		expect(senderMatchesList("SPAM ALERTS: crypto scheme", foesList)).toBe(true);
		expect(senderMatchesList("+44-20-7946-0958", foesList)).toBe(true);
		expect(senderMatchesList("+15559999999", foesList)).toBe(false);
	});

	// Scenario: Distinguish between legitimate partial matches and false positives
	it("should match legitimate display names correctly", () => {
		const list = ["mom", "wife", "boss"];

		expect(senderMatchesList("mom", list)).toBe(true);
		expect(senderMatchesList("The mom in my life", list)).toBe(true);
		expect(senderMatchesList("unknown", list)).toBe(false);
		expect(senderMatchesList("wife of john", list)).toBe(true);
		expect(senderMatchesList("boss man", list)).toBe(true);
		expect(senderMatchesList("unknown name", list)).toBe(false);
	});

	// Scenario: Handle whitespace and special characters in sender/list
	it("should handle whitespace and special characters correctly", () => {
		const list = [
			"+1 (555) 123-4567",
			"contact+tag@example.com",
			"john smith",
		];

		expect(senderMatchesList("5551234567", list)).toBe(true);
		expect(senderMatchesList("(555) 123-4567", list)).toBe(true);
		expect(senderMatchesList("contact+tag@example.com", list)).toBe(true);
		expect(senderMatchesList("john smith", list)).toBe(true);
		expect(senderMatchesList("JOHN SMITH", list)).toBe(true);
	});

	// Scenario: Phone number with more than 7 digits should match suffix
	it("should match phone numbers with country code variations", () => {
		const list = ["+445551234567"];

		expect(senderMatchesList("+445551234567", list)).toBe(true);
		expect(senderMatchesList("445551234567", list)).toBe(true);
		expect(senderMatchesList("+1-44-555-1234567", list)).toBe(true);
		expect(senderMatchesList("+33445551234567", list)).toBe(true);
	});

	// Scenario: Edge case - phone number matching with country code suffix matching
	it("should match phone numbers by suffix when both have 7+ digits", () => {
		const list = ["+1-800-555-1234567"];

		expect(senderMatchesList("8005551234567", list)).toBe(true);
		expect(senderMatchesList("+18005551234567", list)).toBe(true);
	});

	// Scenario: Ensure test fails if core matching logic is removed
	it("should fail if exact matching logic is removed", () => {
		const list = ["test@example.com"];
		const sender = "test@example.com";

		const result = senderMatchesList(sender, list);

		expect(result).toBe(true);
	});

	// Scenario: Ensure test fails if partial matching logic is removed
	it("should fail if partial matching logic is removed", () => {
		const list = ["spam alert"];
		const sender = "Important spam alert message";

		const result = senderMatchesList(sender, list);

		expect(result).toBe(true);
	});

	// Scenario: Ensure test fails if phone normalization logic is removed
	it("should fail if phone normalization logic is removed", () => {
		const list = ["+18005551234"];
		const sender = "8005551234";

		const result = senderMatchesList(sender, list);

		expect(result).toBe(true);
	});
});

describe("senderList integration scenarios", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	// Scenario: Complete workflow — parse friends list and check sender
	it("should support complete workflow of parsing and checking friends list", () => {
		const fileContent = `# Trusted friends
+15551234567
mom@icloud.com
dad
sister@company.com`;

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(fileContent as any);

		const friends = parseListFile("/path/to/friends.txt");
		expect(friends).toHaveLength(4);

		expect(senderMatchesList("+15551234567", friends)).toBe(true);
		expect(senderMatchesList("5551234567", friends)).toBe(true);
		expect(senderMatchesList("mom@icloud.com", friends)).toBe(true);
		expect(senderMatchesList("DAD", friends)).toBe(true);
		expect(senderMatchesList("sister@company.com", friends)).toBe(true);
		expect(senderMatchesList("+18005559999", friends)).toBe(false);
	});

	// Scenario: Complete workflow — parse contacts and check sender
	it("should support complete workflow of parsing contacts and checking against them", () => {
		const contacts: ContactEntry[] = [
			{
				firstName : "Barbara",
				lastName  : "Miller",
				name      : "Barbara Miller",
				email     : "barbara@example.com",
				phone     : "(804) 555-1234",
			},
			{
				firstName : "Robert",
				lastName  : "Davis",
				name      : "Robert Davis",
				email     : "robert.davis@company.org",
				phone     : "+1 (415) 555-0133",
			},
		];

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(contacts) as any);

		const contacts_list = parseContactsFile("/path/to/contacts.json");
		expect(contacts_list).toHaveLength(4);

		expect(senderMatchesList("barbara@example.com", contacts_list)).toBe(true);
		expect(senderMatchesList("(804) 555-1234", contacts_list)).toBe(true);
		expect(senderMatchesList("8045551234", contacts_list)).toBe(true);
		expect(senderMatchesList("robert.davis@company.org", contacts_list)).toBe(
			true
		);
		expect(senderMatchesList("4155550133", contacts_list)).toBe(true);
		expect(senderMatchesList("unknown@example.com", contacts_list)).toBe(false);
	});

	// Scenario: Foes list parsing and matching
	it("should correctly identify senders as foes", () => {
		const fileContent = `# Known spam sources
+18005551234
spam@malicious.com
crypto scheme
+44 20 7946 0958`;

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(fileContent as any);

		const foes = parseListFile("/path/to/foes.txt");

		expect(senderMatchesList("+18005551234", foes)).toBe(true);
		expect(senderMatchesList("800-555-1234", foes)).toBe(true);
		expect(senderMatchesList("spam@malicious.com", foes)).toBe(true);
		expect(senderMatchesList("CRYPTO SCHEME alert", foes)).toBe(true);
		expect(senderMatchesList("+44-20-7946-0958", foes)).toBe(true);
		expect(senderMatchesList("legitimate@example.com", foes)).toBe(false);
	});
});
