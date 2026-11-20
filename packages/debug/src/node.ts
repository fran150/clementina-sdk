import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createAssemblySourceMap} from '@clementina/assembler';
import {buildProject, type ProjectBuildResult} from '@clementina/build';
import {diagnostic, errorMessage, result, type ValidationResult} from '@clementina/core';
import {type BankBreakpoint, type EmulatorClient, type ExecutionState, type LaunchLoadPlanOptions} from '@clementina/emulator-client';
import {bankSwitchStops} from './bank-stops.js';
import {
  startEmulatorProcess,
  type EmulatorProcess,
  type EmulatorProcessExit,
  type EmulatorProcessOptions,
} from '@clementina/emulator-client/node';
import {resolveProjectPath} from '@clementina/project/node';
export {DEFAULT_VIDEO_CLIENT_EXECUTABLE, findInstalledTool} from '@clementina/emulator-client/node';
import {ClementinaBasicDebugSession, ClementinaDebugSession, ClementinaProjectDebugSession} from './index.js';

export interface ProjectDebugOptions extends Omit<EmulatorProcessOptions, 'sdRoot'> {
  threadName?: string;
  /**
   * Stop just before code linked at $8000-$BFFF stores to VIA Port A, which
   * switches the bank under it: a bank breakpoint on each such store.
   */
  stopOnBankSwitch?: boolean;
}

export interface ProjectDebugRuntime {
  build: ProjectBuildResult;
  session: ClementinaDebugSession | ClementinaBasicDebugSession | ClementinaProjectDebugSession;
  /** The emulator's client, for controls outside source debugging such as speed. */
  client: EmulatorClient;
  endpoint: string;
  pid: number;
  /** With stopOnBankSwitch, the bank breakpoints on the stores that switch banks under banked code. */
  bankSwitchStops: BankBreakpoint[];
  /** Reset, enter the generated BASIC bootstrap, and begin project execution. */
  launch(options?: LaunchLoadPlanOptions): Promise<ExecutionState>;
  /** Release owned breakpoints and stop the emulator process once. */
  close(): Promise<EmulatorProcessExit>;
}

export interface ProjectDebugDependencies {
  /** Override project building, primarily for host integration and tests. */
  build?: typeof buildProject;
  /** Override emulator process startup. */
  startProcess?: typeof startEmulatorProcess;
  /** Override how the BASIC entry source is resolved and read. */
  readBasicSource?: (projectRoot: string, source: string) => Promise<{path: string; text: string}>;
}

/** Resolve and read the BASIC entry file using the portable project path rules. */
async function readProjectBasicSource(projectRoot: string, source: string): Promise<{path: string; text: string}> {
  const path = await resolveProjectPath(projectRoot, source);
  return {path, text: await readFile(path, 'utf8')};
}

/**
 * Build a project and prepare an owned emulator-backed debug session. The caller
 * can configure breakpoints before calling launch, matching editor initialization.
 */
export async function createProjectDebugSession(
  projectRoot: string,
  options: ProjectDebugOptions = {},
  dependencies: ProjectDebugDependencies = {},
): Promise<ValidationResult<ProjectDebugRuntime>> {
  const build = await (dependencies.build ?? buildProject)(projectRoot);
  if (!build.ok) return build as ValidationResult<ProjectDebugRuntime>;
  let process: EmulatorProcess;
  const {threadName, stopOnBankSwitch, ...processOptions} = options;
  // A real-time emulator starts at the project's speed (target.phi2Hz) unless the caller picked one.
  const speed = build.value.loadPlan?.steps?.find(step => step.kind === 'speed');
  if (processOptions.realtime && processOptions.realtime.speedMhz === undefined && speed) {
    processOptions.realtime = {...processOptions.realtime, speedMhz: speed.hz / 1_000_000};
  }
  try {
    process = await (dependencies.startProcess ?? startEmulatorProcess)({
      ...processOptions,
      sdRoot: resolve(projectRoot, build.value.sdRoot),
    });
  } catch (error) {
    return result(undefined, [diagnostic('debug.emulator-startup', '', errorMessage(error))]);
  }
  try {
    let session: ClementinaDebugSession | ClementinaBasicDebugSession | ClementinaProjectDebugSession;
    const assembly = build.value.assembly && (() => {
      const {loadStep, debug, segmentBanks} = build.value.assembly!;
      const bank = loadStep.bank;
      const sourceMap = createAssemblySourceMap(debug, {...(bank === undefined ? {} : {bank}), segmentBanks: segmentBanks ?? {}});
      // With build.assembly.banks the code is in several banks, so the session
      // follows the bank the emulator reports instead of filtering by one.
      const sessionBank = Object.keys(segmentBanks ?? {}).length ? undefined : bank;
      return new ClementinaDebugSession(process.client, sourceMap, {
        symbols: debug.symbols,
        ...(sessionBank === undefined ? {} : {bank: sessionBank}),
        ...(threadName === undefined ? {} : {threadName}),
      });
    })();
    if (!build.value.basic) {
      session = assembly!;
    } else {
      const loadedSource = await (dependencies.readBasicSource ?? readProjectBasicSource)(projectRoot, build.value.basic.source);
      const basic = new ClementinaBasicDebugSession(process.client, loadedSource.path, loadedSource.text, threadName, [build.value.basic.source]);
      // A BASIC program that calls assembly routines debugs both at once.
      session = assembly ? new ClementinaProjectDebugSession(basic, assembly, threadName) : basic;
    }
    let closing: Promise<EmulatorProcessExit> | undefined;
    const stops = stopOnBankSwitch && build.value.assembly ? bankSwitchStops(build.value.assembly) : [];
    return result({
      build: build.value,
      session,
      client: process.client,
      endpoint: process.endpoint,
      pid: process.pid,
      /** Start the prepared project after callers have installed breakpoints. */
      bankSwitchStops: stops,
      launch: async (launchOptions?: LaunchLoadPlanOptions) => {
        for (const stop of stops) await process.client.addBankBreakpoint(stop.address, stop.bank);
        return session.launch(build.value.loadPlan, launchOptions);
      },
      /** Share one cleanup promise across repeated close calls. */
      close: () => closing ??= (async () => {
        await session.dispose().catch(() => undefined);
        return process.close();
      })(),
    }, []);
  } catch (error) {
    await process.close().catch(() => undefined);
    return result(undefined, [diagnostic('debug.session', '', errorMessage(error))]);
  }
}
