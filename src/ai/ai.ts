// Text-to-CAD: asks a language model for a parametric Script feature (JavaScript on the replicad
// API, see src/kernel/scriptApi.ts). Runs in the browser with the user's own API key, which stays
// in this browser and goes only to the provider they picked.
import Anthropic from '@anthropic-ai/sdk';

export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'ollama' | 'custom';

export interface ProviderDef {
  id: ProviderId;
  label: string;
  /** Default model, and some suggestions for the picker. */
  model: string;
  models: string[];
  /** OpenAI-style chat endpoint base (not used for Anthropic). */
  baseUrl?: string;
  needsKey: boolean;
  keyHint: string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: 'anthropic',
    label: 'Claude (Anthropic)',
    model: 'claude-opus-5-5',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'],
    needsKey: true,
    keyHint: 'sk-ant-… from console.anthropic.com',
  },
  { id: 'openai', label: 'OpenAI', model: 'gpt-5', models: ['gpt-5', 'gpt-5-mini'], baseUrl: 'https://api.openai.com/v1', needsKey: true, keyHint: 'sk-… from platform.openai.com' },
  {
    id: 'openrouter',
    label: 'OpenRouter (Gemini, Llama, Mistral, …)',
    model: 'google/gemini-2.5-pro',
    models: ['google/gemini-2.5-pro', 'meta-llama/llama-4-maverick', 'mistralai/mistral-large', 'deepseek/deepseek-chat'],
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    keyHint: 'sk-or-… from openrouter.ai',
  },
  { id: 'ollama', label: 'Ollama (local, free)', model: 'qwen2.5-coder:14b', models: ['qwen2.5-coder:14b', 'llama3.1:8b'], baseUrl: 'http://localhost:11434/v1', needsKey: false, keyHint: 'No key needed. Start Ollama with OLLAMA_ORIGINS=*' },
  { id: 'custom', label: 'Other (OpenAI-compatible)', model: '', models: [], baseUrl: '', needsKey: false, keyHint: 'Any server with an OpenAI-style /chat/completions endpoint' },
];

export interface AiSettings {
  provider: ProviderId;
  model: string;
  baseUrl: string;
  keys: Partial<Record<ProviderId, string>>;
}

const SETTINGS_KEY = 'onlinecad.ai';

export function loadAiSettings(): AiSettings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as AiSettings | null;
    if (s?.provider) return { ...s, keys: s.keys ?? {} };
  } catch {
    // storage unavailable: start fresh
  }
  return { provider: 'anthropic', model: PROVIDERS[0].model, baseUrl: '', keys: {} };
}

export function saveAiSettings(s: AiSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // storage unavailable: settings last for this visit only
  }
}

export interface GeneratedPart {
  name: string;
  params: { name: string; value: number }[];
  code: string;
  notes: string;
}

/** What the model must return. Kept flat so every provider's JSON mode can follow it. */
const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', description: 'Short name for the part, 1-4 words' },
    params: {
      type: 'array',
      description: 'Sizes the user may want to change, in millimetres or counts',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, value: { type: 'number' } },
        required: ['name', 'value'],
        additionalProperties: false,
      },
    },
    code: { type: 'string', description: 'Body of the JavaScript function; must return the shape(s)' },
    notes: { type: 'string', description: 'One or two sentences on what was built and any assumptions' },
  },
  required: ['name', 'params', 'code', 'notes'],
  additionalProperties: false,
} as const;

const SYSTEM = `You write parametric CAD scripts for OnlineCAD, a browser CAD app built on OpenCascade (through the replicad library).

A script is the BODY of a JavaScript function called with two arguments:
- cad: the replicad API plus these helpers
- p: an object with the parameter values (numbers), e.g. p.width

Units are millimetres and degrees. Z points up; parts should sit on the plate (lowest point at Z = 0) and be centered on X and Y unless the user asks otherwise.

Helpers (prefer them; each returns a solid):
- cad.box(x, y, z): box centered on X/Y, from Z=0 to z
- cad.cylinder(radius, height): cylinder standing on the plate at the origin
- cad.sphere(radius): sphere centered at the origin
- cad.cone(r1, r2, height): (truncated) cone standing on the plate
- cad.prism(sides, radius, height): regular polygon prism, radius to the corners (6 = hex)
- cad.extrudePoints([[x,y], ...], height): prism from a closed 2D outline
- cad.union(a, b, ...), cad.subtract(base, tool1, tool2, ...), cad.intersect(a, b)
- cad.move(shape, x, y, z), cad.turn(shape, degrees, [ax, ay, az])

Useful replicad API (all on cad.*):
- shape.fillet(radius) rounds every edge; shape.fillet(r, (e) => e.inDirection('Z')) only vertical edges; (e) => e.inPlane('XY', z) edges in a plane
- shape.chamfer(distance, filter) works the same way
- shape.shell(thickness, (f) => f.inPlane('XY', topZ)) hollows the part and opens the chosen face
- 2D: cad.drawCircle(r), cad.drawRoundedRectangle(w, h, r), cad.drawPolysides(r, n), cad.draw([x,y]).lineTo([x,y]).hLine(dx).vLine(dy).threePointsArcTo(end, mid).close()
- drawing.cut(other), drawing.fuse(other), drawing.translate(dx, dy), drawing.rotate(deg)
- drawing.sketchOnPlane('XY' | 'XZ' | 'YZ', offset).extrude(height); sketch.revolve([0,0,1], { origin: [x,y,z], angle }); sketch.loftWith(otherSketch)
- cad.makeHelix(pitch, height, radius) and cad.genericSweep(profileWire, pathWire, { frenet: true }) for springs and threads

Rules:
- Return a shape, or an array of { shape, name } objects for several separate parts.
- Booleans (fuse, cut, intersect) keep their inputs; translate and rotate consume the shape they are called on, so use the helpers or reassign.
- Keep fillets smaller than half the thinnest wall, or OpenCascade fails.
- Expose the main sizes as params with sensible defaults; reference them as p.name in the code. Parameter names must be valid JavaScript identifiers.
- No imports, no network, no DOM. Plain JavaScript only.
- Build real, manufacturable geometry with the requested features (holes, bosses, slots, fillets), not a rough stand-in.`;

