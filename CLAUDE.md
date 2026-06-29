@AGENTS.md

# WorksheetAI — Claude Code Project Context

## What this app does
Users upload a PDF of a paper worksheet. The AI reads the questions and fills in the answers in a realistic handwriting style. Users can choose a handwriting style (neat, messy, average) and a difficulty level (all correct, a few mistakes, realistic kid mistakes). They download or share the filled-in PDF.

## Target users
Students (high school + college), parents of K-8 kids, teachers generating answer keys.

## Stack
- **Framework:** Expo (React Native) — single codebase for iOS + Android
- **Navigation:** Expo Router (file-based, app/ directory)
- **Backend/Auth/Storage:** Supabase
  - Auth: Supabase email + Google OAuth
  - Storage: Supabase Storage (PDFs, max 10MB, deleted after 24 hours)
  - DB: Postgres via Supabase
- **AI:** Anthropic API (claude-sonnet-4-6) for PDF reading and answer generation
- **Payments:** RevenueCat for in-app subscriptions (iOS + Android)
- **PDF rendering:** react-native-pdf for display, expo-document-picker for upload
- **PDF generation:** Call a Supabase Edge Function that uses pdf-lib to write handwriting onto the PDF server-side

## Project structure
```
app/
  (tabs)/
    index.tsx         # Home / upload screen
    history.tsx       # Past worksheets
    settings.tsx      # Account, subscription
  worksheet/
    [id].tsx          # Worksheet detail + download
components/
  UploadButton.tsx
  StylePicker.tsx
  HandwritingPreview.tsx
supabase/
  functions/
    fill-worksheet/   # Edge function: calls Anthropic API, writes PDF
lib/
  supabase.ts
  anthropic.ts
  revenuecat.ts
```

## Core user flow
1. User opens app → taps Upload Worksheet
2. Picks PDF from Files / Google Drive / Photos
3. Chooses handwriting style + difficulty
4. Hits "Fill it in" → calls Supabase Edge Function
5. Edge function: extracts questions via Anthropic API → generates answers → writes onto PDF with pdf-lib
6. User sees preview → downloads or shares filled PDF

## Business logic
- **Free tier:** 3 worksheets per month (tracked in Supabase `usage` table)
- **Pro tier:** Unlimited worksheets ($4.99/month or $29.99/year via RevenueCat)
- **Usage gate:** Check remaining uses before calling edge function, show paywall if 0 remaining
- **Storage:** Delete source PDFs from Supabase Storage after 24 hours (cron job)

## Handwriting styles
Three presets to start:
- `neat` — clean, consistent, slightly rounded
- `average` — normal student handwriting, slight inconsistency
- `messy` — irregular sizing, rushed feel

Difficulty levels:
- `perfect` — all answers correct
- `realistic` — ~90% correct, natural phrasing
- `student` — ~80% correct, occasional wrong answers, crossed-out words

## AI prompt approach
The Anthropic API call in the edge function should:
1. Receive the extracted PDF text
2. Identify each question and blank field
3. Generate age-appropriate answers matching the style/difficulty chosen
4. Return structured JSON: `[{ question: string, answer: string, fieldPosition: {x, y, page} }]`
Prompt Claude to respond ONLY in JSON. Strip any markdown fences before parsing.

## Environment variables
```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=        # server-side only, never expose to client
REVENUECAT_API_KEY_IOS=
REVENUECAT_API_KEY_ANDROID=
```
ANTHROPIC_API_KEY must NEVER be used client-side. Always call through the Supabase Edge Function.

## Rules
- Never store PDFs longer than 24 hours
- Never expose ANTHROPIC_API_KEY to the client
- Never use web-only APIs (no localStorage, no document, no window)
- Always handle loading + error states on every async action
- TypeScript strict mode on
- Use Supabase RLS policies — users can only access their own rows
- Every screen must work offline-gracefully (show a clear error, not a crash)

## Testing rubric (use before marking any feature done)
For each feature, define 3–5 pass/fail checks before writing code. Example for PDF upload:
- [ ] File picker opens and accepts PDF only
- [ ] Files over 10MB show a clear error message
- [ ] Successful upload appears in Supabase Storage
- [ ] Upload failure shows retry option, does not crash
- [ ] Loading state shown during upload

## Models
- Use `claude-sonnet-4-6` for all Anthropic API calls
- Set max_tokens to 1000 for answer generation calls
- Log every API call: input tokens, output tokens, latency, cost estimate

## Do not
- Do not use class components — hooks only
- Do not inline styles — use StyleSheet.create()
- Do not generate auth logic from scratch — use Supabase Auth helpers
- Do not skip error boundaries on screens that call the edge function
