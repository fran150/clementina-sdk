/** A malformed protocol response or a server-reported automation failure. */
export class EmulatorError extends Error {}

/** A source line has no exact emitted instruction location. */
export class SourceBreakpointError extends EmulatorError {}

/** Source stepping cannot proceed from the current execution state. */
export class SourceStepError extends EmulatorError {}
