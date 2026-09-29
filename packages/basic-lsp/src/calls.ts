import type {BasicLineLexeme} from '@clementina/basic';

/** Locate the opening parenthesis of a tokenized function, including named FN calls. */
export function functionCallOpen(body: string, lexeme: BasicLineLexeme): number | undefined {
  if (!lexeme.keyword) return undefined;
  let open = lexeme.keyword.endsWith('(') ? lexeme.end - 1 : lexeme.end;
  if (lexeme.keyword === 'FN') {
    while (body[open] === ' ') open++;
    const name = /^[A-Za-z][A-Za-z0-9]*[$%]?/u.exec(body.slice(open));
    if (name) open += name[0].length;
  }
  while (body[open] === ' ') open++;
  return body[open] === '(' ? open : undefined;
}
