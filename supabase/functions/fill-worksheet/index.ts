// WorksheetAI — fill-worksheet edge function (Deno).
//
// Flow: download uploaded PDF (service role) -> extract text (unpdf) ->
// Anthropic (claude-sonnet-4-6) generates answers -> pdf-lib writes them onto
// the PDF -> upload to outputs/{worksheetId}.pdf -> mark the row complete.
//
// ANTHROPIC_API_KEY lives ONLY here (server side). The client never sees it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';
import { extractText, getDocumentProxy } from 'https://esm.sh/unpdf@0.12.1';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 1000;

const SYSTEM_PROMPT = `You are a student filling in a worksheet. Extract every question or blank field from the provided text and generate an appropriate answer for each one.

Difficulty levels:
- perfect: all answers correct, confident phrasing
- realistic: ~90% correct, occasional "I think" or hedging, natural student voice
- student: ~80% correct, a few wrong answers, crossed-out-style corrections noted in answer

Handwriting styles affect phrasing only (not rendering at this stage):
- neat: complete sentences, proper punctuation
- average: some abbreviations, casual but readable
- messy: fragments ok, shorthand, rushed feel

For each answer also return an "x_hint": "left" or "right" indicating which column
the answer belongs in based on the worksheet layout, and "index": the question number
(1-based). This helps with precise placement.

Respond ONLY with a JSON array. No markdown, no explanation, no backticks.
Updated format: [{"question": "...", "answer": "...", "position": "top|middle|bottom|unknown", "x_hint": "left|right", "index": 1}]`;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Answer = {
  question: string;
  answer: string;
  position?: string;
  x_hint?: 'left' | 'right';
  index?: number;
};

// Real-TTF handwriting fonts from the google/fonts GitHub repo. These serve
// genuine TrueType bytes (magic 00010000), unlike the Google Fonts CSS API which
// returns woff2 to modern user-agents and EOT to old ones — neither embeddable
// by pdf-lib/fontkit. Caveat (a variable font) for neat/average, Architects
// Daughter (static) for messy. Both verified to embed via @pdf-lib/fontkit.
const CAVEAT_TTF =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat%5Bwght%5D.ttf';
const ARCHITECTS_DAUGHTER_TTF =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/architectsdaughter/ArchitectsDaughter-Regular.ttf';

// Fetch a handwriting TTF and embed it. Throws on failure so the caller can fall
// back to a standard font.
async function loadHandwritingFont(pdfDoc: any, style?: string): Promise<any> {
  const ttfUrl = style === 'messy' ? ARCHITECTS_DAUGHTER_TTF : CAVEAT_TTF;
  const fontResp = await fetch(ttfUrl);
  if (!fontResp.ok) {
    throw new Error(`Font fetch failed (${fontResp.status})`);
  }
  const fontBytes = new Uint8Array(await fontResp.arrayBuffer());
  return await pdfDoc.embedFont(fontBytes);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

// pdf-lib's StandardFonts.Helvetica is WinAnsi-encoded; drop glyphs it can't draw
// so a stray unicode char never throws mid-render.
function sanitize(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, '').slice(0, 120);
}

