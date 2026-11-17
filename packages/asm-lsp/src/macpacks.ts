/** Macros from ca65's built-in macro packages, which `.macpack name` loads. */
export interface PackMacro {
  name: string;
  pack: string;
  syntax: string;
  summary: string;
}

const longBranch = (name: string, condition: string): PackMacro => ({
  name, pack: 'longbranch', syntax: `${name} label`,
  summary: `Branches when ${condition}, to any distance: a branch when the label is near, else the opposite branch over a JMP.`,
});

const list: PackMacro[] = [
  {name: 'add', pack: 'generic', syntax: 'add operand', summary: 'Adds without carry in: CLC, then ADC operand.'},
  {name: 'sub', pack: 'generic', syntax: 'sub operand', summary: 'Subtracts without borrow in: SEC, then SBC operand.'},
  {name: 'bge', pack: 'generic', syntax: 'bge label', summary: 'Branches when greater or equal (unsigned) after a compare: BCS.'},
  {name: 'blt', pack: 'generic', syntax: 'blt label', summary: 'Branches when less than (unsigned) after a compare: BCC.'},
  {name: 'bgt', pack: 'generic', syntax: 'bgt label', summary: 'Branches when greater than (unsigned) after a compare: BEQ over a BCS.'},
  {name: 'ble', pack: 'generic', syntax: 'ble label', summary: 'Branches when less or equal (unsigned) after a compare: BEQ and BCC.'},
  {name: 'bnz', pack: 'generic', syntax: 'bnz label', summary: 'Branches when not zero: BNE.'},
  {name: 'bze', pack: 'generic', syntax: 'bze label', summary: 'Branches when zero: BEQ.'},
  longBranch('jeq', 'Z = 1'), longBranch('jne', 'Z = 0'), longBranch('jmi', 'N = 1'), longBranch('jpl', 'N = 0'),
  longBranch('jcs', 'C = 1'), longBranch('jcc', 'C = 0'), longBranch('jvs', 'V = 1'), longBranch('jvc', 'V = 0'),
];

export const packMacros: ReadonlyMap<string, PackMacro> = new Map(list.map(item => [item.name, item]));

/** The package macro a word names, when one of the loaded packages has it. */
export function packMacroFor(word: string, packs: readonly string[]): PackMacro | undefined {
  const macro = packMacros.get(word.toLowerCase());
  return macro && packs.includes(macro.pack) ? macro : undefined;
}
