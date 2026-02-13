import * as fs from 'fs/promises';
import * as path from 'path';
import { readEvents, readEventsBySession, readEventsByType } from '../reader';
import type { EditBlockedEvent, EditAllowedEvent, SanityPassedEvent } from '../../types/metrics';

describe('metricsReader', () => {
  const testWorkspaceRoot = '/tmp/clineshield-test-reader';
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

  describe('readEvents', () => {
    it('should return empty array if file does not exist', async () => {
      const events = await readEvents(testWorkspaceRoot);
      expect(events).toEqual([]);
    });

    it('should return empty array if metrics.json is not an array', async () => {
      await fs.mkdir(path.join(testWorkspaceRoot, '.cline-shield'), { recursive: true });
      await fs.writeFile(metricsPath, '{"invalid": "data"}', 'utf-8');

      const events = await readEvents(testWorkspaceRoot);
      expect(events).toEqual([]);
    });

    it('should return empty array on parse errors', async () => {
      await fs.mkdir(path.join(testWorkspaceRoot, '.cline-shield'), { recursive: true });
      await fs.writeFile(metricsPath, 'invalid json{', 'utf-8');

      const events = await readEvents(testWorkspaceRoot);
      expect(events).toEqual([]);
    });

    it('should read all events from metrics.json', async () => {
      const testEvents: [EditBlockedEvent, EditAllowedEvent] = [
        {
          timestamp: '2025-02-12T10:00:00.000Z',
          sessionId: 'session-1',
          type: 'edit-blocked',
          data: {
            file: 'test1.ts',
            reason: 'test reason',
            structuralChangePercent: 50,
            functionsDeleted: 2,
            exportsDeleted: 1,
          },
        },
        {
          timestamp: '2025-02-12T10:05:00.000Z',
          sessionId: 'session-1',
          type: 'edit-allowed',
          data: {
            file: 'test2.ts',
            structuralChangePercent: 10,
            functionsDeleted: 0,
            exportsDeleted: 0,
          },
        },
      ];

      await fs.mkdir(path.join(testWorkspaceRoot, '.cline-shield'), { recursive: true });
      await fs.writeFile(metricsPath, JSON.stringify(testEvents, null, 2), 'utf-8');

      const events = await readEvents(testWorkspaceRoot);
      expect(events).toEqual(testEvents);
    });
  });

  describe('readEventsBySession', () => {
    it('should filter events by session ID', async () => {
      const testEvents = [
        {
          timestamp: '2025-02-12T10:00:00.000Z',
          sessionId: 'session-1',
          type: 'edit-blocked',
          data: {
            file: 'test1.ts',
            reason: 'test',
            structuralChangePercent: 50,
            functionsDeleted: 2,
            exportsDeleted: 1,
          },
        },
        {
          timestamp: '2025-02-12T10:05:00.000Z',
          sessionId: 'session-2',
          type: 'edit-allowed',
          data: {
            file: 'test2.ts',
            structuralChangePercent: 10,
            functionsDeleted: 0,
            exportsDeleted: 0,
          },
        },
        {
          timestamp: '2025-02-12T10:10:00.000Z',
          sessionId: 'session-1',
          type: 'edit-allowed',
          data: {
            file: 'test3.ts',
            structuralChangePercent: 20,
            functionsDeleted: 1,
            exportsDeleted: 0,
          },
        },
      ];

      await fs.mkdir(path.join(testWorkspaceRoot, '.cline-shield'), { recursive: true });
      await fs.writeFile(metricsPath, JSON.stringify(testEvents, null, 2), 'utf-8');

      const session1Events = await readEventsBySession('session-1', testWorkspaceRoot);
      expect(session1Events).toHaveLength(2);
      expect(session1Events[0].sessionId).toBe('session-1');
      expect(session1Events[1].sessionId).toBe('session-1');

      const session2Events = await readEventsBySession('session-2', testWorkspaceRoot);
      expect(session2Events).toHaveLength(1);
      expect(session2Events[0].sessionId).toBe('session-2');
    });

    it('should return empty array if no events match session', async () => {
      const testEvents = [
        {
          timestamp: '2025-02-12T10:00:00.000Z',
          sessionId: 'session-1',
          type: 'edit-blocked',
          data: {
            file: 'test1.ts',
            reason: 'test',
            structuralChangePercent: 50,
            functionsDeleted: 2,
            exportsDeleted: 1,
          },
        },
      ];

      await fs.mkdir(path.join(testWorkspaceRoot, '.cline-shield'), { recursive: true });
      await fs.writeFile(metricsPath, JSON.stringify(testEvents, null, 2), 'utf-8');

      const events = await readEventsBySession('nonexistent-session', testWorkspaceRoot);
      expect(events).toEqual([]);
    });
  });

  describe('readEventsByType', () => {
    it('should filter events by type with type-safe return', async () => {
      const testEvents = [
        {
          timestamp: '2025-02-12T10:00:00.000Z',
          sessionId: 'session-1',
          type: 'edit-blocked',
          data: {
            file: 'test1.ts',
            reason: 'test',
            structuralChangePercent: 50,
            functionsDeleted: 2,
            exportsDeleted: 1,
          },
        },
        {
          timestamp: '2025-02-12T10:05:00.000Z',
          sessionId: 'session-1',
          type: 'edit-allowed',
          data: {
            file: 'test2.ts',
            structuralChangePercent: 10,
            functionsDeleted: 0,
            exportsDeleted: 0,
          },
        },
        {
          timestamp: '2025-02-12T10:10:00.000Z',
          sessionId: 'session-1',
          type: 'sanity-passed',
          data: {
            file: 'test3.ts',
            tools: ['eslint'],
            duration: 1.2,
          },
        },
      ];

      await fs.mkdir(path.join(testWorkspaceRoot, '.cline-shield'), { recursive: true });
      await fs.writeFile(metricsPath, JSON.stringify(testEvents, null, 2), 'utf-8');

      const blockedEvents = await readEventsByType('edit-blocked', testWorkspaceRoot);
      expect(blockedEvents).toHaveLength(1);
      expect(blockedEvents[0].type).toBe('edit-blocked');
      expect(blockedEvents[0].data.reason).toBe('test'); // Type-safe access

      const allowedEvents = await readEventsByType('edit-allowed', testWorkspaceRoot);
      expect(allowedEvents).toHaveLength(1);
      expect(allowedEvents[0].type).toBe('edit-allowed');

      const passedEvents = await readEventsByType('sanity-passed', testWorkspaceRoot);
      expect(passedEvents).toHaveLength(1);
      expect(passedEvents[0].type).toBe('sanity-passed');
      expect(passedEvents[0].data.tools).toEqual(['eslint']); // Type-safe access
    });

    it('should return empty array if no events match type', async () => {
      const testEvents = [
        {
          timestamp: '2025-02-12T10:00:00.000Z',
          sessionId: 'session-1',
          type: 'edit-blocked',
          data: {
            file: 'test1.ts',
            reason: 'test',
            structuralChangePercent: 50,
            functionsDeleted: 2,
            exportsDeleted: 1,
          },
        },
      ];

      await fs.mkdir(path.join(testWorkspaceRoot, '.cline-shield'), { recursive: true });
      await fs.writeFile(metricsPath, JSON.stringify(testEvents, null, 2), 'utf-8');

      const events = await readEventsByType('sanity-passed', testWorkspaceRoot);
      expect(events).toEqual([]);
    });
  });
});
