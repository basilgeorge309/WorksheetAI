// Scribbl — fill-worksheet edge function (Deno).
//
// Flow: download uploaded file (service role) -> send it to OpenAI (Responses API,
// native PDF via input_file / image via input_image) -> the model returns answers
// + a blank-space bounding box per question -> pdf-lib writes them onto the PDF ->
// upload to outputs/{worksheetId}.pdf -> mark the row complete.
//
// OPENAI_API_KEY lives ONLY here (server side). The client never sees it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

const OPENAI_MODEL = 'gpt-5.4';
const MAX_OUTPUT_TOKENS = 3000;

// CORS: kept as '*' on purpose. This function is called from the React Native
// app, which (unlike a browser) does not send an Origin header, so browser-style
// origin restriction does not apply — the real access control is the JWT + the
// worksheet-ownership check below, not the Origin. If a WEB client is ever added,
// replace '*' with an explicit origin allowlist (e.g. your web app's domain).
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Answer = {
  question: string;
  answer: string;
  index?: number;
  // Bounding box of the genuinely-blank space to write into, as PERCENTAGES of the
  // full page (0..100). left/right are from the LEFT edge; top/bottom from the TOP.
  box_left?: number;
  box_top?: number;
  box_right?: number;
  box_bottom?: number;
};

const clamp = (val: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, val));

// Real-TTF handwriting fonts from the google/fonts GitHub repo. These serve
// genuine TrueType bytes (magic 00010000), unlike the Google Fonts CSS API which
// returns woff2 to modern user-agents and EOT to old ones — neither embeddable
// by pdf-lib/fontkit. Caveat (a variable font) for neat/average, Architects
// Daughter (static) for messy. Both verified to embed via @pdf-lib/fontkit.
const CAVEAT_TTF =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/caveat/Caveat%5Bwght%5D.ttf';
const ARCHITECTS_DAUGHTER_TTF =
  'https://raw.githubusercontent.com/google/fonts/main/ofl/architectsdaughter/ArchitectsDaughter-Regular.ttf';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

// Base64-encode bytes in chunks. NOTE: btoa(String.fromCharCode(...bytes)) blows
// the call stack for multi-hundred-KB PDFs ("Maximum call stack size exceeded"),
// so we chunk the spread to stay safe for files up to the 10MB cap.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000; // 32KB per chunk
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// Per-line sanitizer for multi-line answers: keep the step arrow as ASCII "->"
// (the handwriting font lacks U+2192 and Helvetica throws on it), strip any
// other non-encodable chars (pdf-lib's WinAnsi Helvetica fallback would throw
// otherwise). Newlines are handled by the caller's split().
function sanitizeLine(text: string): string {
  return text.replace(/→/g, '->').replace(/[^\x20-\x7E]/g, '').trim().slice(0, 80);
}

// Word-wrap one logical line to fit `maxWidth` PDF points, measuring with the real
// font metrics. Returns the wrapped physical lines (a single over-long word is
// kept as-is rather than dropped).
function wrapToWidth(text: string, font: any, fontSize: number, maxWidth: number): string[] {
  const words = sanitizeLine(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const out: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      current = candidate;
    } else {
      out.push(current);
      current = words[i];
    }
  }
  out.push(current);
  return out;
}

