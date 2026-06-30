// Scribbl — fill-worksheet edge function (Deno).
//
// Image-generation pipeline (Path: edit the real image):
//   1) download the uploaded file (service role)
//   2) Step 1 — send it to OpenAI (Responses API, gpt-5.4) to READ + SOLVE every
//      question (returns JSON: number, question, full worked answer)
//   3) Step 2 — get a raster PNG of the original (images as-is; PDFs rasterized via
//      mupdf) and call OpenAI Images edits (gpt-image-1.5, input_fidelity=high) to
//      paint the answers in realistic pencil handwriting INTO the blank spaces while
//      preserving the original page exactly
//   4) wrap the generated PNG in a single-page PDF -> upload to outputs/{id}.pdf
//
// This replaces all prior pdf-lib text-overlay/positioning logic, which hit a hard
// ceiling (the model cannot reliably localize positions on a scanned page).
//
// OPENAI_API_KEY lives ONLY here (server side). The client never sees it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1';

const SOLVE_MODEL = 'gpt-5.4'; // Step 1: read + solve
const IMAGE_MODEL = 'gpt-image-1.5'; // Step 2: paint the handwriting in
const IMAGE_SIZE = '1024x1536'; // portrait, matches a worksheet's aspect ratio
// 'high' per OpenAI's gpt-image-1.5 guidance: "For dense layouts or heavy in-image
// text, set output quality to 'high'." Our garbling was dense fraction/exponent math.
const IMAGE_QUALITY = 'high';
const MAX_OUTPUT_TOKENS = 4000;

// CORS: kept as '*' on purpose. This function is called from the React Native app,
// which (unlike a browser) sends no Origin header, so the real access control is the
// JWT + the worksheet-ownership check below, not the Origin.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Question = {
  number?: number;
  question?: string;
  answer: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

// Chunked base64 encode (btoa(String.fromCharCode(...bytes)) overflows the stack for
// large files). Used to build the data URI we send to the Step-1 Responses API.
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// base64 -> bytes (for the generated image coming back as b64_json).
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Strip ```fences``` / preamble, then parse the OUTER JSON array of questions.
function parseQuestions(responseText: string): Question[] {
  const cleaned = responseText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .replace(/^\s*Here.*?:\s*/i, '')
    .trim();
  const first = cleaned.indexOf('[');
  const last = cleaned.lastIndexOf(']');
  if (first === -1 || last === -1) {
    throw new Error('No JSON array found in response');
  }
  const parsed = JSON.parse(cleaned.slice(first, last + 1));
  return Array.isArray(parsed) ? (parsed as Question[]) : [];
}

// Rasterize page 1 of a PDF to PNG bytes. mupdf (WASM) is loaded lazily so image
// uploads (the common mobile case) never pay for it.
async function rasterizePdfToPng(bytes: Uint8Array): Promise<Uint8Array> {
  const mupdf = await import('npm:mupdf');
  const doc = mupdf.Document.openDocument(bytes, 'application/pdf');
  const page = doc.loadPage(0);
  // 2x scale for a crisp raster the image model can read clearly.
  const pixmap = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false);
  return new Uint8Array(pixmap.asPNG());
}

const STYLE_DESC: Record<string, string> = {
  neat: 'neat, careful, evenly spaced pencil printing',
  average: 'average everyday student pencil handwriting, slightly casual',
  messy: 'quick, loose, slightly messy pencil handwriting',
};

// Flat per-worksheet cost estimate (~$0.16 at high quality). Refine from logged
// actuals over time.
const ESTIMATED_COST_CENTS = 16;

// Free = worksheet COUNT cap; Pro/Max = monthly dollar (cost_cents) cap.
const TIER_LIMITS = {
  free: { type: 'count' as const, limit: 3 },
  pro: { type: 'cost' as const, limit: 1000 }, // $10.00 / month
  max: { type: 'cost' as const, limit: 5000 }, // $50.00 / month
};

