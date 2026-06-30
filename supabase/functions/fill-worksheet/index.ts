// WorksheetAI — fill-worksheet edge function (Deno).
//
// Flow: download uploaded PDF (service role) -> send PDF to Claude (native PDF) ->
// the model generates answers -> pdf-lib writes them onto the PDF ->
// upload to outputs/{worksheetId}.pdf -> mark the row complete.
//
// ANTHROPIC_API_KEY lives ONLY here (server side). The client never sees it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import fontkit from 'https://esm.sh/@pdf-lib/fontkit@1.1.1';
import { PDFDocument, StandardFonts, rgb } from 'https://esm.sh/pdf-lib@1.17.1';

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 2000;

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
  x_percent?: number; // how far from the LEFT edge the answer should start, 0..100
  y_percent?: number; // the question's position from the TOP, 0..100
  available_height_percent?: number; // vertical space below the question, 0..100
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

// Draw a multi-line answer block, one line per "\n", stepping down by 1.4x the
// font size. Skips anything that would fall off the bottom of the page. Returns
// the total vertical height the block consumed.
function drawMultilineAnswer(
  page: any,
  text: string,
  startX: number,
  startY: number,
  font: any,
  fontSize: number,
  color: any,
  maxLines = 2
): number {
  // Clamp to the space the model said is available below the question.
  const lines = text.split('\n').slice(0, maxLines);
  const lineHeight = fontSize * 2.2;
  lines.forEach((line, i) => {
    const y = startY - i * lineHeight;
    if (y > 40) {
      page.drawText(sanitizeLine(line), {
        x: startX,
        y,
        size: fontSize,
        font,
        color,
        maxWidth: 180,
      });
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

    if (!anthropicKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured.');
    }

    // --- #6 Count this attempt (service-role write — users can no longer modify
    // usage directly). Counting on-attempt caps Anthropic spend at FREE_LIMIT/month. ---
    await supabase.from('usage').upsert(
      {
        user_id: user.id,
        month,
        worksheets_used: (usageRow?.worksheets_used ?? 0) + 1,
      },
      { onConflict: 'user_id,month' }
    );

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
      `"x = 14.13 + 4.25" then "x = 18.38".\n\n` +
      `For each question on this worksheet:\n` +
      `- Estimate x_percent: how far from the LEFT edge the answer should\n` +
      `  start (0-100). Match the indentation of the question.\n` +
      `- Estimate y_percent: the question's position from TOP (0-100).\n` +
      `- Estimate available_height_percent: how much vertical space exists\n` +
      `  BELOW this question before the next question starts (0-100).\n\n` +
      `Write the answer in that space. If available_height_percent is small\n` +
      `(under 5), keep the answer to 1 line only. If it's larger, show\n` +
      `working steps on line 1 and final answer on line 2.\n\n` +
      `This worksheet has dimensions ${width}x${height} PDF points.\n\n` +
      `Respond ONLY with a JSON array, no markdown, no explanation:\n` +
      `[{"question": "14.13 = x - 4.25", "answer": "x = 14.13 + 4.25\\nx = 18.38", "index": 1, "x_percent": 15, "y_percent": 22, "available_height_percent": 6}]`;

    // PDF -> document block; image -> image block (Claude Vision).
    const contentBlock = isPdf
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 },
        }
      : {
          type: 'image',
          source: { type: 'base64', media_type: imageMediaType, data: fileBase64 },
        };

    const startedAt = Date.now();
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: 'user',
            content: [
              contentBlock,
              { type: 'text', text: promptText },
            ],
          },
        ],
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
    console.log('Anthropic out tokens:', outTok);
    console.log(
      `[fill-worksheet] ${worksheetId} model=${ANTHROPIC_MODEL} in=${inTok} out=${outTok} ` +
        `latency=${latencyMs}ms cost=$${costEstimate.toFixed(5)}`
    );

    const rawText: string = (aiJson?.content ?? [])
      .map((b: any) => (b.type === 'text' ? b.text : ''))
      .join('');
    console.log('Raw response preview:', rawText.slice(0, 200));
    const answers = parseAnswers(rawText);

    // 6. Write answers onto the PDF (pdfDoc was loaded above for the dimensions).
    console.log('PDF loaded, answers to draw:', answers.length);

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
    const pencilColor = rgb(0.25, 0.25, 0.25);
    const pencilColors = [
      rgb(0.25, 0.25, 0.25), // normal pencil stroke
      rgb(0.35, 0.35, 0.35), // slightly lighter
      rgb(0.2, 0.2, 0.2), // slightly darker
    ];
    const getPencilColor = (index: number) => pencilColors[index % 3];

    // Student name near the top-right, in pencil + handwriting font.
    const nameX = width - 130;
    const nameY = height - 58;
    firstPage.drawText('Alex Johnson', {
      x: nameX,
      y: nameY,
      size: 11,
      font: answerFont,
      color: pencilColor,
    });
    console.log('Drew name: Alex Johnson at x,y:', nameX, nameY);

    // Position each answer: column comes from the question index (x_percent from
    // Claude is unreliable), y_percent gives the vertical position, and
    // available_height_percent (clamped) decides how many lines fit.
    answers.forEach((item, i) => {
      const text = String(item.answer ?? '');

      const yPercent =
        typeof item.y_percent === 'number'
          ? item.y_percent
          : ((i + 1) / (answers.length + 1)) * 100;

      // x_percent from Claude is unreliable — derive the column from the question
      // index instead: 1-7 left, 8-12 right.
      const isRightColumn = (item.index ?? 1) > 7;
      const answerX = isRightColumn
        ? Math.floor(width * 0.52)
        : Math.floor(width * 0.22);

      const answerY = height - Math.floor(height * (yPercent / 100)) - 30;
      const availHeight = Math.max(item.available_height_percent ?? 8, 8);
      const maxLines = availHeight < 8 ? 1 : 2;
      const fontSize = 13 + Math.random();

      drawMultilineAnswer(
        firstPage,
        text,
        answerX,
        answerY,
        answerFont,
        fontSize,
        getPencilColor(i),
        maxLines
      );
      console.log(
        'Drew answer:',
        item.answer,
        'at x,y:',
        answerX,
        answerY,
        `(col:${isRightColumn ? 'R' : 'L'} y%:${Math.round(yPercent)} avail%:${availHeight} maxLines:${maxLines})`
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

    // 8. Mark the worksheet complete, and persist the answer count + style so the
    // worksheet screen can show "{N} questions answered, {style}-style".
    await supabase
      .from('worksheets')
      .update({
        status: 'complete',
        output_path: outputPath,
        answer_count: answers.length,
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