export interface GenerateRequest {
  prompt: string;
  /** The current script, when the user is changing an existing part. */
  current?: { code: string; params: { name: string; value: number | string }[] };
  /** The error from the last attempt, to fix. */
  error?: string;
  signal?: AbortSignal;
}

function userMessage(r: GenerateRequest): string {
  let text = `Make this part: ${r.prompt}`;
  if (r.current) {
    text = `Change this existing part as asked: ${r.prompt}\n\nCurrent parameters: ${JSON.stringify(r.current.params)}\nCurrent code:\n${r.current.code}`;
  }
  if (r.error) text += `\n\nThe last version failed with this error. Fix it and return the complete corrected script:\n${r.error}`;
  return text;
}

function parsePart(text: string): GeneratedPart {
  // JSON mode returns bare JSON; some local models still wrap it in a code fence.
  const raw = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The model did not return valid JSON. Try again, or pick a stronger model.');
  }
  const g = parsed as Partial<GeneratedPart>;
  if (typeof g.code !== 'string' || !g.code.trim()) throw new Error('The model did not return any code.');
  return {
    name: typeof g.name === 'string' && g.name.trim() ? g.name.trim().slice(0, 40) : 'AI part',
    params: Array.isArray(g.params) ? g.params.filter((x) => x && typeof x.name === 'string' && Number.isFinite(x.value)) : [],
    code: g.code,
    notes: typeof g.notes === 'string' ? g.notes : '',
  };
}

export class AiError extends Error {}

export async function generatePart(settings: AiSettings, req: GenerateRequest): Promise<GeneratedPart> {
  const def = PROVIDERS.find((p) => p.id === settings.provider) ?? PROVIDERS[0];
  const key = settings.keys[def.id]?.trim() ?? '';
  if (def.needsKey && !key) throw new AiError(`Add your ${def.label} API key in the AI settings first.`);
  const model = settings.model.trim() || def.model;
  return def.id === 'anthropic' ? generateWithClaude(key, model, req) : generateOpenAiCompatible(def, settings, key, model, req);
}

async function generateWithClaude(apiKey: string, model: string, req: GenerateRequest): Promise<GeneratedPart> {
  // The key is the user's own and never leaves their browser except to Anthropic's API.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  try {
    const stream = client.beta.messages.stream(
      {
        model,
        max_tokens: 32000,
        // Fall back to another model if a safety classifier declines (a CAD request rarely trips one).
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content: userMessage(req) }],
      },
      { signal: req.signal },
    );
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new AiError('The model declined this request. Try describing the part differently.');
    if (message.stop_reason === 'max_tokens') throw new AiError('The answer was cut off. Ask for a simpler part, or split it into steps.');
    const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    return parsePart(text);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('Anthropic rejected the API key. Check it in the AI settings.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new AiError('This API key cannot use that model.');
    if (e instanceof Anthropic.NotFoundError) throw new AiError(`Unknown model "${model}".`);
    if (e instanceof Anthropic.RateLimitError) throw new AiError('Rate limited by Anthropic. Wait a moment and try again.');
    if (e instanceof Anthropic.BadRequestError) throw new AiError(`Anthropic rejected the request: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new AiError(`Anthropic error ${e.status ?? ''}: ${e.message}`);
    throw e;
  }
}

async function generateOpenAiCompatible(def: ProviderDef, s: AiSettings, key: string, model: string, req: GenerateRequest): Promise<GeneratedPart> {
  const base = (def.id === 'custom' ? s.baseUrl : s.baseUrl || def.baseUrl || '').replace(/\/+$/, '');
  if (!base) throw new AiError('Set the server address (base URL) in the AI settings.');
  if (!model) throw new AiError('Set the model name in the AI settings.');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  if (def.id === 'openrouter') headers['X-Title'] = 'OnlineCAD';
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      signal: req.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `${SYSTEM}\n\nAnswer with a single JSON object with the keys name, params (array of {name, value}), code, and notes. No other text.` },
          { role: 'user', content: userMessage(req) },
        ],
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new AiError(def.id === 'ollama' ? 'Could not reach Ollama. Is it running, started with OLLAMA_ORIGINS=* so the browser may connect?' : `Could not reach ${base}.`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AiError(`${def.label} error ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new AiError('The model returned an empty answer.');
  return parsePart(text);
}
