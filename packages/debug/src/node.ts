import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createAssemblySourceMap} from '@clementina/assembler';
import {buildProject, type ProjectBuildResult} from '@clementina/build';
import {diagnostic, result, type ValidationResult} from '@clementina/core';
import {type ExecutionState, type LaunchLoadPlanOptions} from '@clementina/emulator-client';
import {
  startEmulatorProcess,
  type EmulatorProcess,
  type EmulatorProcessExit,
  type EmulatorProcessOptions,
} from '@clementina/emulator-client/node';
import {resolveProjectPath} from '@clementina/project/node';
import {ClementinaBasicDebugSession, ClementinaDebugSession} from './index.js';

export interface ProjectDebugOptions extends Omit<EmulatorProcessOptions, 'sdRoot'> {
  threadName?: string;
}

export interface ProjectDebugRuntime {
  build: ProjectBuildResult;
  session: ClementinaDebugSession | ClementinaBasicDebugSession;
  endpoint: string;
  pid: number;
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
  const {threadName, ...processOptions} = options;
  try {
    process = await (dependencies.startProcess ?? startEmulatorProcess)({
      ...processOptions,
      sdRoot: resolve(projectRoot, build.value.sdRoot),
    });
  } catch (error) {
    return result(undefined, [diagnostic('debug.emulator-startup', '', error instanceof Error ? error.message : String(error))]);
  }
  try {
    let session: ClementinaDebugSession | ClementinaBasicDebugSession;
    if (build.value.kind === 'assembly') {
      const bank = build.value.assembly.loadStep.bank;
      const sourceMap = createAssemblySourceMap(build.value.assembly.debug, bank === undefined ? {} : {bank});
      session = new ClementinaDebugSession(process.client, sourceMap, {
        ...(bank === undefined ? {} : {bank}),
        ...(threadName === undefined ? {} : {threadName}),
      });
    } else {
      const loadedSource = await (dependencies.readBasicSource ?? readProjectBasicSource)(projectRoot, build.value.basic.source);
      session = new ClementinaBasicDebugSession(process.client, loadedSource.path, loadedSource.text, threadName);
    }
    let closing: Promise<EmulatorProcessExit> | undefined;
    return result({
      build: build.value,
      session,
      endpoint: process.endpoint,
      pid: process.pid,
      /** Start the prepared project after callers have installed breakpoints. */
      launch: (launchOptions?: LaunchLoadPlanOptions) => session.launch(build.value.loadPlan, launchOptions),
      /** Share one cleanup promise across repeated close calls. */
      close: () => closing ??= (async () => {
        await session.dispose().catch(() => undefined);
        return process.close();
      })(),
    }, []);
  } catch (error) {
    await process.close().catch(() => undefined);
    return result(undefined, [diagnostic('debug.session', '', error instanceof Error ? error.message : String(error))]);
  }
}
