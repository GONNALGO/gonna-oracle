export const oracleScoreSig = async () => { (globalThis.__ORACLE ||= { signs: 0 }).signs++; return new Uint8Array(64); };
export const oracleVerdictSig = async () => new Uint8Array(64);
export const registerContinueReceipt = async () => undefined;
export const oracleBaseUrl = () => 'stub';
export const oracleLine = () => 'STUB ORACLE';
