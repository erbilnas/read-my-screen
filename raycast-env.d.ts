/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** OpenAI API Key - Your OpenAI API key (stored locally in Raycast preferences). */
  "apiKey": string,
  /** Vision model - OpenAI model that supports images. */
  "model": "gpt-4o-mini" | "gpt-4o" | "gpt-4.1-mini" | "gpt-4.1",
  /** Default instructions - Pre-filled analysis instructions in the form (you can edit each run). */
  "defaultPrompt": string
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `analyze-screen` command */
  export type AnalyzeScreen = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `analyze-screen` command */
  export type AnalyzeScreen = {}
}

