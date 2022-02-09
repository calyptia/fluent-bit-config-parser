import { v4 as uuidv4 } from 'uuid';
import { COMMANDS, FluentBitSection, FluentBitToken, TOKEN_TYPES, type FluentBitSchemaType } from './constants';
import { isCommandType, isCustomSectionName, isFluentBit, isValidFluentBitSection } from './guards';
import { keywords, states } from 'moo';
import { schemaToString } from './schemaToString';
import { readFileSync, realpathSync } from 'fs';
import { join } from 'path';
import { dirname, isAbsolute } from 'path/posix';
import { TokenError } from './TokenError';
import { TokenIndex } from './TokenIndex';
function normalizeField(field: string) {
  const normalizedField = field.toLowerCase();
  return normalizedField === 'match_regex' ? 'match' : normalizedField;
}

const stateSet = {
  main: {
    [TOKEN_TYPES.OPEN_BLOCK]: { match: '[', push: 'block' },
    [TOKEN_TYPES.INCLUDE]: { match: /@include+\s.*/, lineBreak: true },
    [TOKEN_TYPES.PROPERTIES]: [
      {
        match: /\w+[-.*\d\w]+\s.*/,
        value: (value: string) => value.replace(/\s+/, ' ').trim(),
        lineBreaks: true,
      },
    ],
    [TOKEN_TYPES.SPACE]: { match: /\s+/, lineBreaks: true },
    [TOKEN_TYPES.COMMENT]: { match: /#.*/, lineBreaks: true },
  },
  block: {
    [TOKEN_TYPES.COMMAND]: {
      match: /\w+/,
      type: keywords(COMMANDS),
    },
    [TOKEN_TYPES.COMMENT]: { match: /#.*/, lineBreaks: true },
    [TOKEN_TYPES.CLOSE_BLOCK]: { match: ']', push: 'main' },
  },
};
export function tokenize(config: string, filePath: string, pathMemo = new Set()): FluentBitToken[] {
  if (!config.replace(/\s/g, '')) {
    throw new TokenError('File is empty', filePath, 0, 0);
  }

  if (!isFluentBit(config)) {
    throw new TokenError('This file is not a valid Fluent Bit config file', filePath, 0, 0);
  }

  let tokens = [] as FluentBitToken[];
  const lexer = states(stateSet).reset(config);

  // We will expand every include first, looking for any missing paths and invalid tokens
  // https://github.com/calyptia/fluent-bit-config-parser/issues/15
  for (const token of lexer) {
    if (token.type === TOKEN_TYPES.INCLUDE) {
      const [, includeFilePath, ...rest] = token.value.split(' ');

      // In case we find more arguments in the value given to the include directive we will fail with some guidance in the error.
      if (rest.length) {
        throw new TokenError(
          `You are trying to include ${includeFilePath}, but we also found more arguments (${rest}). Includes can only have a single value (ex: @includes path/to/a/file)`,
          filePath,
          token.line,
          token.col
        );
      }
      let includeConfig = '';
      const fullPath = join(dirname(filePath), includeFilePath);

      try {
        const realPath = realpathSync(fullPath);

        if (pathMemo.has(realPath)) {
          throw new TokenError(
            `You are trying to include ${realPath}. Fluent Bit does not allow a file to be included twice in the same configuration`,
            filePath,
            token.line,
            token.col
          );
        }

        includeConfig = readFileSync(realPath, { encoding: 'utf-8' });
        pathMemo.add(realPath);
      } catch (e) {
        if (e instanceof TokenError) {
          throw e;
        }
        throw new TokenError(`Can not read file, loading from ${filePath} `, fullPath, token.line, token.col);
      }

      const includeTokens = tokenize(includeConfig, fullPath, pathMemo);
      tokens = [...tokens, ...includeTokens];
    } else {
      tokens.push({ ...token, filePath });
    }
  }

  return tokens;
}
export function tokensToAST(tokens: FluentBitToken[], tokenIndex: TokenIndex): FluentBitSchemaType[] {
  const configBlocks = [] as FluentBitSchemaType[];
  let block = {} as FluentBitSchemaType;
  let command = undefined as COMMANDS | undefined;

  for (const token of tokens) {
    if (token.type === TOKEN_TYPES.SPACE) {
      continue;
    }

    if (token.type === TOKEN_TYPES.OPEN_BLOCK) {
      if (command) {
        configBlocks.push(block);
      }
      block = { id: uuidv4() } as FluentBitSchemaType;
      tokenIndex.set(block.id, token);
      command = undefined;
      continue;
    }

    // If we find a valid command we begin collecting properties.
    if (isCommandType(token.type)) {
      command = token.value as COMMANDS;
      block = { ...block, command, optional: {}, __filePath: token.filePath };

      tokenIndex.set(block.id, token);
      continue;
    }

    if (command) {
      if (token.type === TOKEN_TYPES.PROPERTIES) {
        const [key, ...value] = token.value.split(' ');
        const attrName = normalizeField(key);
        const attrValue = value.join(' ');

        if (attrName === 'name') {
          block = { ...block, [attrName]: attrValue };
        } else {
          block = {
            ...block,
            optional: { ...block.optional, [attrName]: attrValue },
          };
        }
      }
      tokenIndex.set(block.id, token);
    }
  }

  return [...configBlocks, block];
}

function getFullPath(filePath: string) {
  return isAbsolute(filePath) ? filePath : realpathSync(filePath);
}

export class FluentBitSchema {
  private _filePath: string;
  private _source: string;
  private _tokens: FluentBitToken[];
  private _tokenIndex: TokenIndex;
  constructor(source: string, filePath: string) {
    this._source = source;
    this._filePath = filePath;
    this._tokens = tokenize(source, getFullPath(filePath));
    this._tokenIndex = new TokenIndex();
  }
  static isFluentBitConfiguration(source: string) {
    return isFluentBit(source);
  }
  get AST(): FluentBitSchemaType[] {
    this._tokenIndex.clear();
    return tokensToAST(this._tokens, this._tokenIndex);
  }
  get filePath() {
    return this._filePath;
  }
  get source() {
    return this._source;
  }
  get schema() {
    const test = (node: FluentBitSchemaType) => {
      const isValidBlock = isValidFluentBitSection(node);
      const isNotCustomSectionName = !isCustomSectionName(node);

      return isValidBlock && isNotCustomSectionName;
    };

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return this.AST.filter(test).map(({ __filePath, ...rest }) => ({ ...rest } as FluentBitSection));
  }

  getTokensBySectionId(sectionId: string) {
    return this._tokenIndex.get(sectionId);
  }
  toString(indent?: number) {
    return schemaToString(this.schema, { propIndent: indent });
  }
}
