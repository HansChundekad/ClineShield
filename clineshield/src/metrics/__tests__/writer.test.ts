import * as fs from 'fs/promises';
import * as path from 'path';
import { appendEvent } from '../writer';
import type { EditBlockedEvent, EditAllowedEvent } from '../../types/metrics';

describe('metricsWriter', () => {
  const testWorkspaceRoot = '/tmp/clineshield-test';
  const metricsPath = path.join(testWorkspaceRoot, '.cline-shield', 'metrics.json');

  beforeEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testWorkspaceRoot, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  });

  afterEach(async () => {
    // Clean up after tests
    try {
      await fs.rm(testWorkspaceRoot, { recursive: true, force: true });
    } catch {
      // Ignore errors
    }
  });

  describe('appendEvent', () => {
    it('should create .cline-shield directory if it does not exist', async () => {
      const event: EditBlockedEvent = {
        timestamp: new Date().toISOString(),
        sessionId: 'test-session',
        type: 'edit-blocked',
        data: {
          file: 'test.ts',
          reason: 'test reason',
          structuralChangePercent: 50,
          functionsDeleted: 2,
          exportsDeleted: 1,
        },
      };

      await appendEvent(event, testWorkspaceRoot);

      const dirExists = await fs
        .access(path.join(testWorkspaceRoot, '.cline-shield'))
        .then(() => true)
        .catch(() => false);

      expect(dirExists).toBe(true);
    });

    it('should create metrics.json with empty array if file does not exist', async () => {
      const event: EditBlockedEvent = {
        timestamp: new Date().toISOString(),
        sessionId: 'test-session',
        type: 'edit-blocked',
        data: {
          file: 'test.ts',
          reason: 'test reason',
          structuralChangePercent: 50,
          functionsDeleted: 2,
          exportsDeleted: 1,
        },
      };

      await appendEvent(event, testWorkspaceRoot);

      const content = await fs.readFile(metricsPath, 'utf-8');
      const events = JSON.parse(content);

      expect(Array.isArray(events)).toBe(true);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(event);
    });

    it('should append to existing metrics.json', async () => {
      const event1: EditBlockedEvent = {
        timestamp: new Date().toISOString(),
        sessionId: 'test-session',
        type: 'edit-blocked',
        data: {
          file: 'test1.ts',
          reason: 'test reason 1',
          structuralChangePercent: 50,
          functionsDeleted: 2,
          exportsDeleted: 1,
        },
      };

      const event2: EditAllowedEvent = {
        timestamp: new Date().toISOString(),
        sessionId: 'test-session',
        type: 'edit-allowed',
        data: {
          file: 'test2.ts',
          structuralChangePercent: 10,
          functionsDeleted: 0,
          exportsDeleted: 0,
        },
      };

      await appendEvent(event1, testWorkspaceRoot);
      await appendEvent(event2, testWorkspaceRoot);

      const content = await fs.readFile(metricsPath, 'utf-8');
      const events = JSON.parse(content);

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual(event1);
      expect(events[1]).toEqual(event2);
    });

    it('should reset to empty array if metrics.json is not an array', async () => {
      // Create directory and write invalid content
      await fs.mkdir(path.join(testWorkspaceRoot, '.cline-shield'), { recursive: true });
      await fs.writeFile(metricsPath, '{"invalid": "data"}', 'utf-8');

      const event: EditBlockedEvent = {
        timestamp: new Date().toISOString(),
        sessionId: 'test-session',
        type: 'edit-blocked',
        data: {
          file: 'test.ts',
          reason: 'test reason',
          structuralChangePercent: 50,
          functionsDeleted: 2,
          exportsDeleted: 1,
        },
      };

      await appendEvent(event, testWorkspaceRoot);

      const content = await fs.readFile(metricsPath, 'utf-8');
      const events = JSON.parse(content);

      expect(Array.isArray(events)).toBe(true);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual(event);
    });

    it('should not throw on write errors', async () => {
      // Use invalid path to trigger error
      const invalidRoot = '/invalid/path/that/does/not/exist/and/cannot/be/created';

      const event: EditBlockedEvent = {
        timestamp: new Date().toISOString(),
        sessionId: 'test-session',
        type: 'edit-blocked',
        data: {
          file: 'test.ts',
          reason: 'test reason',
          structuralChangePercent: 50,
          functionsDeleted: 2,
          exportsDeleted: 1,
        },
      };

      // Should not throw
      await expect(appendEvent(event, invalidRoot)).resolves.toBeUndefined();
    });
  });
});
