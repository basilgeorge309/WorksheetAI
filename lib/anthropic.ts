/**
 * Anthropic API access — SERVER-SIDE ONLY.
 *
 * The ANTHROPIC_API_KEY must NEVER be bundled into or called from the React
 * Native app. Doing so would leak the key to every user's device.
 *
 * All Anthropic calls happen inside the Supabase Edge Function at
 * `supabase/functions/fill-worksheet/`, which reads ANTHROPIC_API_KEY from the
 * function's server environment (not an EXPO_PUBLIC_* var).
 *
 * Model: claude-sonnet-4-6  (see CLAUDE.md → Models)
 *
 * This file is intentionally a placeholder. The client talks to the edge
 * function over HTTPS; it never imports the Anthropic SDK directly.
 *
 * Example (lives in the edge function, NOT here):
 *
 *   import Anthropic from '@anthropic-ai/sdk';
 *   const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
 *   const res = await anthropic.messages.create({
 *     model: 'claude-sonnet-4-6',
 *     max_tokens: 1000,
 *     messages: [{ role: 'user', content: extractedWorksheetText }],
 *   });
 */

export const ANTHROPIC_MODEL = 'claude-sonnet-4-6';

// Intentionally no client-side Anthropic client is exported from this module.
export {};
