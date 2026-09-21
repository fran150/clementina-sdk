export interface AddressRange {
  start: number;
  end?: number;
  endExclusive?: number;
  size: number;
}

export interface ClementinaMachineSpec {
  format: "clementina-machine";
  version: number;
  cpu: { model: string; addressBits: number; cpuAddressSpaceBytes: number };
  miaRam: { addressBits: number; start: number; end: number; size: number };
}

export interface ClementinaDiagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  source?: string;
}
