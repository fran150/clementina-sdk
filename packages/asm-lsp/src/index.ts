/** Editor-neutral Clementina assembly (ca65, W65C02S) language services. */
export {instructions, instructionFor, addressingModeSyntax, type AddressingMode, type Instruction} from './opcodes.js';
export {caDirectives, directiveFor, type Directive} from './directives.js';
export {parseAsm, tokenize, commentStart, qualifiedName, type AsmSymbol, type AsmSymbolKind, type ParsedFile, type Span} from './parser.js';
export {evaluate, formatValue, numberValue} from './expression.js';
export {AsmWorkspace, type Target, type Occurrence} from './workspace.js';
export {addressingModeOf, completionsAt, explainCa65, documentOutline, hoverAt, signatureHelpAt, type Completion, type OutlineSymbol, type SignatureHelp} from './features.js';
export {assembleForDiagnostics, findCa65, parseCa65Output, type Ca65Message} from './ca65.js';
export {findProjectRoot, readAsmProject, readLabels, type AsmProject} from './project.js';
