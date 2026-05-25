let localMessageCounter = 0;

export function createLocalMessageId(prefix: string): string {
  localMessageCounter += 1;
  return `${prefix}-${Date.now()}-${localMessageCounter}`;
}