// Draw a multi-line answer block: each "\n" segment is word-wrapped to `maxWidth`,
// then the whole thing is capped at 2 physical lines (stepping down 1.4x the font
// size) so it never overflows the box. Skips lines that would fall off the page.
function drawMultilineAnswer(
  page: any,
  text: string,
  startX: number,
  startY: number,
  font: any,
  fontSize: number,
  color: any,
  maxWidth: number
): number {
  const segments = text.split('\n');
  const wrapped: string[] = [];
  for (const seg of segments) {
    for (const line of wrapToWidth(seg, font, fontSize, maxWidth)) {
      wrapped.push(line);
    }
  }
  const lines = wrapped.slice(0, 2); // never more than 2 physical lines
  const lineHeight = fontSize * 1.4;
  lines.forEach((line, i) => {
    const y = startY - i * lineHeight;
    if (y > 40) {
      page.drawText(line, { x: startX, y, size: fontSize, font, color, maxWidth });
    }
  });
  return lines.length * lineHeight;
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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const openaiKey = Deno.env.get('OPENAI_API_KEY');
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

    // --- #5 Auth: require a valid Supabase user JWT (userClient pattern) ---
    // Validate the caller's token via an anon client that forwards the incoming
    // Authorization header. getUser() then resolves the user from that JWT.
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return json({ success: false, error: 'Unauthorized' }, 401);
    }

    // --- #5 Ownership: the worksheet must belong to this user ---
    const { data: worksheet, error: fetchError } = await supabase
      .from('worksheets')
      .select('user_id')
      .eq('id', worksheetId)
      .single();
    if (fetchError || worksheet?.user_id !== user.id) {
      return json({ success: false, error: 'Forbidden' }, 403);
    }

    // --- #6 Rate limit: server-side monthly backstop (client check is bypassable) ---
    const month = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
    const { data: usageRow } = await supabase
      .from('usage')
      .select('worksheets_used')
      .eq('user_id', user.id)
      .eq('month', month)
      .maybeSingle();
    const FREE_LIMIT = 3;
    const isPro = false; // TODO: verify RevenueCat entitlement server-side (future session)
    if (!isPro && (usageRow?.worksheets_used ?? 0) >= FREE_LIMIT) {
      return json({ success: false, error: 'Usage limit reached' }, 429);
    }

    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY is not configured.');
    }

    // M4 — usage is counted only on SUCCESS now (see the complete-update below),
    // so blank/unreadable (422) results and Stalled retries don't burn a credit.
    // The 429 check above still caps a user at FREE_LIMIT *successful* worksheets.

    await supabase.from('worksheets').update({ status: 'processing' }).eq('id', worksheetId);

    // 1. Download the uploaded file (PDF or image) with the service role.
    const { data: fileData, error: dlError } = await supabase.storage
      .from('worksheets')
      .download(storagePath);
    if (dlError || !fileData) {
      throw new Error(`Could not download source file: ${dlError?.message ?? 'missing'}`);
    }
    const fileBytes = new Uint8Array(await fileData.arrayBuffer());

    // Detect the input type from the storage path extension.
    const ext = storagePath.split('.').pop()?.toLowerCase() ?? '';
    const isPdf = ext === 'pdf';
    const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
    const imageMediaType = ext === 'png' ? 'image/png' : 'image/jpeg';
    console.log('Input type:', isPdf ? 'pdf' : isImage ? `image/${ext}` : ext);

    // 2. Send the file to Claude directly (native PDF + Vision). It reads the page
    // visually, so it works on scanned/photo worksheets with no text layer.
    const fileBase64 = bytesToBase64(fileBytes);

    // Build the pdf-lib canvas we draw answers onto. PDFs load directly; images
    // are embedded into a new single-page PDF so the same positioning code runs
    // and the output stays a downloadable PDF. (Positioning logic is unchanged.)
    let pdfDoc: any;
    if (isPdf) {
      pdfDoc = await PDFDocument.load(fileBytes);
    } else {
      pdfDoc = await PDFDocument.create();
      const embedded =
        ext === 'png' ? await pdfDoc.embedPng(fileBytes) : await pdfDoc.embedJpg(fileBytes);
      const page = pdfDoc.addPage([embedded.width, embedded.height]);
      page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    }
    const firstPage = pdfDoc.getPages()[0];
    const { width, height } = firstPage.getSize();
    console.log('First page size:', width, height);

    const promptText =
      `You are a student filling in this worksheet by hand. Look at every \n` +
      `question and blank field. Show your working the way a real student would.\n\n` +
      `Style: ${style ?? 'average'}\n` +
      `- neat: clear step-by-step, proper notation\n` +
      `- average: shows main steps, skips obvious ones, casual notation\n` +
      `- messy: jumps to answer with just 1-2 steps shown, shorthand\n\n` +
      `Difficulty: ${difficulty ?? 'realistic'}\n` +
      `- perfect: all answers correct, confident working\n` +
      `- realistic: ~90% correct, natural student voice\n` +
      `- student: ~80% correct, some wrong answers, rushed feel\n\n` +
      `Subject: ${subject ?? 'general'}\n\n` +
      `For math problems, show one working step then the final answer, e.g.\n` +
      `"x = 14.13 + 4.25" then "x = 18.38". Keep each answer to AT MOST 2 lines.\n\n` +
      `For each question on this worksheet, identify:\n` +
      `1. The question text\n` +
      `2. Your answer (showing work where relevant, max 2 lines)\n` +
      `3. A bounding box for where the answer should be written, as PERCENTAGES\n` +
      `   of the full page width/height:\n` +
      `   - box_left: left edge of available blank space (0-100)\n` +
      `   - box_top: TOP of the blank writing space (0-100)\n` +
      `   - box_right: right edge of available blank space (0-100)\n` +
      `   - box_bottom: bottom edge, before the next question starts (0-100)\n\n` +
      `CRITICAL — box_top must be the position of the BLANK SPACE itself (below,\n` +
      `or to the right of, the question), NOT the position of the question text.\n` +
      `The question text sits ABOVE box_top and must NEVER be inside the box.\n` +
      `Because the page is measured from the top down, box_top is a LARGER\n` +
      `percentage than the question's own line (the blank space is further down).\n` +
      `box_bottom is larger still (just above the next question).\n\n` +
      `Look carefully at the actual blank space on the page — margins, the area\n` +
      `after an equals sign, blank lines, empty boxes — and report where there\n` +
      `is genuinely empty room to write, not just a rough position estimate.\n\n` +
      `This worksheet is ${width}x${height} PDF points (box values are percentages,\n` +
      `not points).\n\n` +
      `Respond ONLY with a JSON array, no markdown, no explanation:\n` +
      `[{"question": "14.13 = x - 4.25", "answer": "x = 14.13 + 4.25\\nx = 18.38", "index": 1, "box_left": 15, "box_top": 22, "box_right": 45, "box_bottom": 28}]`;

    // OpenAI Responses API content parts: PDF -> input_file (data URI); image ->
    // input_image (data URI). (input_file is for documents; images use input_image.)
    const dataUri = `data:${isPdf ? 'application/pdf' : imageMediaType};base64,${fileBase64}`;
    const filePart = isPdf
      ? { type: 'input_file', filename: 'worksheet.pdf', file_data: dataUri }
      : { type: 'input_image', image_url: dataUri };

    const startedAt = Date.now();
    const aiResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        input: [
          {
            role: 'user',
            content: [filePart, { type: 'input_text', text: promptText }],
          },
        ],
      }),
    });

    if (!aiResp.ok) {
      const detail = await aiResp.text();
      // Surface the real OpenAI error (e.g. invalid model id) so it lands on the
      // row + logs and we can stop rather than silently producing nothing.
      throw new Error(`OpenAI API error ${aiResp.status}: ${detail.slice(0, 300)}`);
    }

    const aiJson = await aiResp.json();
    const latencyMs = Date.now() - startedAt;
    const inTok = aiJson?.usage?.input_tokens ?? 0;
    const outTok = aiJson?.usage?.output_tokens ?? 0;
    // GPT-5.4 pricing placeholder — ESTIMATE ONLY, verify against current OpenAI
    // rates. Token counts above are exact regardless.
    const costEstimate = (inTok / 1_000_000) * 5 + (outTok / 1_000_000) * 15;
    console.log('OpenAI model:', OPENAI_MODEL);
    console.log(
      `[fill-worksheet] ${worksheetId} model=${OPENAI_MODEL} in=${inTok} out=${outTok} ` +
        `latency=${latencyMs}ms cost=$${costEstimate.toFixed(5)} (est, verify)`
    );

    // Responses API: text lives in output[].content[].text (type 'output_text').
    // Fall back to the convenience `output_text` field if present.
    const rawText: string =
      aiJson?.output
        ?.find((item: any) => item.type === 'message')
        ?.content?.find((c: any) => c.type === 'output_text')?.text ??
      aiJson?.output_text ??
      '';
    console.log('Raw response preview:', rawText.slice(0, 300));
    const answers = parseAnswers(rawText);

    // 2.1 — no questions found (blank/unreadable/non-worksheet content): mark the
    // row as an error with a helpful message rather than producing an empty PDF.
    if (!answers || answers.length === 0) {
      const message =
        "Couldn't find any questions on this worksheet. Try a clearer photo or a different file.";
      await supabase
        .from('worksheets')
        .update({ status: 'error', error: message })
        .eq('id', worksheetId);
      return json({ success: false, error: message }, 422);
    }

    // 2.2 — cap rendering at 30 answers (positioning overlaps beyond that). We
    // still record the TRUE count in answer_count so the UI can say "30 of N".
    const totalAnswers = answers.length;
    const drawAnswers = answers.slice(0, 30);

    // 6. Write answers onto the PDF (pdfDoc was loaded above for the dimensions).
    console.log('answers found:', totalAnswers, '— drawing:', drawAnswers.length);

    // Bulletproof font section: the ENTIRE thing (registerFontkit + fetch +
    // embed) is guarded, so ANY failure falls back to Helvetica and we still
    // draw every answer. A throw here previously aborted the whole write.
    let answerFont: any;
    try {
      pdfDoc.registerFontkit(fontkit);
      const fontUrl = style === 'messy' ? ARCHITECTS_DAUGHTER_TTF : CAVEAT_TTF;
      const res = await fetch(fontUrl);
      console.log('Font fetch status:', res.status);
      if (!res.ok) throw new Error('Font fetch failed: ' + res.status);
      const ttfBytes = await res.arrayBuffer();
      answerFont = await pdfDoc.embedFont(ttfBytes);
      console.log('Handwriting font embedded');
    } catch (e) {
      console.error('Font failed, using Helvetica:', e instanceof Error ? e.message : e);
      answerFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
      console.log('Font embedded successfully (Helvetica fallback)');
    }

    // Pencil effect: gray (not pen blue), with slight per-answer shade variation
    // so the writing doesn't look mechanically uniform.
    const pencilColors = [
      rgb(0.25, 0.25, 0.25), // normal pencil stroke
      rgb(0.35, 0.35, 0.35), // slightly lighter
      rgb(0.2, 0.2, 0.2), // slightly darker
    ];
    const getPencilColor = (index: number) => pencilColors[index % 3];

    // M2 — no hardcoded student name is drawn (it would stamp the same stranger's
    // name on every user's worksheet). The Name field, if any, is left blank.

    // Position each answer inside the blank-space bounding box the model reported
    // (percentages of the page). All four values are clamped so a hallucinated box
    // can't break rendering, then converted to PDF points (origin bottom-left, so
    // top/bottom percentages are flipped against `height`).
    drawAnswers.forEach((item, i) => {
      const text = String(item.answer ?? '');

      const boxLeft = clamp(item.box_left ?? 10, 0, 95);
      const boxTop = clamp(item.box_top ?? 20, 5, 95);
      const boxRight = clamp(item.box_right ?? boxLeft + 30, boxLeft + 5, 100);
      const boxBottom = clamp(item.box_bottom ?? boxTop + 8, boxTop, 100);

      const boxLeftPx = (boxLeft / 100) * width;
      const boxRightPx = (boxRight / 100) * width;
      const boxTopPx = height - (boxTop / 100) * height;
      const boxBottomPx = height - (boxBottom / 100) * height;
      const boxWidthPx = boxRightPx - boxLeftPx;
      const boxHeightPx = boxTopPx - boxBottomPx;

      const lineCount = Math.max(1, String(text).split('\n').length);
      // Fit the font to the box height; never below an 8pt readable minimum.
      let fontSize = clamp(Math.floor((boxHeightPx / lineCount) * 0.7), 8, 14);
      let drawX = boxLeftPx;
      let drawWidth = boxWidthPx;

      // Tiny/hallucinated box: fall back to a conservative small font at the box's
      // top-left, with a generous width so the text still renders somewhere sane.
      if (boxWidthPx < 20 || boxHeightPx < 10) {
        fontSize = 9;
        drawWidth = Math.max(boxWidthPx, width * 0.3);
      }

      // Anchor to the TOP of the box and flow DOWNWARD (drawMultilineAnswer
      // subtracts per line). The first baseline sits one font-size + a small pad
      // below box_top so the text falls INSIDE the blank space, never up on the
      // question line above box_top. (Verified: this is below box_top, not at it.)
      const BOX_TOP_PADDING = 3;
      const startY = boxTopPx - fontSize - BOX_TOP_PADDING;
      drawMultilineAnswer(
        firstPage,
        text,
        drawX,
        startY,
        answerFont,
        fontSize,
        getPencilColor(i),
        drawWidth
      );
      console.log(
        `Drew answer #${item.index ?? i + 1}: ${JSON.stringify(item.answer)} ` +
          `box[L:${boxLeft} T:${boxTop} R:${boxRight} B:${boxBottom}] -> ` +
          `x:${Math.round(drawX)} y:${Math.round(startY)} w:${Math.round(drawWidth)} font:${fontSize}`
      );
    });

    const filledBytes = await pdfDoc.save();
    console.log('PDF saved, bytes:', filledBytes.length);

    // 7. Upload the filled PDF.
    const outputPath = `outputs/${worksheetId}.pdf`;
    const { error: upError } = await supabase.storage
      .from('worksheets')
      .upload(outputPath, filledBytes, { contentType: 'application/pdf', upsert: true });
    if (upError) {
      throw new Error(`Could not upload filled PDF: ${upError.message}`);
    }

    // M4 — count usage only now that we have a real result (service-role write).
    // Re-read first so concurrent successes don't clobber each other's count.
    const { data: freshUsage } = await supabase
      .from('usage')
      .select('worksheets_used')
      .eq('user_id', user.id)
      .eq('month', month)
      .maybeSingle();
    await supabase.from('usage').upsert(
      {
        user_id: user.id,
        month,
        worksheets_used: (freshUsage?.worksheets_used ?? usageRow?.worksheets_used ?? 0) + 1,
      },
      { onConflict: 'user_id,month' }
    );

    // 8. Mark the worksheet complete, and persist the answer count + style so the
    // worksheet screen can show "{N} questions answered, {style}-style".
    await supabase
      .from('worksheets')
      .update({
        status: 'complete',
        output_path: outputPath,
        answer_count: totalAnswers,
        handwriting_style: style ?? null,
      })
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
