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
import {ClementinaDebugSession} from './index.js';

export interface ProjectDebugOptions extends Omit<EmulatorProcessOptions, 'sdRoot'> {
  threadName?: string;
}

export interface ProjectDebugRuntime {
  build: ProjectBuildResult;
  session: ClementinaDebugSession;
  endpoint: string;
  pid: number;
  /** Reset, enter the generated BASIC bootstrap, and begin project execution. */
  launch(options?: LaunchLoadPlanOptions): Promise<ExecutionState>;
  close(): Promise<EmulatorProcessExit>;
}

export interface ProjectDebugDependencies {
  build?: typeof buildProject;
  startProcess?: typeof startEmulatorProcess;
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
  if (build.value.kind !== 'assembly') {
    return result(undefined, [diagnostic('debug.program-kind', '/program/kind', 'The current source debugger requires an assembly project and ld65 debug records')]);
  }
  let process: EmulatorProcess;
  const {threadName, ...processOptions} = options;
  try {
    process = await (dependencies.startProcess ?? startEmulatorProcess)({
      ...processOptions,
      sdRoot: projectRoot,
    });
  } catch (error) {
    return result(undefined, [diagnostic('debug.emulator-startup', '', error instanceof Error ? error.message : String(error))]);
  }
  try {
    const bank = build.value.assembly.loadStep.bank;
    const sourceMap = createAssemblySourceMap(build.value.assembly.debug, bank === undefined ? {} : {bank});
    const session = new ClementinaDebugSession(process.client, sourceMap, {
      ...(bank === undefined ? {} : {bank}),
      ...(threadName === undefined ? {} : {threadName}),
    });
    let closing: Promise<EmulatorProcessExit> | undefined;
    return result({
      build: build.value,
      session,
      endpoint: process.endpoint,
      pid: process.pid,
      launch: (launchOptions?: LaunchLoadPlanOptions) => session.launch(build.value.loadPlan, launchOptions),
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
