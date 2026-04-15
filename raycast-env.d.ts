/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** OpenAI API key - Used when an OpenAI model is selected. From platform.openai.com */
  "openaiApiKey"?: string,
  /** Anthropic API key - Used when a Claude model is selected. From console.anthropic.com */
  "anthropicApiKey"?: string,
  /** Google Gemini API key - Used when a Gemini model is selected. From aistudio.google.com/apikey */
  "geminiApiKey"?: string,
  /** Model - Provider and model (vision for screenshots, text for browser pages). Use the matching API key. */
  "model": "openai:gpt-4o-mini" | "openai:gpt-4o" | "openai:gpt-4.1-mini" | "openai:gpt-4.1" | "anthropic:claude-sonnet-4-20250514" | "anthropic:claude-haiku-4-5-20251001" | "gemini:gemini-2.5-flash" | "gemini:gemini-2.5-pro" | "gemini:gemini-2.0-flash",
  /** Default instructions - Pre-filled analysis instructions in the form (you can edit each run). */
  "defaultPrompt": string,
  /** Token usage - When the provider returns usage data, show estimated input/output tokens in toasts and the chat header. */
  "showTokenUsage": boolean,
  /** Estimated API cost - Show approximate USD next to token counts using public list prices (your invoice may differ). Requires token usage to be enabled. */
  "showEstimatedCost": boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `analyze-screen` command */
  export type AnalyzeScreen = ExtensionPreferences & {}
  /** Preferences accessible in the `quick-clipboard` command */
  export type QuickClipboard = ExtensionPreferences & {}
  /** Preferences accessible in the `quick-browser` command */
  export type QuickBrowser = ExtensionPreferences & {}
  /** Preferences accessible in the `analyze-file` command */
  export type AnalyzeFile = ExtensionPreferences & {}
  /** Preferences accessible in the `session-history` command */
  export type SessionHistory = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `analyze-screen` command */
  export type AnalyzeScreen = {}
  /** Arguments passed to the `quick-clipboard` command */
  export type QuickClipboard = {}
  /** Arguments passed to the `quick-browser` command */
  export type QuickBrowser = {}
  /** Arguments passed to the `analyze-file` command */
  export type AnalyzeFile = {}
  /** Arguments passed to the `session-history` command */
  export type SessionHistory = {}
}

