/**
 * LiveKit Manager - Tool Registry Events Tests
 */

import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { RpcError } from 'livekit-client';
import { setupTest, type TestContext } from './shared-setup';

describe('LiveKitManager - Tool Registry Events', () => {
  let context: TestContext;

  beforeEach(() => {
    context = setupTest();
  });

  test('should emit toolsRegistered event with tools list', () => {
    const { liveKitManager } = context;
    const tools = [
      {
        function_name: 'testTool1',
        fn: jest.fn().mockResolvedValue('result1'),
      },
    ];

    const toolsRegisteredSpy = jest.fn();
    liveKitManager.on('toolsRegistered', toolsRegisteredSpy);

    liveKitManager.registerTools(tools);

    expect(toolsRegisteredSpy).toHaveBeenCalledWith(tools);
  });

  test('should emit rpcError event when tool execution fails', async () => {
    const { liveKitManager, mockRoom } = context;
    const mockError = new Error('Tool execution failed');
    const mockTool = {
      function_name: 'errorTool',
      fn: jest.fn().mockRejectedValue(mockError),
    };

    const rpcErrorSpy = jest.fn();
    liveKitManager.on('rpcError', rpcErrorSpy);

    liveKitManager.registerTools([mockTool]);

    // Get the RPC handler function
    const rpcHandler = mockRoom.registerRpcMethod.mock.calls[0][1];

    // Mock RPC data
    const rpcData = {
      payload: JSON.stringify({ param1: 'value1' }),
    };

    await rpcHandler(rpcData);

    expect(rpcErrorSpy).toHaveBeenCalledWith('errorTool', mockError);
  });

  test('should emit rpcError event when tool execution fails with RpcError', async () => {
    const { liveKitManager, mockRoom } = context;
    const ERROR_CODE = 1500;
    const mockRpcError = new RpcError(
      ERROR_CODE,
      'Custom RPC Error',
      'Some data'
    );
    const mockTool = {
      function_name: 'rpcErrorTool',
      fn: jest.fn().mockRejectedValue(mockRpcError),
    };

    const rpcErrorSpy = jest.fn();
    liveKitManager.on('rpcError', rpcErrorSpy);

    liveKitManager.registerTools([mockTool]);

    // Get the RPC handler function
    const rpcHandler = mockRoom.registerRpcMethod.mock.calls[0][1];

    // Mock RPC data
    const rpcData = {
      payload: JSON.stringify({}),
    };

    await rpcHandler(rpcData);

    expect(rpcErrorSpy).toHaveBeenCalledWith('rpcErrorTool', mockRpcError);
  });

  test('should pass RpcInvocationData to tool function', async () => {
    const { liveKitManager, mockRoom } = context;
    const mockTool = {
      function_name: 'dataTool',
      fn: jest.fn().mockResolvedValue('success'),
    };

    liveKitManager.registerTools([mockTool]);

    // Get the RPC handler function
    const rpcHandler = mockRoom.registerRpcMethod.mock.calls[0][1];

    // Mock RPC data including invocation metadata
    const rpcData = {
      payload: JSON.stringify({ arg1: 'val1' }),
      callerIdentity: 'agent-123',
      requestId: 'req-456',
      responseTimeout: 10_000,
    };

    await rpcHandler(rpcData);

    // Should be called with argument AND the raw data object
    expect(mockTool.fn).toHaveBeenCalledWith('val1', rpcData);
  });

  describe('messageReceived event', () => {
    test('should emit a structured agent message with id and isFinal', () => {
      const { liveKitManager } = context;
      const messageSpy = jest.fn();
      liveKitManager.on('messageReceived', messageSpy);

      liveKitManager.toolRegistry.handleTranscriptionReceived(
        [{ id: 'seg-1', text: 'Hello there', final: true }],
        'agent-123'
      );

      expect(messageSpy).toHaveBeenCalledTimes(1);
      expect(messageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'seg-1',
          role: 'agent',
          text: 'Hello there',
          isFinal: true,
        })
      );
      expect(messageSpy.mock.calls[0][0].timestamp).toEqual(expect.any(Number));
    });

    test('should mark user transcriptions with role "user"', () => {
      const { liveKitManager } = context;
      const messageSpy = jest.fn();
      liveKitManager.on('messageReceived', messageSpy);

      liveKitManager.toolRegistry.handleTranscriptionReceived(
        [{ id: 'seg-2', text: 'My order number', final: false }],
        'user-789'
      );

      expect(messageSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'seg-2',
          role: 'user',
          isFinal: false,
        })
      );
    });

    test('should keep a stable id across streaming partials of one message', () => {
      const { liveKitManager } = context;
      const ids: string[] = [];
      liveKitManager.on('messageReceived', (m) => ids.push(m.id));

      liveKitManager.toolRegistry.handleTranscriptionReceived(
        [{ id: 'seg-3', text: 'Hel', final: false }],
        'agent-1'
      );
      liveKitManager.toolRegistry.handleTranscriptionReceived(
        [{ id: 'seg-3', text: 'Hello', final: true }],
        'agent-1'
      );

      expect(ids).toEqual(['seg-3', 'seg-3']);
    });

    test('should synthesize an id when the segment has none', () => {
      const { liveKitManager } = context;
      const messageSpy = jest.fn();
      liveKitManager.on('messageReceived', messageSpy);

      liveKitManager.toolRegistry.handleTranscriptionReceived(
        [{ text: 'No id here', final: true }],
        'agent-1'
      );

      const message = messageSpy.mock.calls[0][0];
      expect(typeof message.id).toBe('string');
      expect(message.id.length).toBeGreaterThan(0);
    });

    test('should still emit the legacy answerReceived event', () => {
      const { liveKitManager } = context;
      const answerSpy = jest.fn();
      liveKitManager.on('answerReceived', answerSpy);

      liveKitManager.toolRegistry.handleTranscriptionReceived(
        [{ id: 'seg-4', text: 'Backward compatible', final: true }],
        'agent-1'
      );

      expect(answerSpy).toHaveBeenCalledWith('Backward compatible');
    });
  });
});
