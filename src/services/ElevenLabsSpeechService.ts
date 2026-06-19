const ELEVENLABS_STT_URL = 'https://api.elevenlabs.io/v1/speech-to-text';
const ELEVENLABS_STT_MODEL = 'scribe_v1';

export class ElevenLabsSpeechError extends Error {
  status?: number;
  authFailure: boolean;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ElevenLabsSpeechError';
    this.status = status;
    this.authFailure = status === 401 || status === 403;
  }
}

function parseJsonMaybe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const record = body as Record<string, unknown>;
  const detail = record.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object' && 'message' in detail) {
    return String((detail as { message?: unknown }).message ?? fallback);
  }
  if (typeof record.message === 'string') return record.message;
  if (typeof record.error === 'string') return record.error;
  return fallback;
}

export async function transcribeWithElevenLabs(audioUri: string, apiKey: string, languageCode?: string): Promise<string> {
  const body = new FormData();
  body.append('model_id', ELEVENLABS_STT_MODEL);
  if (languageCode) {
    body.append('language_code', languageCode);
  }
  body.append('file', {
    uri: audioUri,
    name: 'speech.m4a',
    type: 'audio/m4a',
  } as unknown as Blob);

  const response = await fetch(ELEVENLABS_STT_URL, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
    },
    body,
  });

  const responseText = await response.text();
  const parsed = parseJsonMaybe(responseText);

  if (!response.ok) {
    const message = getErrorMessage(parsed, `ElevenLabs STT failed with HTTP ${response.status}`);
    throw new ElevenLabsSpeechError(message, response.status);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new ElevenLabsSpeechError('ElevenLabs STT returned an empty response.');
  }

  const payload = parsed as Record<string, unknown>;
  const text = payload.text ?? payload.transcript;
  if (typeof text !== 'string') {
    throw new ElevenLabsSpeechError('ElevenLabs STT response did not include text.');
  }

  return text.trim();
}