// Resolve the user's tier SERVER-SIDE via the RevenueCat REST API (secret key). We
// NEVER trust a client-passed tier. Fails CLOSED to 'free' on any problem (no secret
// configured, network error, or no active entitlement) so a malicious client cannot
// escalate to a higher cap.
//
// Requires the client to identify the RevenueCat user as the Supabase user id
// (Purchases.logIn(userId)) — done in app/_layout.tsx. MANUAL FOLLOW-UP: set the
// REVENUECAT_SECRET_KEY secret + create the 'pro'/'max' entitlements once RevenueCat
// is configured (post Apple-Developer approval). Until then every user is 'free'.
async function resolveTier(userId: string): Promise<'free' | 'pro' | 'max'> {
  const secret = Deno.env.get('REVENUECAT_SECRET_KEY');
  if (!secret) return 'free';
  try {
    const resp = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );
    if (!resp.ok) return 'free';
    const data = await resp.json();
    const ent = data?.subscriber?.entitlements ?? {};
    const now = Date.now();
    const active = (id: string): boolean => {
      const e = ent[id];
      if (!e) return false;
      const exp = e.expires_date ? Date.parse(e.expires_date) : Number.POSITIVE_INFINITY;
      return exp > now;
    };
    if (active('max')) return 'max';
    if (active('pro')) return 'pro';
    return 'free';
  } catch {
    return 'free';
  }
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

  let worksheetId = '';
  try {
    const body = await req.json();
    worksheetId = body.worksheetId;
    const { storagePath, style, difficulty, subject } = body;

    if (!worksheetId || !storagePath) {
      return json({ success: false, error: 'worksheetId and storagePath are required.' }, 400);
    }

    // --- Auth: require a valid Supabase user JWT (userClient pattern) ---
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

    // --- Ownership: the worksheet must belong to this user ---
    const { data: worksheet, error: fetchError } = await supabase
      .from('worksheets')
      .select('user_id')
      .eq('id', worksheetId)
      .single();
    if (fetchError || worksheet?.user_id !== user.id) {
      return json({ success: false, error: 'Forbidden' }, 403);
    }

    // --- Tiered usage cap (server-side, secure) ---
    // Tier is resolved SERVER-SIDE via RevenueCat REST — never trusted from the
    // client — and fails closed to 'free'. Free = worksheet COUNT cap; Pro/Max =
    // monthly dollar (cost_cents) cap.
    const tier = await resolveTier(user.id);
    const tierConfig = TIER_LIMITS[tier];
    const month = new Date().toISOString().slice(0, 7);
    const { data: usageRow } = await supabase
      .from('usage')
      .select('worksheets_used, cost_cents')
      .eq('user_id', user.id)
      .eq('month', month)
      .maybeSingle();
    console.log(
      `tier=${tier} cap=${tierConfig.type}:${tierConfig.limit} ` +
        `used=${usageRow?.worksheets_used ?? 0} spent=${usageRow?.cost_cents ?? 0}c`
    );
    if (tierConfig.type === 'count') {
      if ((usageRow?.worksheets_used ?? 0) >= tierConfig.limit) {
        return json(
          { success: false, error: 'Free tier limit reached. Upgrade to Pro for more worksheets.' },
          429
        );
      }
    } else if ((usageRow?.cost_cents ?? 0) >= tierConfig.limit) {
      return json(
        {
          success: false,
          error: `Monthly usage cap reached ($${(tierConfig.limit / 100).toFixed(
            2
          )}). Resets next month, or upgrade your plan.`,
        },
        429
      );
    }

    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY is not configured.');
    }

    // Usage is counted only on SUCCESS (see the complete-update below).
    await supabase.from('worksheets').update({ status: 'processing' }).eq('id', worksheetId);

    // 1. Download the uploaded file.
    const { data: fileData, error: dlError } = await supabase.storage
      .from('worksheets')
      .download(storagePath);
    if (dlError || !fileData) {
      throw new Error(`Could not download source file: ${dlError?.message ?? 'missing'}`);
    }
    const fileBytes = new Uint8Array(await fileData.arrayBuffer());

    const ext = storagePath.split('.').pop()?.toLowerCase() ?? '';
    const isPdf = ext === 'pdf';
    const imageMediaType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    console.log('Input type:', isPdf ? 'pdf' : `image/${ext}`);

    // ===================== STEP 1: read + SOLVE (gpt-5.4) =====================
    const fileBase64 = bytesToBase64(fileBytes);
    const solvePrompt =
      `You are solving a worksheet. Read every question in order (top to bottom,\n` +
      `left column then right column if there are multiple columns).\n\n` +
      `For each question, report:\n` +
      `1. number: the question number as printed (1, 2, 3...)\n` +
      `2. question: the question text, exactly as written (math as "a/b", "x^2")\n` +
      `3. answer: the FULL worked solution as a student would write it by hand —\n` +
      `   each working step on its own line, ending with the final answer.\n` +
      `   e.g. "x = 14.13 + 4.25\\nx = 18.38".\n\n` +
      `Subject: ${subject ?? 'general'}. Style: ${style ?? 'average'}. ` +
      `Difficulty: ${difficulty ?? 'realistic'} ` +
      `(perfect=all correct, realistic=~90% correct, student=~80% with some wrong).\n\n` +
      `Respond ONLY with a JSON array, no markdown:\n` +
      `[{"number": 1, "question": "14.13 = x - 4.25", "answer": "x = 14.13 + 4.25\\nx = 18.38"}]`;

    const dataUri = `data:${isPdf ? 'application/pdf' : imageMediaType};base64,${fileBase64}`;
    const filePart = isPdf
      ? { type: 'input_file', filename: 'worksheet.pdf', file_data: dataUri }
      : { type: 'input_image', image_url: dataUri };

    const solveStart = Date.now();
    const solveResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: SOLVE_MODEL,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        input: [{ role: 'user', content: [filePart, { type: 'input_text', text: solvePrompt }] }],
      }),
    });
    if (!solveResp.ok) {
      const detail = await solveResp.text();
      throw new Error(`Solve API error ${solveResp.status}: ${detail.slice(0, 300)}`);
    }
    const solveJson = await solveResp.json();
    console.log(
      `solve: model=${SOLVE_MODEL} ${Date.now() - solveStart}ms ` +
        `in=${solveJson?.usage?.input_tokens ?? 0} out=${solveJson?.usage?.output_tokens ?? 0}`
    );
    const rawText: string =
      solveJson?.output
        ?.find((item: any) => item.type === 'message')
        ?.content?.find((c: any) => c.type === 'output_text')?.text ??
      solveJson?.output_text ??
      '';
    console.log('Raw solve preview:', rawText.slice(0, 300));
    const questions = parseQuestions(rawText);

    if (!questions || questions.length === 0) {
      const message =
        "Couldn't find any questions on this worksheet. Try a clearer photo or a different file.";
      await supabase.from('worksheets').update({ status: 'error', error: message }).eq('id', worksheetId);
      return json({ success: false, error: message }, 422);
    }
    const totalAnswers = questions.length;
    console.log(`parsed: questions=${totalAnswers}`);

    // ===================== STEP 2: paint answers in (gpt-image-1.5) ============
    // Get a raster PNG of the original page (images as-is; PDFs rasterized).
    let pngBytes: Uint8Array;
    let inputMime = 'image/png';
    let inputName = 'worksheet.png';
    if (isPdf) {
      try {
        pngBytes = await rasterizePdfToPng(fileBytes);
      } catch (e) {
        throw new Error(
          `Could not read this PDF. Please upload a photo of the worksheet instead. (${
            e instanceof Error ? e.message : 'rasterize failed'
          })`
        );
      }
    } else {
      pngBytes = fileBytes;
      inputMime = imageMediaType;
      inputName = ext === 'webp' ? 'worksheet.webp' : ext === 'png' ? 'worksheet.png' : 'worksheet.jpg';
    }

    const styleDesc = STYLE_DESC[String(style)] ?? STYLE_DESC.average;
    // Existing printed questions, quoted verbatim and marked off-limits (Fix A).
    const existingList = questions
      .map((q) => `  - "${String(q.question ?? '').trim()}"`)
      .join('\n');
    // New pencil handwriting to ADD, anchored to each question number.
    const answerList = questions
      .map((q) => {
        const work = String(q.answer ?? '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .join('\n        ');
        return `  - In the blank space by question ${q.number ?? ''}, write:\n        ${work}`;
      })
      .join('\n');

    const editPrompt =
      `This is a scanned student worksheet. Your ONLY job is to ADD a student's\n` +
      `PENCIL handwriting (their answers and working) into the blank space near each\n` +
      `question. You are NOT rewriting, cleaning up, or re-typesetting the worksheet.\n\n` +
      `=== EXISTING PRINTED CONTENT — MUST STAY PIXEL-FOR-PIXEL IDENTICAL ===\n` +
      `The page already contains this printed text. It must remain EXACTLY as in the\n` +
      `input image — identical characters, identical math notation (fractions,\n` +
      `exponents, superscripts), identical position and font:\n` +
      `${existingList}\n` +
      `Do NOT redraw, recreate, re-typeset, "clean up", complete, or in ANY way modify\n` +
      `these printed questions, the title, the logo, the "Name" line, or any printed\n` +
      `marks. Never add, remove, or change characters or terms in the printed math.\n` +
      `If you are unsure whether a region is blank or already printed, ASSUME it is\n` +
      `printed and leave it completely UNTOUCHED.\n\n` +
      `=== NEW PENCIL HANDWRITING TO ADD (the only change you make) ===\n` +
      `In the genuinely blank space directly below or beside each question, write the\n` +
      `student's answer in realistic graphite pencil (${styleDesc}). Keep each answer\n` +
      `legible, inside the blank area, NOT overlapping any printed text:\n` +
      `${answerList}\n\n` +
      `The handwriting must look like real graphite pencil — natural pressure\n` +
      `variation, slight imperfection — and clearly distinct from the printed text.\n` +
      `Keep the paper, lighting, color, and texture exactly like the original scan.`;

    const form = new FormData();
    form.append('image', new Blob([pngBytes], { type: inputMime }), inputName);
    form.append('model', IMAGE_MODEL);
    form.append('prompt', editPrompt);
    form.append('size', IMAGE_SIZE);
    form.append('quality', IMAGE_QUALITY);
    form.append('input_fidelity', 'high');
    form.append('output_format', 'png');
    form.append('n', '1');

    const imgStart = Date.now();
    const imgResp = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });
    if (!imgResp.ok) {
      const detail = await imgResp.text();
      // Surfaces invalid model id, content-policy rejections, bad params, etc.
      throw new Error(`Image generation failed (${imgResp.status}): ${detail.slice(0, 400)}`);
    }
    const imgJson = await imgResp.json();
    console.log(
      `image: model=${IMAGE_MODEL} q=${IMAGE_QUALITY} ${Date.now() - imgStart}ms ` +
        `est_cost=$${(ESTIMATED_COST_CENTS / 100).toFixed(2)} ` +
        `usage=${JSON.stringify(imgJson?.usage ?? {})}`
    );
    const b64 = imgJson?.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error(
        `Image generation returned no image. ${JSON.stringify(imgJson).slice(0, 300)}`
      );
    }
    const genPngBytes = base64ToBytes(b64);

    // Wrap the generated PNG into a single-page PDF (no text drawing) so the app's
    // existing download-PDF UX is unchanged.
    const outDoc = await PDFDocument.create();
    const png = await outDoc.embedPng(genPngBytes);
    const outPage = outDoc.addPage([png.width, png.height]);
    outPage.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height });
    const filledBytes = await outDoc.save();
    console.log(`PDF wrapped, bytes: ${filledBytes.length} (${png.width}x${png.height})`);

    // Upload the filled PDF.
    const outputPath = `outputs/${worksheetId}.pdf`;
    const { error: upError } = await supabase.storage
      .from('worksheets')
      .upload(outputPath, filledBytes, { contentType: 'application/pdf', upsert: true });
    if (upError) {
      throw new Error(`Could not upload filled PDF: ${upError.message}`);
    }

    // Count usage + spend only now that we have a real result (re-read to avoid
    // clobbering a concurrent success).
    const { data: freshUsage } = await supabase
      .from('usage')
      .select('worksheets_used, cost_cents')
      .eq('user_id', user.id)
      .eq('month', month)
      .maybeSingle();
    await supabase.from('usage').upsert(
      {
        user_id: user.id,
        month,
        worksheets_used: (freshUsage?.worksheets_used ?? usageRow?.worksheets_used ?? 0) + 1,
        cost_cents: (freshUsage?.cost_cents ?? usageRow?.cost_cents ?? 0) + ESTIMATED_COST_CENTS,
      },
      { onConflict: 'user_id,month' }
    );

    await supabase
      .from('worksheets')
      .update({
        status: 'complete',
        output_path: outputPath,
        answer_count: totalAnswers,
        handwriting_style: style ?? null,
      })
      .eq('id', worksheetId);

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
