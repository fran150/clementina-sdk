/** Numeric range that can report an inclusive end, an exclusive end, or both. */
export interface AddressRange {
  /** First address in the range. */
  start: number;
  /** Last address in the range, when expressed inclusively. */
  end?: number;
  /** First address after the range, when expressed exclusively. */
  endExclusive?: number;
  /** Number of addresses in the range. */
  size: number;
}

/** Core fields from the versioned machine specification. */
export interface ClementinaMachineSpec {
  format: "clementina-machine";
  version: number;
  cpu: { model: string; addressBits: number; cpuAddressSpaceBytes: number };
  miaRam: { addressBits: number; start: number; end: number; size: number };
}

/** A machine-readable issue with a human-readable explanation. */
export interface ClementinaDiagnostic {
  /** Severity used to decide whether validation can succeed. */
  severity: "info" | "warning" | "error";
  /** Stable issue identifier for programmatic handling. */
  code: string;
  /** Human-readable explanation of the issue. */
  message: string;
  /** Source document or file, when known. */
  source?: string;
  /** JSON Pointer within the source document; an empty string means its root. */
  path?: string;
}
