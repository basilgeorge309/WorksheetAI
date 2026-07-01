// Scribbl — fill-worksheet edge function (Deno).
//
// Two-step pipeline:
//   1) download the uploaded file (service role)
//   2) Step 1 — Responses API (gpt-5.4) READS + SOLVES every question
//   3) Step 2 — dual-anchor edit: a signed image URL is sent TWICE to the Responses
//      `image_generation` tool (image 1 = locked layout reference, image 2 = edit
//      target) which adds pencil handwriting and returns the finished page
//   4) wrap the returned image in a single-page PDF -> upload to outputs/{id}.pdf
//
// PDFs are rasterized to a PNG ON-DEVICE at upload time (mupdf can't run in the edge
// within the 2s CPU limit); this function only ever sees signed image URLs.
//
// OPENAI_API_KEY lives ONLY here (server side). The client never sees it.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1';

// Supabase Edge global: keeps the isolate alive to finish a background task after
// the HTTP response has been sent. Not in the ambient Deno types, so declare it.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const SOLVE_MODEL = 'gpt-5.4'; // Step 1: read + solve
// Step 2: a mainline model that drives the Responses API `image_generation` tool (the
// tool itself selects the GPT-Image model). NOT 'gpt-image-1' — that's the tool's job.
const IMAGE_ORCHESTRATOR_MODEL = 'gpt-5.4';
// 'high' per OpenAI's gpt-image guidance for dense layouts / heavy in-image text.
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
  // Approximate placement for the handwriting layer (the model never sees the page;
  // these tell us roughly where to draw each answer). Solving is unchanged.
  number_y_percent?: number;
  column?: 'left' | 'right';
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
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
  const t0 = Date.now();
  console.log('START', t0);
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
      .select('user_id, raster_path')
      .eq('id', worksheetId)
      .single();
    if (fetchError || worksheet?.user_id !== user.id) {
      return json({ success: false, error: 'Forbidden' }, 403);
    }
    console.log('after auth:', Date.now() - t0, 'ms');

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

    const ext = storagePath.split('.').pop()?.toLowerCase() ?? '';
    const isPdf = ext === 'pdf';
    console.log('Input type:', isPdf ? 'pdf' : `image/${ext}`);

    // The image the model sees is ALWAYS a signed Storage URL — no download, no base64,
    // no mupdf in the edge function. For PDFs we use the PNG that was rasterized
    // ON-DEVICE at upload time (raster_path); for images we use the original directly.
    const srcPath = isPdf ? worksheet.raster_path : storagePath;
    if (isPdf && !srcPath) {
      throw new Error(
        "Couldn't process this PDF. Please upload a photo of the worksheet instead."
      );
    }

    // Server-side size validation of the object we're about to send to OpenAI —
    // closes the oversized-file / zip-bomb vector regardless of what the client sends.
    // We read the size from Storage metadata (I/O only — no download, no CPU). The edge
    // function no longer downloads the file, so there is no fileBytes to measure.
    const MAX_BYTES = 20 * 1024 * 1024; // 20MB hard cap
    const MIN_BYTES = 1000; // smaller = empty/corrupt
    const dir = srcPath.split('/').slice(0, -1).join('/');
    const name = srcPath.split('/').pop() ?? '';
    const { data: listed } = await supabase.storage
      .from('worksheets')
      .list(dir, { search: name, limit: 100 });
    const meta = listed?.find((f) => f.name === name);
    if (meta) {
      const size = Number(meta.metadata?.size ?? 0);
      console.log('src size:', size, 'bytes', 'path:', srcPath);
      if (size > MAX_BYTES) {
        const msg = 'File too large. Maximum size is 20MB.';
        await supabase.from('worksheets').update({ status: 'error', error: msg }).eq('id', worksheetId);
        return json({ success: false, error: msg }, 413);
      }
      if (size < MIN_BYTES) {
        const msg = 'File appears to be empty or corrupt.';
        await supabase.from('worksheets').update({ status: 'error', error: msg }).eq('id', worksheetId);
        return json({ success: false, error: msg }, 422);
      }
    }

    const { data: signed } = await supabase.storage
      .from('worksheets')
      .createSignedUrl(srcPath, 600); // 10 min — image gen now runs as a deferred
    // background task (~130s after this URL is minted), so give ample TTL margin.
    const worksheetUrl = signed?.signedUrl;
    if (!worksheetUrl) {
      throw new Error('Could not access the worksheet image. Please try again.');
    }
    console.log('after signed URL:', Date.now() - t0, 'ms');

    // ===================== STEP 1: read + SOLVE (gpt-5.4) =====================
    const solvePrompt =
      `You are solving a worksheet. Read every question in order (top to bottom,\n` +
      `left column then right column if there are multiple columns).\n\n` +
      `For each question, report:\n` +
      `1. number: the question number as printed (1, 2, 3...)\n` +
      `2. question: the question text, exactly as written (math as "a/b", "x^2")\n` +
      `3. answer: the FULL worked solution as a student would write it by hand —\n` +
      `   each working step on its own line, ending with the final answer.\n` +
      `   e.g. "x = 14.13 + 4.25\\nx = 18.38".\n` +
      `4. number_y_percent: the question's vertical position on the page, as a percent\n` +
      `   from the top (0=top edge, 100=bottom edge).\n` +
      `5. column: "left" or "right" — which column the question is in (single column\n` +
      `   => always "left").\n\n` +
      `Subject: ${subject ?? 'general'}. Style: ${style ?? 'average'}. ` +
      `Difficulty: ${difficulty ?? 'realistic'} ` +
      `(perfect=all correct, realistic=~90% correct, student=~80% with some wrong).\n\n` +
      `Respond ONLY with a JSON array, no markdown:\n` +
      `[{"number": 1, "question": "14.13 = x - 4.25", "answer": "x = 14.13 + 4.25\\nx = 18.38", ` +
      `"number_y_percent": 22, "column": "left"}]`;

    // Always an image URL now (PDFs are pre-rasterized to a PNG on-device).
    const filePart = { type: 'input_image', image_url: worksheetUrl };

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
    console.log('after solve:', Date.now() - t0, 'ms');

    // ===================== STEP 2: hand off to a background task =====================
    // Image generation takes ~130s. Holding the HTTP connection open that long gets it
    // reset by the platform, so we respond NOW (202) and finish Step 2 in the background
    // via EdgeRuntime.waitUntil(). The client learns the outcome from the DB row status
    // (pollInBackground / fillWorksheet retry), not from this response.
    EdgeRuntime.waitUntil(
      runImageGeneration({
        supabase,
        openaiKey,
        worksheetId,
        worksheetUrl,
        questions,
        style,
        userId: user.id,
        month,
        usageRow,
        t0,
      })
    );
    return json({ success: true, status: 'processing', worksheetId }, 202);
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

