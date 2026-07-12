const RECENT_ECHO_WINDOW_MS = 45000;
const MIN_ECHO_TEXT_LENGTH = 18;

type LastSpokenAssistantSpeech = {
  text: string;
  normalized: string;
  spokenAt: number;
};

let lastSpokenAssistantSpeech: LastSpokenAssistantSpeech | null = null;

const SPEAKER_NAMES = [
  'assistant',
  'agent',
  'claw',
  'clawvoice',
  'kitt',
  'openclaw',
];

const speakerNamePattern = SPEAKER_NAMES.join('|');
const leadingSpeakerPattern = new RegExp(
  `^(?:[\\s>*_\`~#-]|[^\\w\\s])*(?:\\*{0,2}|_{0,2})\\s*(?:${speakerNamePattern})\\s*(?:\\*{0,2}|_{0,2})\\s*[:\\-\\u2013\\u2014]\\s*(?:\\*{0,2}|_{0,2})\\s*`,
  'i',
);

export function prepareAssistantSpeechText(raw: string): string {
  let text = raw || '';

  for (let i = 0; i < 3; i += 1) {
    const next = text.replace(leadingSpeakerPattern, '');
    if (next === text) break;
    text = next;
  }

  text = text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/```/g, ' '))
    .replace(/`([^`]+)`/g, '$1');

  const lines = text
    .split(/\r?\n/)
    .map((line) => cleanSpeechLine(line))
    .filter(Boolean);

  return lines
    .join('. ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/[*_]{1,}/g, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/([:;])\./g, '$1')
    .replace(/([.!?]){3,}/g, '$1')
    .trim();
}

export function rememberAssistantSpeech(text: string, spokenAt = Date.now()): void {
  const normalized = normalizeForEchoMatch(text);
  if (!normalized) return;
  lastSpokenAssistantSpeech = { text, normalized, spokenAt };
}

export function isLikelyRecentAssistantEcho(transcript: string, now = Date.now()): boolean {
  if (!lastSpokenAssistantSpeech) return false;
  return isLikelyAssistantEcho(
    transcript,
    lastSpokenAssistantSpeech.normalized,
    lastSpokenAssistantSpeech.spokenAt,
    now,
  );
}

export function isLikelyAssistantEcho(
  transcript: string,
  normalizedAssistantSpeech: string,
  spokenAt: number,
  now = Date.now(),
): boolean {
  const normalizedTranscript = normalizeForEchoMatch(transcript);
  if (
    !normalizedTranscript
    || !normalizedAssistantSpeech
    || normalizedTranscript.length < MIN_ECHO_TEXT_LENGTH
    || now - spokenAt > RECENT_ECHO_WINDOW_MS
  ) {
    return false;
  }

  if (
    normalizedTranscript.length >= MIN_ECHO_TEXT_LENGTH
    && normalizedAssistantSpeech.includes(normalizedTranscript)
  ) {
    return true;
  }

  const transcriptTokens = uniqueTokens(normalizedTranscript);
  if (transcriptTokens.length < 5) return false;

  const assistantTokens = new Set(uniqueTokens(normalizedAssistantSpeech));
  const overlap = transcriptTokens.filter((token) => assistantTokens.has(token)).length;
  return overlap / transcriptTokens.length >= 0.72;
}

export function normalizeForEchoMatch(text: string): string {
  return prepareAssistantSpeechText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSpeechLine(line: string): string {
  let cleaned = line.trim();
  if (!cleaned) return '';

  if (/^[-*_]{3,}$/.test(cleaned)) return '';
  if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(cleaned)) return '';

  cleaned = cleaned
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '');

  if (cleaned.includes('|')) {
    cleaned = cleaned
      .split('|')
      .map((part) => part.trim())
      .filter(Boolean)
      .join(', ');
  }

  return cleaned;
}

function uniqueTokens(text: string): string[] {
  return Array.from(new Set(
    text
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2),
  ));
}
