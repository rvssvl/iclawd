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

const profileSourcePath = path.join(__dirname, 'src/services/GatewayProfiles.ts');
const profileSource = fs.readFileSync(profileSourcePath, 'utf8')
  .replace(
    "import * as SecureStore from '@/services/SafeSecureStore';",
    `const profileStore = new Map();
     const SecureStore = {
       getItemAsync: async (key) => profileStore.get(key) ?? null,
       setItemAsync: async (key, value) => { profileStore.set(key, value); },
       deleteItemAsync: async (key) => { profileStore.delete(key); },
     };`,
  )
  .replace("import { mergeConversationHistories } from '@/services/ConversationHistory';", 'const mergeConversationHistories = async () => {};')
  .replace("import type { GatewayBackend, GatewayConfig, GatewayProfile } from '@/types/gateway';", "type GatewayBackend = 'openclaw'; type GatewayConfig = { url: string; token: string; deviceToken?: string; name?: string }; type GatewayProfile = GatewayConfig & { id: string; backend: GatewayBackend; createdAt: number; lastConnectedAt?: number };");

const profileCompiled = ts.transpileModule(profileSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const profileModule = { exports: {} };
new Function('module', 'exports', profileCompiled)(profileModule, profileModule.exports);

const { getGatewayProfiles, planGatewayProfileDeduplication, saveGatewayProfile } = profileModule.exports;
const baseProfile = {
  backend: 'openclaw',
  name: 'My Gateway',
  url: 'wss://gateway.example.com/',
  token: 'same-token',
};
const firstProfile = { ...baseProfile, id: 'first', createdAt: 1, lastConnectedAt: 10 };
const activeProfile = { ...baseProfile, id: 'active', createdAt: 2, lastConnectedAt: 20 };
const distinctProfile = { ...baseProfile, id: 'distinct', token: 'other-token', createdAt: 3 };
const deduplicationPlan = planGatewayProfileDeduplication(
  [firstProfile, activeProfile, distinctProfile],
  'active',
);

assert.deepEqual(deduplicationPlan.profiles.map((profile) => profile.id), ['active', 'distinct']);
assert.equal(deduplicationPlan.activeProfileId, 'active');
assert.deepEqual(deduplicationPlan.historyMigrations, [{ targetId: 'active', sourceIds: ['first'] }]);

async function assertGatewayIdentityUpsert() {
  await saveGatewayProfile(baseProfile);
  await saveGatewayProfile({ ...baseProfile, url: 'wss://gateway.example.com', deviceToken: 'rotated-token' });
  const savedProfiles = await getGatewayProfiles();
  assert.equal(savedProfiles.length, 1, 'saving the same gateway must update its profile');
  assert.equal(savedProfiles[0].deviceToken, 'rotated-token');
}

const clientSource = fs.readFileSync(path.join(__dirname, 'src/services/GatewayClient.ts'), 'utf8');
assert.match(clientSource, /DEFAULT_MAIN_SESSION_KEY = 'agent:main:main'/);
assert.match(clientSource, /'chat\.abort'/);
assert.match(clientSource, /APP_VERSION = '3\.1\.0'/);

const storageSource = fs.readFileSync(path.join(__dirname, 'src/services/SecureStorage.ts'), 'utf8');
assert.match(storageSource, /activeProfile \? \{ id: activeProfile\.id \} : undefined/);
assert.doesNotMatch(storageSource, /updateActiveGatewayDeviceToken/);

const elevenLabsConfigSource = fs.readFileSync(path.join(__dirname, 'src/services/ElevenLabsConfig.ts'), 'utf8')
  .replace("import * as SecureStore from '@/services/SafeSecureStore';", 'const SecureStore = {};');
const elevenLabsConfigCompiled = ts.transpileModule(elevenLabsConfigSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const elevenLabsConfigModule = { exports: {} };
new Function('module', 'exports', elevenLabsConfigCompiled)(elevenLabsConfigModule, elevenLabsConfigModule.exports);
const { isElevenLabsApiKeyRejection, isValidElevenLabsApiKey } = elevenLabsConfigModule.exports;

assert.equal(isValidElevenLabsApiKey('sk_example_123'), true);
assert.equal(isValidElevenLabsApiKey('api-key-id'), false);
assert.equal(
  isElevenLabsApiKeyRejection('HTTP 400: {"detail":{"code":"invalid_api_key"}}'),
  true,
);

const assistantSpeechPath = path.join(__dirname, 'src/utils/assistantSpeechText.ts');
const assistantSpeechSource = fs.readFileSync(assistantSpeechPath, 'utf8');
const assistantSpeechCompiled = ts.transpileModule(assistantSpeechSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const assistantSpeechModule = { exports: {} };
new Function('module', 'exports', assistantSpeechCompiled)(assistantSpeechModule, assistantSpeechModule.exports);

const {
  prepareAssistantSpeechText,
  isLikelyAssistantEcho,
  normalizeForEchoMatch,
} = assistantSpeechModule.exports;

assert.equal(
  prepareAssistantSpeechText('**KITT:** Certainly, Paul. Here is the summary.'),
  'Certainly, Paul. Here is the summary.',
);

assert.equal(
  prepareAssistantSpeechText('KITT: **Key Details:**\n\n---\n\n| Source | Amount |\n| --- | --- |\n| NYT | **$1.4 billion** |'),
  'Key Details: Source, Amount. NYT, $1.4 billion',
);

assert.equal(
  prepareAssistantSpeechText('Read [the guide](https://example.com/setup) before pairing.'),
  'Read the guide before pairing.',
);

const normalizedAssistant = normalizeForEchoMatch(
  'Certainly, Paul. Here is a comprehensive summary about the weather warning and what to do next.',
);

assert.equal(
  isLikelyAssistantEcho(
    'Here is a comprehensive summary about the weather warning',
    normalizedAssistant,
    Date.now() - 2000,
  ),
  true,
);

assert.equal(
  isLikelyAssistantEcho(
    'Should I pull over until the storm passes?',
    normalizedAssistant,
    Date.now() - 2000,
  ),
  false,
);

assertGatewayIdentityUpsert()
  .then(() => console.log('voice conversation state tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
