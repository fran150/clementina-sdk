/** Editor-neutral Clementina assembly (ca65, W65C02S) language services. */
export {instructions, instructionFor, addressingModeSyntax, type AddressingMode, type Instruction} from './opcodes.js';
export {caDirectives, directiveFor, type Directive} from './directives.js';
export {parseAsm, tokenize, commentStart, qualifiedName, type AsmSymbol, type AsmSymbolKind, type ParsedFile, type Span} from './parser.js';
export {evaluate, formatValue, numberValue} from './expression.js';
export {AsmWorkspace, type Target, type Occurrence} from './workspace.js';
export {addressingModeOf, completionsAt, explainCa65, documentOutline, hoverAt, signatureHelpAt, type Completion, type OutlineSymbol, type SignatureHelp} from './features.js';
export {assembleForDiagnostics, findCa65, findTool, parseCa65Output, type Ca65Message} from './ca65.js';
export {findProjectRoot, manifestAddress, readAsmProject, readLabels, type AsmProject} from './project.js';
export {
  attributeSpecs, blockSpec, cfgBlocks, configEvaluator, evaluateConfigExpression, parseConfig, tokenizeConfig,
  type CfgAttribute, type CfgAttributeSpec, type CfgBlock, type CfgBlockSpec, type CfgItem, type CfgToken, type ParsedConfig,
} from './ld65-config.js';
export {
  configCompletions, configDefinition, configDiagnostics, configHover, configOutline, memoryAreas, segmentPlacements,
  type ConfigCompletion, type ConfigDiagnostic, type ConfigHover, type ConfigOutlineSymbol, type ConfigProject, type MemoryArea, type SegmentPlacement,
} from './ld65-features.js';
export {checkWithLd65, findLd65, parseLd65Output, type Ld65Message} from './ld65.js';
export {BASIC_START, DEFAULT_MEMORY_TOP, clementinaMemoryMap, memoryAt, type MemoryMapEntry, type MemoryUse} from './clementina-memory.js';
export {bankedSegments, bankSwitchWarnings, isBankSelect, workspaceBankWarnings, type BankedSegment, type BankWarning} from './bank-check.js';
