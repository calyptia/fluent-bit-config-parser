import {
  FLUENTBIT_REGEX,
  COMMANDS,
  type FluentBitSchemaType,
  EXCLUDED_TAGS,
  FLUENTBIT_INCLUDE_REGEX,
  CUSTOM_SECTIONS_NAMES,
  TOKEN_TYPES,
} from './constants';

export const isFluentBit = (config: string) =>
  !!(config.match(FLUENTBIT_REGEX) || config.match(FLUENTBIT_INCLUDE_REGEX));

export const isValidFluentBitSection = (schema?: FluentBitSchemaType | null): schema is FluentBitSchemaType =>
  !!schema && !EXCLUDED_TAGS.has(schema.command.toLowerCase());

export const isString = (value?: string): value is string => typeof value === 'string';

export const isUsefulToken = (type?: string): boolean =>
  isString(type) && !([TOKEN_TYPES.SPACE, TOKEN_TYPES.COMMENT] as string[]).includes(type);

export const isCommandType = (type?: string): type is COMMANDS =>
  isString(type) && Object.keys(COMMANDS).includes(type);

export const isCustomSectionName = (block: FluentBitSchemaType) =>
  !!isString(block.name) &&
  (block.name.includes(CUSTOM_SECTIONS_NAMES.FLUENTBIT_METRICS) || block.name.includes(CUSTOM_SECTIONS_NAMES.CALYPTIA));