// Models occasionally wrap JSON in ```fences``` or a "Here is the JSON:" preamble
// despite instructions. Aggressively strip those, then slice between the
// outermost brackets and parse.
function parseAnswers(responseText: string): Answer[] {
  const raw = responseText.trim();
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^\s*Here.*?:\s*/i, '')
    .trim();

  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket === -1 || lastBracket === -1) {
    throw new Error('No JSON array found in response');
  }
  const jsonStr = cleaned.slice(firstBracket, lastBracket + 1);
  const answers = JSON.parse(jsonStr);
  return answers as Answer[];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed.' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Parse + validate body up front so we know which worksheet to mark on failure.
  let worksheetId = '';
  try {
    const body = await req.json();
    worksheetId = body.worksheetId;
    const { storagePath, style, difficulty, subject } = body;

    if (!worksheetId || !storagePath) {
      return json({ success: false, error: 'worksheetId and storagePath are required.' }, 400);
    }
    if (!anthropicKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured.');
    }

    await supabase.from('worksheets').update({ status: 'processing' }).eq('id', worksheetId);

    // 1. Download the uploaded PDF with the service role.
    const { data: fileData, error: dlError } = await supabase.storage
      .from('worksheets')
      .download(storagePath);
    if (dlError || !fileData) {
      throw new Error(`Could not download source PDF: ${dlError?.message ?? 'missing'}`);
    }
    const pdfBytes = new Uint8Array(await fileData.arrayBuffer());

    // 2. Extract text.
    const pdf = await getDocumentProxy(pdfBytes);
    const { text: extractedText } = await extractText(pdf, { mergePages: true });

    // 3. Anthropic — generate answers.
    const userContent =
      `Subject: ${subject ?? 'general'}\n` +
      `Handwriting style: ${style ?? 'average'}\n` +
      `Difficulty: ${difficulty ?? 'realistic'}\n\n` +
      `Worksheet text:\n${extractedText}`;

    const startedAt = Date.now();
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
      }),
    });

    if (!aiResp.ok) {
      const detail = await aiResp.text();
      throw new Error(`Anthropic API error ${aiResp.status}: ${detail.slice(0, 200)}`);
    }

    const aiJson = await aiResp.json();
    const latencyMs = Date.now() - startedAt;
    const inTok = aiJson?.usage?.input_tokens ?? 0;
    const outTok = aiJson?.usage?.output_tokens ?? 0;
    // claude-sonnet-4-6: ~$3 / 1M input, ~$15 / 1M output.
    const costEstimate = (inTok / 1_000_000) * 3 + (outTok / 1_000_000) * 15;
    console.log(
      `[fill-worksheet] ${worksheetId} model=${ANTHROPIC_MODEL} in=${inTok} out=${outTok} ` +
        `latency=${latencyMs}ms cost=$${costEstimate.toFixed(5)}`
    );

    const rawText: string = aiJson?.content?.[0]?.text ?? '';
    const answers = parseAnswers(rawText);

    // 6. Write answers onto the PDF.
    const pdfDoc = await PDFDocument.load(pdfBytes);
    // fontkit is required before embedding a custom (non-standard) TTF font.
    pdfDoc.registerFontkit(fontkit);

    // Embed a real handwriting font; fall back to Helvetica if the fetch fails.
    let handFont: any;
    try {
      handFont = await loadHandwritingFont(pdfDoc, style);
    } catch (fontErr) {
      console.warn(
        '[fill-worksheet] handwriting font load failed, using Helvetica:',
        fontErr instanceof Error ? fontErr.message : fontErr
      );
      handFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    }

    const firstPage = pdfDoc.getPages()[0];
    const { width, height } = firstPage.getSize();

    // Fill a realistic student name near the top-right (confirmed working position).
    firstPage.drawText('Alex Johnson', {
      x: width - 180,
      y: height - 58,
      size: 11,
      font: handFont,
      color: rgb(0.1, 0.1, 0.5),
    });

    // Place answers inline with their questions: Q1–7 in the left column,
    // Q8–12 in the right column, evenly spaced between y=620 and y=280.
    const leftAnswers = answers.filter((_, i) => i < 7);
    const rightAnswers = answers.filter((_, i) => i >= 7);

    leftAnswers.forEach((item, i) => {
      const y = 620 - i * (340 / Math.max(leftAnswers.length - 1, 1));
      firstPage.drawText(sanitize(String(item.answer ?? '')), {
        x: 200,
        y,
        size: 10,
        font: handFont,
        color: rgb(0.1, 0.1, 0.5),
        maxWidth: 100,
      });
    });

    rightAnswers.forEach((item, i) => {
      const y = 620 - i * (340 / Math.max(rightAnswers.length - 1, 1));
      firstPage.drawText(sanitize(String(item.answer ?? '')), {
        x: 480,
        y,
        size: 10,
        font: handFont,
        color: rgb(0.1, 0.1, 0.5),
        maxWidth: 100,
      });
    });

    const filledBytes = await pdfDoc.save();

    // 7. Upload the filled PDF.
    const outputPath = `outputs/${worksheetId}.pdf`;
    const { error: upError } = await supabase.storage
      .from('worksheets')
      .upload(outputPath, filledBytes, { contentType: 'application/pdf', upsert: true });
    if (upError) {
      throw new Error(`Could not upload filled PDF: ${upError.message}`);
    }

    // 8. Mark the worksheet complete.
    await supabase
      .from('worksheets')
      .update({ status: 'complete', output_path: outputPath })
      .eq('id', worksheetId);

    // 9. Done.
    return json({ success: true, outputPath });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    console.error('[fill-worksheet] failed:', message);
    if (worksheetId) {
      await supabase
        .from('worksheets')
        .update({ status: 'error', error: message.slice(0, 500) })
        .eq('id', worksheetId);
    }
    return json({ success: false, error: message }, 200);
  }
});
