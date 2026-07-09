export type {
  NodeType,
  TriggerType,
  SourceType,
  SourceRef,
  JourneyNode,
  JourneyEdge,
  JourneyFlow,
  AppInfo,
  AdapterInfo,
  GraphMeta,
  JourneyGraph,
} from './types.js';

export {
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_MAJOR,
  parseSchemaVersion,
  isSupportedSchemaVersion,
} from './version.js';

export { journeyGraphJsonSchema } from './json-schema.js';
