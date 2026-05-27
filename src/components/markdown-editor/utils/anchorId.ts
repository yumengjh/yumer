const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ANCHOR_LENGTH = 6;

export function generateAnchorId(): string {
  const bytes = new Uint8Array(ANCHOR_LENGTH);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < ANCHOR_LENGTH; i++) {
    result += BASE62[bytes[i] % 62];
  }
  return result;
}
