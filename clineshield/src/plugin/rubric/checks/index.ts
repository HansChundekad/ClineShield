import { dependencySignals, newRegistry } from './deps';
import { shellEditCheck } from './shell';
import { fileOpsCheck, filesTouched, locationCheck, sensitiveCheck, sizeCheck } from './files';
import { placeholder, secretAdded, selfProtection } from './hard';
import { contentCheck } from './content';
import { structureCheck } from './structure';
import { testAndSource, testsCheck } from './tests';
import type { Check } from '../types';

/** Run order: critical checks first so a deadline never skips them. */
export const ALL_CHECKS: Check[] = [
  selfProtection, placeholder, secretAdded, fileOpsCheck, sensitiveCheck, newRegistry,
  sizeCheck, filesTouched, locationCheck, shellEditCheck, testsCheck, testAndSource, contentCheck, structureCheck, dependencySignals,
];
