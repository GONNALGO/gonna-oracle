export const armDevOracle = () => undefined;
export const hasDevOracle = () => true;
export const devOracleSign = async () => { (globalThis.__ORACLE ||= { signs: 0 }).signs++; return new Uint8Array(64); };
export const devOracleSignScore = async () => { (globalThis.__ORACLE ||= { signs: 0 }).signs++; return new Uint8Array(64); };