// ===================== STEP 2 (background): dual-anchor edit + finalize =============
// Runs via EdgeRuntime.waitUntil AFTER the 202 response. Because the response is already
// sent, failures here can't reach the client — this function OWNS its error handling and
// writes status='error' so the client's DB poll surfaces it. The SAME image (signed URL)
// is sent twice: image 1 = locked layout reference, image 2 = the edit target.
async function runImageGeneration(o: {
  supabase: ReturnType<typeof createClient>;
  openaiKey: string;
  worksheetId: string;
  worksheetUrl: string;
  questions: Question[];
  style?: string;
  userId: string;
  month: string;
  usageRow: { worksheets_used?: number; cost_cents?: number } | null;
  t0: number;
}): Promise<void> {
  const { supabase, openaiKey, worksheetId, worksheetUrl, questions, style, userId, month, usageRow, t0 } = o;
  const totalAnswers = questions.length;
  try {
    const imageInput = worksheetUrl; // image_url used for BOTH dual-anchor slots

    const styleDesc = STYLE_DESC[String(style)] ?? STYLE_DESC.average;
    const formattedAnswers = questions
      .map((q) => {
        const work = String(q.answer ?? '')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
          .join('   ');
        return `${q.number ?? ''}. ${work}`;
      })
      .join('\n');

    console.log('after image input prep:', Date.now() - t0, 'ms');

    const editPrompt =
      `The FIRST image is the ORIGINAL worksheet — use it as a strict layout reference.\n` +
      `Every element in it (title, logo, printed questions, fractions, name line,\n` +
      `footer, lines) must remain EXACTLY as shown.\n\n` +
      `The SECOND image is what you are editing. Add ONLY pencil handwriting in the\n` +
      `blank spaces below or beside each question.\n\n` +
      `Do not regenerate the worksheet. Do not change, redraw, "clean up", or restyle\n` +
      `any printed text. Treat the worksheet layout as completely locked.\n\n` +
      `Add this exact handwritten work in pencil:\n${formattedAnswers}\n\n` +
      `Use natural student handwriting (${styleDesc}), medium-dark graphite pencil with\n` +
      `slight pressure variation. Write ONLY in blank areas.`;

    console.log('Starting image generation...');
    const imgStart = Date.now();
    const imgResp = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({
        model: IMAGE_ORCHESTRATOR_MODEL,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_image', image_url: imageInput }, // image 1: layout anchor
              { type: 'input_image', image_url: imageInput }, // image 2: edit target (same)
              { type: 'input_text', text: editPrompt },
            ],
          },
        ],
        // gpt-image-2 (selected by the tool) rejects `input_fidelity` — it already
        // processes inputs at high fidelity by default. Just request high quality.
        tools: [{ type: 'image_generation', quality: IMAGE_QUALITY }],
      }),
    });
    console.log(`Image gen response status: ${imgResp.status} (${Date.now() - imgStart}ms)`);
    if (!imgResp.ok) {
      const detail = await imgResp.text();
      throw new Error(`Image generation failed (${imgResp.status}): ${detail.slice(0, 400)}`);
    }
    const imgJson = await imgResp.json();
    const call = (imgJson?.output ?? []).find((c: any) => c.type === 'image_generation_call');
    const b64 = call?.result;
    console.log(
      `image: model=${IMAGE_ORCHESTRATOR_MODEL} ${Date.now() - imgStart}ms ` +
        `est_cost=$${(ESTIMATED_COST_CENTS / 100).toFixed(2)} hasImage=${!!b64} ` +
        `usage=${JSON.stringify(imgJson?.usage ?? {})}`
    );
    if (!b64) {
      throw new Error(`Image generation returned no image. ${JSON.stringify(imgJson).slice(0, 400)}`);
    }
    console.log('after imagegen:', Date.now() - t0, 'ms');
    const genPngBytes = base64ToBytes(b64);
    console.log('after decode:', Date.now() - t0, 'ms', 'bytes:', genPngBytes.length);

    // Wrap the generated PNG into a single-page PDF (image only) so the app's existing
    // download-PDF UX is unchanged.
    const outDoc = await PDFDocument.create();
    const png = await outDoc.embedPng(genPngBytes);
    const outPage = outDoc.addPage([png.width, png.height]);
    outPage.drawImage(png, { x: 0, y: 0, width: png.width, height: png.height });
    const filledBytes = await outDoc.save();
    console.log(`PDF wrapped, bytes: ${filledBytes.length} (${png.width}x${png.height})`);
    console.log('after pdf wrap:', Date.now() - t0, 'ms');

    // Upload the filled PDF.
    const outputPath = `outputs/${worksheetId}.pdf`;
    const { error: upError } = await supabase.storage
      .from('worksheets')
      .upload(outputPath, filledBytes, { contentType: 'application/pdf', upsert: true });
    if (upError) {
      throw new Error(`Could not upload filled PDF: ${upError.message}`);
    }
    console.log('after upload:', Date.now() - t0, 'ms');

    // Mark complete + write output_path FIRST (before the usage upsert) so that even if
    // the isolate is killed by the CPU/time limit right after, the row is already
    // completed with its output path — never left "complete" with a null output_path.
    console.log('worksheetId from request:', worksheetId);
    console.log('Updating worksheet status to complete...');
    const { data: updData, error: updErr } = await supabase
      .from('worksheets')
      .update({
        status: 'complete',
        output_path: outputPath,
        answer_count: totalAnswers,
        handwriting_style: style ?? null,
      })
      .eq('id', worksheetId)
      .select();
    console.log('completion update result:', JSON.stringify({ rows: updData?.length ?? 0, updErr }));
    // Fail LOUD: never log "complete" while the write silently failed (e.g. a missing
    // column). Throwing sends the row to status='error' with the real DB message.
    if (updErr) {
      throw new Error(`Could not finalize the worksheet (DB update failed): ${updErr.message}`);
    }
    console.log('Set complete, output_path:', outputPath);

    // Count usage + spend now that we have a real result (re-read to avoid clobbering
    // a concurrent success). Non-critical — runs after the completion write.
    const { data: freshUsage } = await supabase
      .from('usage')
      .select('worksheets_used, cost_cents')
      .eq('user_id', userId)
      .eq('month', month)
      .maybeSingle();
    await supabase.from('usage').upsert(
      {
        user_id: userId,
        month,
        worksheets_used: (freshUsage?.worksheets_used ?? usageRow?.worksheets_used ?? 0) + 1,
        cost_cents: (freshUsage?.cost_cents ?? usageRow?.cost_cents ?? 0) + ESTIMATED_COST_CENTS,
      },
      { onConflict: 'user_id,month' }
    );
  } catch (err) {
    // Response already sent — record the failure on the row so the client poll sees it.
    const message = err instanceof Error ? err.message : 'Unknown error.';
    console.error('[fill-worksheet:bg] failed:', message);
    await supabase
      .from('worksheets')
      .update({ status: 'error', error: message.slice(0, 500) })
      .eq('id', worksheetId);
  }
}
