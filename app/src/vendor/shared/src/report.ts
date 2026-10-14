// The CRE report contract between cre/risk-desk (encoder) and contracts/src/RiskDesk.sol (decoder).
import { concatHex, decodeAbiParameters, encodeAbiParameters, numberToHex, padHex, type Hex } from "viem";

export const RISK_REPORT_PARAMS = [
  { name: "tObs", type: "uint40" },
  { name: "sigmaE9", type: "uint32" },
  { name: "rv15E9", type: "uint32" },
  { name: "dvolE2", type: "uint16" },
  { name: "refTick", type: "int24" },
  { name: "dispBp", type: "uint16" },
  { name: "nSources", type: "uint8" },
  { name: "kE4", type: "uint16" },
  { name: "zone", type: "uint8" },
] as const;

export type RiskReport = {
  tObs: number;
  sigmaE9: number;
  rv15E9: number;
  dvolE2: number;
  refTick: number;
  dispBp: number;
  nSources: number;
  kE4: number;
  zone: number;
};

export function encodeRiskReport(r: RiskReport): Hex {
  return encodeAbiParameters(RISK_REPORT_PARAMS, [
    r.tObs,
    r.sigmaE9,
    r.rv15E9,
    r.dvolE2,
    r.refTick,
    r.dispBp,
    r.nSources,
    r.kE4,
    r.zone,
  ]);
}

export function decodeRiskReport(data: Hex): RiskReport {
  const [tObs, sigmaE9, rv15E9, dvolE2, refTick, dispBp, nSources, kE4, zone] = decodeAbiParameters(RISK_REPORT_PARAMS, data);
  return { tObs, sigmaE9, rv15E9, dvolE2, refTick, dispBp, nSources, kE4, zone };
}

/** MockKeystoneForwarder.METADATA_LENGTH: version(1) execId(32) timestamp(4) donId(4) donConfigVersion(4) workflowCid(32) workflowName(10) workflowOwner(20) reportId(2). */
export const MOCK_FORWARDER_METADATA_LENGTH = 109;

/**
 * rawReport accepted by MockKeystoneForwarder.report(receiver, rawReport, reportContext, signatures)
 * on Sepolia (0x15fC6ae953E024d975e77382eEeC56A9101f9F88). The mock skips every signature check, so
 * anyone can call it: this is how the forged-report security demo reaches RiskDesk.onReport.
 */
export function buildMockRawReport(r: RiskReport, opts: { executionId: Hex; timestamp: number }): Hex {
  return concatHex([
    "0x01",
    padHex(opts.executionId, { size: 32 }),
    numberToHex(opts.timestamp, { size: 4 }),
    numberToHex(0, { size: 4 }), // donId
    numberToHex(0, { size: 4 }), // donConfigVersion
    padHex("0x", { size: 32 }), // workflowCid
    padHex("0x", { size: 10 }), // workflowName
    padHex("0x", { size: 20 }), // workflowOwner
    "0x0001", // reportId
    encodeRiskReport(r),
  ]);
}
