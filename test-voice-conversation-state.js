const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, 'src/hooks/voiceConversationState.ts');
const source = fs.readFileSync(sourcePath, 'utf8')
  .replace("import type { VoiceState } from '@/services/VoiceEngine';", "type VoiceState = 'idle' | 'listening' | 'thinking' | 'preparingAudio' | 'speaking';");

const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const moduleShim = { exports: {} };
new Function('module', 'exports', compiled)(moduleShim, moduleShim.exports);

const {
  initialVoiceConversationState,
  voiceConversationReducer,
  getVoiceOrbState,
} = moduleShim.exports;

function reduce(...actions) {
  return actions.reduce(voiceConversationReducer, initialVoiceConversationState);
}

assert.equal(initialVoiceConversationState.status, 'paused');
assert.equal(initialVoiceConversationState.sessionEnabled, false);

assert.deepEqual(
  reduce({ type: 'RESUME_MIC' }, { type: 'MIC_READY' }),
  {
    status: 'listening',
    transcript: '',
    error: null,
    foreground: true,
    sessionEnabled: true,
  },
);

assert.equal(
  reduce(
    { type: 'RESUME_MIC' },
    { type: 'MIC_READY' },
    { type: 'TRANSCRIPT_PARTIAL', text: 'hello' },
    { type: 'SEND_UTTERANCE' },
    { type: 'AGENT_STARTED' },
  ).status,
  'awaitingAgent',
);

assert.equal(
  reduce(
    { type: 'RESUME_MIC' },
    { type: 'AGENT_FINAL' },
  ).status,
  'recovering',
);

assert.equal(
  reduce(
    { type: 'RESUME_MIC' },
    { type: 'BACKGROUND' },
    { type: 'AGENT_FINAL' },
  ).status,
  'paused',
);

assert.equal(
  reduce(
    { type: 'RESUME_MIC' },
    { type: 'TTS_STARTED' },
    { type: 'TTS_DONE' },
  ).status,
  'recovering',
);

assert.equal(
  reduce(
    { type: 'RESUME_MIC' },
    { type: 'TTS_STARTED' },
    { type: 'PAUSE_MIC' },
  ).status,
  'paused',
);

assert.equal(
  reduce(
    { type: 'RESUME_MIC' },
    { type: 'AUDIO_ERROR', error: 'mic failed' },
  ).sessionEnabled,
  false,
);

assert.equal(getVoiceOrbState('awaitingAgent', 'idle'), 'idle');
assert.equal(getVoiceOrbState('agentStreaming', 'idle'), 'idle');
assert.equal(getVoiceOrbState('listening', 'thinking'), 'thinking');
assert.equal(getVoiceOrbState('recovering', 'preparingAudio'), 'thinking');
assert.equal(getVoiceOrbState('listening', 'idle'), 'listening');
assert.equal(getVoiceOrbState('paused', 'speaking'), 'speaking');

console.log('voice conversation state tests passed');
